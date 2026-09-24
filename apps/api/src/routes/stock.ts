/**
 * Stock de matériaux (dépôt) — distinct du parc d'outillage Bricoloc (routes/materiel.ts)
 * et du catalogue de consommables planifiés par jour de chantier (model Consumable).
 * Ici : de vraies quantités en stock, des bons d'entrée/sortie/inventaire, une valorisation
 * au coût moyen pondéré. Historique de mouvements immuable façon grand livre.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { stockItemInput, stockMovementInput, stockSupplierInput, stockBarcodeInput, round2 } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { applyStockMovement, resolveStockCode, sameName } from '../lib/stock.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STOCK_READ, STOCK_MOVE, STOCK_MANAGE } from '../lib/auth.js';
import { normalizeLocation, isRackCode } from '../lib/stock.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';

export const stockRouter = Router();

// photo du produit : POST/DELETE /api/stock/items/:id/photo (bureau + magasinier)
const itemPhotoRouter = Router();
attachPhotoRoutes(itemPhotoRouter, (id, data) => prisma.stockItem.update({ where: { id }, data }), STOCK_MANAGE);
stockRouter.use('/items', itemPhotoRouter);

/* ------------------------------------------------------------------ articles */

const itemInclude = {
  units: { orderBy: [{ position: 'asc' as const }, { name: 'asc' as const }] },
  barcodes: { orderBy: { createdAt: 'asc' as const } },
  suppliers: {
    orderBy: [{ preferred: 'desc' as const }, { updatedAt: 'desc' as const }],
    include: { contact: { select: { id: true, name: true } } },
  },
} satisfies Prisma.StockItemInclude;

const same = sameName;

function shapeItem<T extends { qty: number; avgCost: number | null; minQty: number | null }>(it: T, role?: string) {
  const shaped = { ...it, value: round2(it.qty * (it.avgCost ?? 0)), low: it.minQty != null && it.qty < it.minQty };
  // les prix d'achat et les fournisseurs ne sont pas destinés aux ouvriers
  return role === 'worker' && 'suppliers' in shaped ? { ...shaped, suppliers: [], avgCost: null, value: 0 } : shaped;
}

/** Référence interne suivante (ART-0001…), sautant celles déjà prises (saisies à la main). */
async function nextItemRef(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const ref = `ART-${String(await nextCounter('stock:item')).padStart(4, '0')}`;
    if (!(await prisma.stockItem.findUnique({ where: { ref }, select: { id: true } }))) return ref;
  }
  throw new HttpError(500, 'Impossible d’attribuer une référence');
}

/** Valide les unités alternatives : noms distincts, différents de l'unité de base. */
function checkUnits(base: string, units: { name: string; factor: number }[]) {
  const seen = new Set<string>([base.trim().toLowerCase()]);
  for (const u of units) {
    const k = u.name.trim().toLowerCase();
    if (seen.has(k)) throw new HttpError(422, `Unité « ${u.name} » en double (ou identique à l’unité de base)`);
    seen.add(k);
  }
}

stockRouter.get(
  '/items',
  requireAuth(...STOCK_READ),
  asyncHandler(async (req, res) => {
    const { q, active } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (active !== '0') where.active = true; // par défaut : masque les articles désactivés
    if (q) where.OR = [{ name: { contains: q } }, { category: { contains: q } }, { ref: { contains: q } }, { brand: { contains: q } }, { model: { contains: q } }];
    const items = await prisma.stockItem.findMany({ where, orderBy: { name: 'asc' }, include: itemInclude });
    res.json({ items: items.map((i) => shapeItem(i, req.user!.role)) });
  }),
);

stockRouter.get(
  '/items/:id',
  requireAuth(...STOCK_READ),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.id }, include: itemInclude });
    if (!item) throw new HttpError(404, 'Article introuvable');
    res.json({ item: shapeItem(item, req.user!.role) });
  }),
);

