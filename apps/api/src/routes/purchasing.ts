/**
 * Achats de stock : tarifs des fournisseurs (import de leur liste de prix) et commandes fournisseurs
 * (créées au bureau, réceptionnées par le magasinier à l'arrivée de la marchandise).
 */
import { Router } from 'express';
import path from 'node:path';
import { createReadStream, existsSync, unlinkSync } from 'node:fs';
import multer from 'multer';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { round2 } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { insensitive } from '../lib/search.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STOCK_MOVE, STOCK_MANAGE, OFFICE } from '../lib/auth.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';
import { applyStockMovement, sameName, unitFactor } from '../lib/stock.js';
import { parseTariff, guessPacking } from '../lib/supplier-tariff.js';

export const purchasingRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
/** Documents joints à une commande (PDF, photos, Word/Excel…) : 14 Mo max, comme la limite du proxy (15 Mo par requête). */
const MAX_ORDER_FILE_BYTES = 14 * 1024 * 1024;
const orderFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ORDER_FILE_BYTES, files: 1 } });
const ORDER_FILE_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.doc', '.docx', '.xls', '.xlsx', '.odt', '.ods', '.rtf', '.txt', '.csv', '.eml', '.msg', '.zip']);
const INLINE_TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const cleanName = (s: string) => s.replace(/[\u0000-\u001f"\\/]/g, '_').trim();
/** Les noms de fichiers arrivent en latin1 depuis multer : on les remet en UTF-8 (accents). */
const fixName = (s: string) => { try { const u = Buffer.from(s, 'latin1').toString('utf8'); return u.includes('�') ? s : u; } catch { return s; } };
const OPEN = ['ordered', 'partial'];

/* ================================================================== tarifs fournisseurs */

/** Fournisseurs dont on a importé un tarif (avec le nombre d'articles). */
purchasingRouter.get(
  '/catalog/suppliers',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (_req, res) => {
    const groups = await prisma.supplierProduct.groupBy({ by: ['contactId'], _count: { _all: true }, _max: { updatedAt: true } });
    const contacts = await prisma.contact.findMany({
      where: { id: { in: groups.map((g) => g.contactId) } },
      select: { id: true, name: true, customerNumber: true, onAccount: true },
    });
    const byId = new Map(contacts.map((c) => [c.id, c]));
    res.json({
      items: groups
        .map((g) => ({ ...byId.get(g.contactId)!, productCount: g._count._all, updatedAt: g._max.updatedAt }))
        .filter((g) => g.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }),
);

purchasingRouter.get(
  '/catalog',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const { contactId, q: qRaw } = req.query as Record<string, string>;
    const q = qRaw?.toLowerCase();
    if (!contactId) throw new HttpError(422, 'Fournisseur requis');
    const where: Prisma.SupplierProductWhereInput = { contactId };
    if (q?.trim()) where.OR = [{ label: { contains: q.trim(), ...insensitive } }, { ref: { contains: q.trim(), ...insensitive } }];
    const [items, total] = await Promise.all([
      prisma.supplierProduct.findMany({ where, orderBy: { label: 'asc' }, take: 100 }),
      prisma.supplierProduct.count({ where }),
    ]);
    const links = await prisma.stockSupplier.findMany({
      where: { contactId, supplierRef: { in: items.map((i) => i.ref) } },
      select: { supplierRef: true, stockItem: { select: { id: true, name: true, ref: true } } },
    });
    const linkByRef = new Map(links.map((l) => [l.supplierRef, l.stockItem]));
    res.json({ items: items.map((p) => ({ ...p, linked: linkByRef.get(p.ref) ?? null })), total });
  }),
);

/** Importe la liste de prix d'un fournisseur (mise à jour si elle existe déjà) et répercute les nouveaux prix sur les articles liés. */
purchasingRouter.post(
  '/catalog/import',
  requireAuth(...STOCK_MANAGE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const contactId = String(req.body?.contactId ?? '');
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true } });
    if (!contact) throw new HttpError(422, 'Fournisseur introuvable');
    const sheetHint = String(req.body?.sheet ?? '').trim() || contact.name;
    const parsed = parseTariff(req.file.buffer, req.file.originalname, sheetHint);
    if (!parsed.rows.length) {
      throw new HttpError(422, `Aucun tarif reconnu (colonnes attendues : n° d’article, libellé, prix)${parsed.sheets.length ? ` — feuilles du fichier : ${parsed.sheets.join(', ')}` : ''}`);
    }

    const existing = new Map((await prisma.supplierProduct.findMany({ where: { contactId } })).map((p) => [p.ref, p]));
    let created = 0, updated = 0, unchanged = 0;
    const toCreate: Prisma.SupplierProductCreateManyInput[] = [];
    for (const r of parsed.rows) {
      const cur = existing.get(r.ref);
      if (!cur) { toCreate.push({ contactId, ...r }); created++; continue; }
      if (cur.label === r.label && cur.priceHt === r.priceHt && cur.unit === r.unit && cur.grossPrice === r.grossPrice && cur.discountPct === r.discountPct) { unchanged++; continue; }
      await prisma.supplierProduct.update({ where: { id: cur.id }, data: { label: r.label, unit: r.unit, priceHt: r.priceHt, grossPrice: r.grossPrice, discountPct: r.discountPct } });
      updated++;
    }
    for (let i = 0; i < toCreate.length; i += 200) await prisma.supplierProduct.createMany({ data: toCreate.slice(i, i + 200) });

    // prix des articles déjà liés à ce fournisseur (même n° d'article chez lui)
    const byRef = new Map(parsed.rows.map((r) => [r.ref, r]));
    let pricesSynced = 0;
    const links = await prisma.stockSupplier.findMany({ where: { contactId, supplierRef: { not: null } } });
    for (const l of links) {
      const row = byRef.get(l.supplierRef!);
      if (row && l.price !== row.priceHt) { await prisma.stockSupplier.update({ where: { id: l.id }, data: { price: row.priceHt } }); pricesSynced++; }
    }
    res.status(201).json({ imported: parsed.rows.length, created, updated, unchanged, pricesSynced, sheet: parsed.sheet, sheets: parsed.sheets });
  }),
);