stockRouter.post(
  '/items',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const d = stockItemInput.parse(req.body);
    checkUnits(d.unit, d.units ?? []);
    const ref = d.ref || (await nextItemRef());
    if (await prisma.stockItem.findUnique({ where: { ref }, select: { id: true } })) throw new HttpError(409, `La référence ${ref} existe déjà`);
    // fournisseurs liés dès la création : un prix par (fournisseur, conditionnement), un seul « préféré »
    const suppliers = d.suppliers ?? [];
    if (suppliers.length) {
      const known = await prisma.contact.findMany({ where: { id: { in: suppliers.map((x) => x.contactId) } }, select: { id: true } });
      if (known.length !== new Set(suppliers.map((x) => x.contactId)).size) throw new HttpError(422, 'Fournisseur introuvable');
    }
    const altNames = (d.units ?? []).map((u) => u.name);
    const seen = new Set<string>();
    const supplierRows = suppliers.map((sp) => {
      const raw = sp.unitName?.trim() || null;
      if (raw && !sameName(raw, d.unit) && !altNames.some((n) => sameName(n, raw))) throw new HttpError(422, `Unité d’achat « ${raw} » inconnue pour cet article`);
      const unitName = raw && !sameName(raw, d.unit) ? raw : null;
      const key = `${sp.contactId}|${(unitName ?? '').toLowerCase()}`;
      if (seen.has(key)) throw new HttpError(422, 'Ce fournisseur est déjà indiqué avec le même conditionnement');
      seen.add(key);
      return { contactId: sp.contactId, supplierRef: sp.supplierRef ?? null, unitName, price: sp.price ?? null, preferred: !!sp.preferred, note: sp.note ?? null };
    });
    if (supplierRows.length && !supplierRows.some((x) => x.preferred)) supplierRows[0]!.preferred = true;
    let preferredSeen = false;
    for (const row of supplierRows) { if (row.preferred && preferredSeen) row.preferred = false; if (row.preferred) preferredSeen = true; }

    const item = await prisma.stockItem.create({
      data: {
        ref, name: d.name, unit: d.unit, brand: d.brand ?? null, model: d.model ?? null, note: d.note ?? null,
        category: d.category ?? null, minQty: d.minQty ?? null,
        units: { create: (d.units ?? []).map((u, i) => ({ name: u.name, factor: u.factor, position: i })) },
        suppliers: { create: supplierRows },
      },
      include: itemInclude,
    });
    res.status(201).json({ item: shapeItem(item) });
  }),
);

stockRouter.patch(
  '/items/:id',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const d = stockItemInput.partial().parse(req.body);
    const current = await prisma.stockItem.findUnique({ where: { id: req.params.id }, include: { suppliers: true } });
    if (!current) throw new HttpError(404, 'Article introuvable');
    const base = d.unit ?? current.unit;
    if (d.units) {
      checkUnits(base, d.units);
      const kept = new Set(d.units.map((u) => u.name.trim().toLowerCase()));
      const inUse = current.suppliers.find((s) => s.unitName && !same(s.unitName, base) && !kept.has(s.unitName.trim().toLowerCase()));
      if (inUse) throw new HttpError(409, `L’unité « ${inUse.unitName} » est utilisée par un fournisseur — retirez-la d’abord de sa ligne`);
    }
    if (d.ref && d.ref !== current.ref) {
      const clash = await prisma.stockItem.findUnique({ where: { ref: d.ref }, select: { id: true } });
      if (clash) throw new HttpError(409, `La référence ${d.ref} existe déjà`);
    }
    const item = await prisma.$transaction(async (tx) => {
      if (d.units) {
        await tx.stockItemUnit.deleteMany({ where: { stockItemId: current.id } });
        await tx.stockItemUnit.createMany({ data: d.units.map((u, i) => ({ stockItemId: current.id, name: u.name, factor: u.factor, position: i })) });
      }
      return tx.stockItem.update({
        where: { id: current.id },
        data: {
          name: d.name,
          unit: d.unit,
          ref: d.ref || undefined,
          brand: d.brand === undefined ? undefined : (d.brand ?? null),
          model: d.model === undefined ? undefined : (d.model ?? null),
          note: d.note === undefined ? undefined : (d.note ?? null),
          category: d.category === undefined ? undefined : (d.category ?? null),
          minQty: d.minQty === undefined ? undefined : (d.minQty ?? null),
        },
        include: itemInclude,
      });
    });
    res.json({ item: shapeItem(item) });
  }),
);

/** Désactive un article (jamais de suppression : l'historique des mouvements doit rester lisible). */
stockRouter.delete(
  '/items/:id',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ item });
  }),
);

/* ------------------------------------------------------------------ codes-barres & scan */