/** Crée l'article de stock correspondant à une ligne du tarif (et le lie à ce fournisseur, prix compris). */
purchasingRouter.post(
  '/catalog/:id/create-article',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const p = await prisma.supplierProduct.findUnique({ where: { id: req.params.id } });
    if (!p) throw new HttpError(404, 'Ligne de tarif introuvable');
    const body = z.object({ name: z.string().trim().min(1).optional(), brand: z.string().trim().nullish(), model: z.string().trim().nullish() }).parse(req.body ?? {});
    const already = await prisma.stockSupplier.findFirst({ where: { contactId: p.contactId, supplierRef: p.ref }, include: { stockItem: { select: { id: true, name: true } } } });
    if (already) throw new HttpError(409, `Déjà lié à l’article « ${already.stockItem.name} »`);

    const { unit, pack } = guessPacking(p.label, p.unit);
    const seq = await nextCounter('stock:item');
    const item = await prisma.stockItem.create({
      data: {
        ref: `ART-${String(seq).padStart(4, '0')}`,
        name: body.name ?? p.label, brand: body.brand ?? null, model: body.model ?? null, unit,
        units: pack ? { create: [{ name: pack.name, factor: pack.factor, position: 0 }] } : undefined,
        suppliers: { create: [{ contactId: p.contactId, supplierRef: p.ref, unitName: pack?.name ?? null, price: p.priceHt, preferred: true }] },
      },
      include: { units: true, suppliers: true },
    });
    res.status(201).json({ item });
  }),
);

/* ================================================================== commandes fournisseurs */

const orderInclude = {
  contact: { select: { id: true, name: true, customerNumber: true, onAccount: true, phone: true, email: true } },
  worksite: { select: { id: true, ref: true, title: true } },
  lines: {
    orderBy: { position: 'asc' as const },
    include: {
      stockItem: { select: { id: true, ref: true, name: true, brand: true, model: true, unit: true, photoThumbUrl: true, units: { select: { name: true, factor: true } } } },
    },
  },
  files: { orderBy: { createdAt: 'asc' as const }, select: { id: true, label: true, originalName: true, mimeType: true, size: true, createdAt: true } },
} satisfies Prisma.PurchaseOrderInclude;

/** Ligne = article du stock (stockItemId) OU ligne libre (label : produit commandé une seule fois, jamais mis en stock). */
const lineInput = z.object({
  stockItemId: z.string().min(1).nullish(),
  label: z.string().trim().max(300).nullish(),
  unitName: z.string().trim().max(40).nullish(),
  qty: z.coerce.number().positive(),
  price: z.coerce.number().min(0).nullish(),
}).refine((l) => !!l.stockItemId || !!l.label?.trim(), { message: 'Chaque ligne a besoin d’un article du stock ou d’une description' });
const orderInput = z.object({
  contactId: z.string().min(1),
  worksiteId: z.string().nullish(),
  expectedOn: z.coerce.date().nullish(),
  supplierRef: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  status: z.enum(['draft', 'ordered']).optional(),
  lines: z.array(lineInput).min(1, 'Ajoutez au moins un article'),
});

async function nextRef(): Promise<string> {
  const year = new Date().getFullYear();
  return `CF-${year}-${String(await nextCounter(`stock:po:${year}`)).padStart(3, '0')}`;
}

async function checkLines(contactId: string, lines: z.infer<typeof lineInput>[]) {
  if (!(await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } }))) throw new HttpError(422, 'Fournisseur introuvable');
  const items = await prisma.stockItem.findMany({ where: { id: { in: lines.flatMap((l) => (l.stockItemId ? [l.stockItemId] : [])) } }, include: { units: true, suppliers: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return lines.map((l, position) => {
    if (!l.stockItemId) {
      // ligne libre : pas d'article, pas de stock — description, quantité, unité (texte libre) et prix saisis tels quels
      return { stockItemId: null as string | null, label: l.label!.trim(), unitName: l.unitName?.trim() || null, qty: l.qty, price: l.price ?? null, position };
    }
    const item = byId.get(l.stockItemId);
    if (!item || !item.active) throw new HttpError(422, 'Article introuvable ou désactivé');
    unitFactor(item, l.unitName);
    const unitName = l.unitName?.trim() && !sameName(l.unitName, item.unit) ? l.unitName.trim() : null;
    // prix par défaut : celui de ce fournisseur pour cet article/conditionnement
    const link = item.suppliers.find((s) => s.contactId === contactId && (s.unitName ?? null) === unitName);
    return { stockItemId: item.id as string | null, label: null as string | null, unitName, qty: l.qty, price: l.price ?? link?.price ?? null, position };
  });
}

async function loadOrder(id: string) {
  const o = await prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
  if (!o) throw new HttpError(404, 'Commande introuvable');
  return o;
}

purchasingRouter.get(
  '/orders',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string>;
    const where: Prisma.PurchaseOrderWhereInput =
      status === 'all' ? {} : status === 'received' ? { status: 'received' } : status === 'draft' ? { status: 'draft' } : { status: { in: OPEN } };
    const items = await prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ expectedOn: 'asc' }, { createdAt: 'desc' }],
      take: 300,
      include: { contact: { select: { id: true, name: true } }, worksite: { select: { id: true, ref: true } }, lines: { select: { qty: true, receivedQty: true, price: true } } },
    });
    res.json({
      items: items.map(({ lines, ...o }) => ({
        ...o,
        lineCount: lines.length,
        receivedLines: lines.filter((l) => l.receivedQty + 0.0001 >= l.qty).length,
        totalHt: round2(lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0)),
      })),
    });
  }),
);

purchasingRouter.get(
  '/orders/:id',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => res.json({ order: await loadOrder(req.params.id as string) })),
);

purchasingRouter.post(
  '/orders',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const d = orderInput.parse(req.body);
    const lines = await checkLines(d.contactId, d.lines);
    const status = d.status ?? 'ordered';
    const order = await prisma.purchaseOrder.create({
      data: {
        ref: await nextRef(), contactId: d.contactId, worksiteId: d.worksiteId ?? null, status,
        orderedOn: status === 'ordered' ? new Date() : null, expectedOn: d.expectedOn ?? null,
        supplierRef: d.supplierRef ?? null, note: d.note ?? null, createdById: req.user!.id, lines: { create: lines },
      },
      include: orderInclude,
    });
    res.status(201).json({ order });
  }),
);