/** Associe un code-barres (EAN du sac, étiquette…) à l'article — et à un conditionnement précis. */
stockRouter.post(
  '/items/:id/barcodes',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const d = stockBarcodeInput.parse(req.body);
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.id }, include: { units: true } });
    if (!item) throw new HttpError(404, 'Article introuvable');
    const unitName = d.unitName?.trim() || null;
    if (unitName && !same(unitName, item.unit) && !item.units.some((u) => same(u.name, unitName))) {
      throw new HttpError(422, `Unité « ${unitName} » inconnue pour cet article`);
    }
    const clash = await prisma.stockBarcode.findUnique({ where: { code: d.code }, include: { stockItem: { select: { name: true } } } });
    if (clash) throw new HttpError(409, `Ce code est déjà associé à « ${clash.stockItem.name} »`);
    const barcode = await prisma.stockBarcode.create({
      data: { stockItemId: item.id, code: d.code, unitName: unitName && same(unitName, item.unit) ? null : unitName, note: d.note ?? null },
    });
    res.status(201).json({ barcode });
  }),
);

stockRouter.delete(
  '/items/:id/barcodes/:bid',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const r = await prisma.stockBarcode.deleteMany({ where: { id: req.params.bid, stockItemId: req.params.id } });
    if (!r.count) throw new HttpError(404, 'Code-barres introuvable');
    res.json({ ok: true });
  }),
);

/**
 * Retrouve l'article d'un code scanné : code-barres enregistré (EAN du sac…) ou étiquette
 * interne « ART-0003 » / « ART-0003:sac » (référence + conditionnement).
 */
stockRouter.get(
  '/scan/:code',
  requireAuth(...STOCK_READ),
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? '').trim();
    if (!code) throw new HttpError(422, 'Code vide');

    if (isRackCode(code)) return res.json({ kind: 'rack', code: normalizeLocation(code) });
    const hit = await resolveStockCode(code);
    if (!hit) throw new HttpError(404, 'Code inconnu');
    const item = await prisma.stockItem.findUnique({ where: { id: hit.item.id }, include: itemInclude });
    return res.json({ kind: 'stock', item: shapeItem(item!, req.user!.role), unitName: hit.unitName, via: hit.via });
  }),
);

/* ------------------------------------------------------------------ racks */

/** Racks déclarés + ceux déjà utilisés par un article, avec le nombre d'articles rangés dedans. */
stockRouter.get(
  '/locations',
  requireAuth(...STOCK_READ),
  asyncHandler(async (_req, res) => {
    const [declared, used] = await Promise.all([
      prisma.stockLocation.findMany({ orderBy: { code: 'asc' } }),
      prisma.stockItem.groupBy({ by: ['location'], where: { active: true, location: { not: null } }, _count: { _all: true } }),
    ]);
    const counts = new Map(used.map((u) => [u.location!, u._count._all]));
    const codes = new Set([...declared.map((d) => d.code), ...counts.keys()]);
    const byCode = new Map(declared.map((d) => [d.code, d]));
    const items = [...codes].sort().map((code) => ({ code, id: byCode.get(code)?.id ?? null, label: byCode.get(code)?.label ?? null, itemCount: counts.get(code) ?? 0 }));
    res.json({ items });
  }),
);

stockRouter.post(
  '/locations',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const { codes } = z.object({ codes: z.array(z.string().trim().min(1).max(40)).min(1).max(300) }).parse(req.body);
    const clean = [...new Set(codes.map((c) => normalizeLocation(c)).filter((c): c is string => !!c))];
    if (!clean.length) throw new HttpError(422, 'Aucun code de rack valide');
    for (const code of clean) await prisma.stockLocation.upsert({ where: { code }, create: { code }, update: {} });
    res.status(201).json({ ok: true, count: clean.length });
  }),
);

stockRouter.delete(
  '/locations/:code',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const code = normalizeLocation(String(req.params.code));
    if (!code) throw new HttpError(422, 'Code invalide');
    await prisma.stockLocation.deleteMany({ where: { code } }); // l'emplacement mémorisé sur les articles reste : c'est un historique
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ fournisseurs d'un article */

async function checkSupplierInput(itemId: string, d: { contactId: string; unitName?: string | null }) {
  const item = await prisma.stockItem.findUnique({ where: { id: itemId }, include: { units: true } });
  if (!item) throw new HttpError(404, 'Article introuvable');
  const contact = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { id: true } });
  if (!contact) throw new HttpError(422, 'Fournisseur introuvable');
  const unitName = d.unitName?.trim() || null;
  if (unitName && !same(unitName, item.unit) && !item.units.some((u) => same(u.name, unitName))) {
    throw new HttpError(422, `Unité d’achat « ${unitName} » inconnue pour cet article`);
  }
  return { item, unitName: unitName && same(unitName, item.unit) ? null : unitName };
}