purchasingRouter.patch(
  '/orders/:id',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const cur = await loadOrder(req.params.id as string);
    if (cur.status === 'received' || cur.status === 'cancelled') throw new HttpError(409, 'Commande terminée ou annulée');
    const d = orderInput.partial().parse(req.body);
    if (d.lines && cur.lines.some((l) => l.receivedQty > 0)) throw new HttpError(409, 'Une partie est déjà réceptionnée : la liste ne peut plus être modifiée');
    const lines = d.lines ? await checkLines(d.contactId ?? cur.contactId, d.lines) : null;
    await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: cur.id } });
        await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: cur.id })) });
      }
      await tx.purchaseOrder.update({
        where: { id: cur.id },
        data: {
          contactId: d.contactId,
          worksiteId: d.worksiteId === undefined ? undefined : d.worksiteId,
          expectedOn: d.expectedOn === undefined ? undefined : d.expectedOn,
          supplierRef: d.supplierRef === undefined ? undefined : (d.supplierRef ?? null),
          note: d.note === undefined ? undefined : (d.note ?? null),
          ...(d.status === 'ordered' && cur.status === 'draft' ? { status: 'ordered', orderedOn: new Date() } : {}),
        },
      });
    });
    res.json({ order: await loadOrder(cur.id) });
  }),
);

/** Marque une commande brouillon comme passée chez le fournisseur. */
purchasingRouter.post(
  '/orders/:id/place',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const cur = await loadOrder(req.params.id as string);
    if (cur.status !== 'draft') throw new HttpError(409, 'Cette commande n’est plus un brouillon');
    await prisma.purchaseOrder.update({ where: { id: cur.id }, data: { status: 'ordered', orderedOn: new Date() } });
    res.json({ order: await loadOrder(cur.id) });
  }),
);

/**
 * Réception (totale ou partielle) : entrée en stock de ce qui est arrivé, avec le fournisseur et le
 * prix de la commande. Une réception peut dépasser la quantité commandée (le fournisseur livre parfois plus).
 */
purchasingRouter.post(
  '/orders/:id/receive',
  requireAuth(...STOCK_MOVE),
  asyncHandler(async (req, res) => {
    const d = z.object({
      lines: z.array(z.object({ lineId: z.string(), qty: z.coerce.number().min(0) })).min(1),
      deliveryNote: z.string().trim().nullish(),
      location: z.string().trim().max(40).nullish(), // rack où la marchandise est rangée
    }).parse(req.body);
    const order = await loadOrder(req.params.id as string);
    if (!OPEN.includes(order.status)) throw new HttpError(409, 'Cette commande n’est pas en attente de réception');
    const toReceive = d.lines.filter((l) => l.qty > 0);
    if (!toReceive.length) throw new HttpError(422, 'Aucune quantité reçue');
    for (const r of toReceive) if (!order.lines.some((l) => l.id === r.lineId)) throw new HttpError(422, 'Ligne inconnue pour cette commande');

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.purchaseOrder.findUnique({ where: { id: order.id }, select: { status: true } });
      if (!fresh || !OPEN.includes(fresh.status)) throw new HttpError(409, 'Cette commande vient d’être clôturée');
      for (const r of toReceive) {
        const line = order.lines.find((l) => l.id === r.lineId)!;
        // ligne libre (hors stock) : on note seulement qu'elle est arrivée, aucune entrée en stock
        if (line.stockItemId) {
          await applyStockMovement(
            tx,
            {
              stockItemId: line.stockItemId, type: 'in', qty: r.qty, unit: line.unitName, contactId: order.contactId,
              unitCost: line.price ?? undefined, location: d.location,
              note: `Réception ${order.ref}${d.deliveryNote ? ` · BL ${d.deliveryNote}` : ''}`,
            },
            req.user!.id,
          );
        }
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: round2(line.receivedQty + r.qty) } });
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const all = lines.every((l) => l.receivedQty + 0.0001 >= l.qty);
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: all ? 'received' : 'partial' } });
    });
    res.json({ order: await loadOrder(order.id) });
  }),
);

/** Clôture une commande partiellement livrée dont le reste n'arrivera pas. */
purchasingRouter.post(
  '/orders/:id/close',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const cur = await loadOrder(req.params.id as string);
    if (cur.status !== 'partial') throw new HttpError(409, 'Seule une commande partiellement livrée peut être clôturée');
    await prisma.purchaseOrder.update({ where: { id: cur.id }, data: { status: 'received' } });
    res.json({ order: await loadOrder(cur.id) });
  }),
);

purchasingRouter.post(
  '/orders/:id/cancel',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const cur = await loadOrder(req.params.id as string);
    if (cur.lines.some((l) => l.receivedQty > 0)) throw new HttpError(409, 'Une partie est déjà réceptionnée : impossible d’annuler (clôturez-la)');
    if (cur.status === 'received' || cur.status === 'cancelled') throw new HttpError(409, 'Commande déjà terminée ou annulée');
    await prisma.purchaseOrder.update({ where: { id: cur.id }, data: { status: 'cancelled' } });
    res.json({ order: await loadOrder(cur.id) });
  }),
);

/* ================================================================== documents joints à une commande */

const presentFile = (orderId: string, f: { id: string; label: string; originalName: string | null; mimeType: string | null; size: number; createdAt: Date }) => ({
  ...f, downloadPath: `/api/purchasing/orders/${orderId}/files/${f.id}/download`,
});

purchasingRouter.get(
  '/orders/:id/files',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id as string;
    if (!(await prisma.purchaseOrder.findUnique({ where: { id: orderId }, select: { id: true } }))) throw new HttpError(404, 'Commande introuvable');
    const rows = await prisma.purchaseOrderFile.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    res.json({ items: rows.map((f) => presentFile(orderId, f)), maxBytes: MAX_ORDER_FILE_BYTES });
  }),
);

purchasingRouter.post(
  '/orders/:id/files',
  requireAuth(...OFFICE),
  (req, res, next) => {
    orderFileUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Fichier trop lourd : ${Math.round(MAX_ORDER_FILE_BYTES / 1024 / 1024)} Mo maximum par fichier.`));
      next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const orderId = req.params.id as string;
    if (!(await prisma.purchaseOrder.findUnique({ where: { id: orderId }, select: { id: true } }))) throw new HttpError(404, 'Commande introuvable');
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const original = cleanName(fixName(req.file.originalname || 'fichier'));
    const ext = path.extname(original).toLowerCase();
    if (!ORDER_FILE_EXT.has(ext)) throw new HttpError(422, `Type de fichier non accepté (${ext || 'sans extension'}). Acceptés : PDF, images, Word/Excel, texte, e-mail, zip.`);
    const label = z.string().max(200).optional().parse(req.body?.label);
    const fileUrl = storeFile(req.file.buffer, original, 'purchase-orders');
    const row = await prisma.purchaseOrderFile.create({
      data: { orderId, label: label?.trim() || original.replace(/\.[^.]+$/, ''), fileUrl, originalName: original, mimeType: req.file.mimetype || null, size: req.file.size, uploadedById: req.user!.id },
    });
    res.status(201).json({ file: presentFile(orderId, row) });
  }),
);

purchasingRouter.delete(
  '/orders/:id/files/:fileId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const f = await prisma.purchaseOrderFile.findFirst({ where: { id: req.params.fileId, orderId: req.params.id } });
    if (!f) throw new HttpError(404, 'Fichier introuvable');
    await prisma.purchaseOrderFile.delete({ where: { id: f.id } });
    try {
      const p = path.join(UPLOADS_DIR, path.normalize(f.fileUrl.replace(/^\/?uploads\//, '')));
      if (existsSync(p)) unlinkSync(p);
    } catch { /* le fichier disparu du disque ne doit pas bloquer la suppression */ }
    res.status(204).end();
  }),
);

purchasingRouter.get(
  '/orders/:id/files/:fileId/download',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const f = await prisma.purchaseOrderFile.findFirst({ where: { id: req.params.fileId, orderId: req.params.id } });
    if (!f) throw new HttpError(404, 'Fichier introuvable');
    const p = path.join(UPLOADS_DIR, path.normalize(f.fileUrl.replace(/^\/?uploads\//, '')));
    if (!existsSync(p)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const inline = INLINE_TYPES[path.extname(p).toLowerCase()];
    const name = (f.originalName ?? f.label).replace(/[^\w.\- ()]/g, '_');
    res.setHeader('Content-Type', inline ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
    createReadStream(p).pipe(res);
  }),
);