stockRouter.post(
  '/items/:id/suppliers',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const d = stockSupplierInput.parse(req.body);
    const { item, unitName } = await checkSupplierInput(req.params.id as string, d);
    const dup = await prisma.stockSupplier.findFirst({ where: { stockItemId: item.id, contactId: d.contactId, unitName } });
    if (dup) throw new HttpError(409, 'Ce fournisseur est déjà lié à cet article avec la même unité d’achat');
    const link = await prisma.$transaction(async (tx) => {
      if (d.preferred) await tx.stockSupplier.updateMany({ where: { stockItemId: item.id }, data: { preferred: false } });
      return tx.stockSupplier.create({
        data: {
          stockItemId: item.id, contactId: d.contactId, supplierRef: d.supplierRef ?? null, unitName,
          price: d.price ?? null, preferred: !!d.preferred, note: d.note ?? null,
        },
        include: { contact: { select: { id: true, name: true } } },
      });
    });
    res.status(201).json({ supplier: link });
  }),
);

stockRouter.patch(
  '/items/:id/suppliers/:sid',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.stockSupplier.findFirst({ where: { id: req.params.sid, stockItemId: req.params.id } });
    if (!existing) throw new HttpError(404, 'Fournisseur introuvable sur cet article');
    const d = stockSupplierInput.partial().parse(req.body);
    const { unitName } = await checkSupplierInput(existing.stockItemId, {
      contactId: d.contactId ?? existing.contactId,
      unitName: d.unitName === undefined ? existing.unitName : d.unitName,
    });
    const link = await prisma.$transaction(async (tx) => {
      if (d.preferred) await tx.stockSupplier.updateMany({ where: { stockItemId: existing.stockItemId, NOT: { id: existing.id } }, data: { preferred: false } });
      return tx.stockSupplier.update({
        where: { id: existing.id },
        data: {
          contactId: d.contactId,
          unitName,
          supplierRef: d.supplierRef === undefined ? undefined : (d.supplierRef ?? null),
          price: d.price === undefined ? undefined : (d.price ?? null),
          preferred: d.preferred,
          note: d.note === undefined ? undefined : (d.note ?? null),
        },
        include: { contact: { select: { id: true, name: true } } },
      });
    });
    res.json({ supplier: link });
  }),
);

stockRouter.delete(
  '/items/:id/suppliers/:sid',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const r = await prisma.stockSupplier.deleteMany({ where: { id: req.params.sid, stockItemId: req.params.id } });
    if (!r.count) throw new HttpError(404, 'Fournisseur introuvable sur cet article');
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ mouvements */

stockRouter.get(
  '/movements',
  requireAuth(...STOCK_READ),
  asyncHandler(async (req, res) => {
    const { stockItemId, worksiteId, type, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (stockItemId) where.stockItemId = stockItemId;
    if (worksiteId) where.worksiteId = worksiteId;
    if (type) where.type = type;
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 50));
    const [items, totalCount] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          stockItem: { select: { id: true, name: true, unit: true } },
          worksite: { select: { id: true, ref: true, title: true } },
          contact: { select: { id: true, name: true } },
          createdBy: { select: { email: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json({ items, page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) });
  }),
);

/** Bon d'entrée / de sortie / d'inventaire — voir applyStockMovement (saisie possible en unité alternative). */
stockRouter.post(
  '/movements',
  requireAuth(...STOCK_MOVE),
  asyncHandler(async (req, res) => {
    const d = stockMovementInput.parse(req.body);
    const result = await prisma.$transaction((tx) => applyStockMovement(tx, d, req.user!.id));
    res.status(201).json(result);
  }),
);

/* ------------------------------------------------------------------ meta */

stockRouter.get(
  '/meta',
  requireAuth(...STOCK_READ),
  asyncHandler(async (_req, res) => {
    const worksites = await prisma.worksite.findMany({
      where: { archived: false, kind: 'project' },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
      select: { id: true, ref: true, title: true },
    });
    const categories = await prisma.stockItem.findMany({
      where: { active: true, category: { not: null } },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    res.json({
      worksites: worksites.map((w) => ({ id: w.id, name: `${w.ref} · ${w.title}` })),
      categories: categories.map((c) => c.category).filter(Boolean),
    });
  }),
);
