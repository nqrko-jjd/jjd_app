/**
 * Préparations de commande pour un chantier : le bureau (ou le magasinier) crée la liste, le
 * magasinier la prépare en scannant chaque article (picking, comme un drive), puis la valide :
 * la validation génère les sorties de stock vers le chantier — pas avant, un picking abandonné
 * ne touche donc jamais au stock.
 */
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { round2 } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STOCK_READ, STOCK_MOVE, STOCK_MANAGE } from '../lib/auth.js';
import { applyStockMovement, resolveStockCode, unitFactor, sameName } from '../lib/stock.js';

export const stockOrdersRouter = Router();

const OPEN = ['to_prepare', 'preparing'];
const EPS = 0.0001;

const orderInclude = {
  worksite: { select: { id: true, ref: true, title: true, city: true } },
  lines: {
    orderBy: { position: 'asc' as const },
    include: {
      stockItem: {
        select: {
          id: true, ref: true, name: true, brand: true, unit: true, qty: true,
          units: { select: { name: true, factor: true } },
        },
      },
    },
  },
} satisfies Prisma.StockOrderInclude;

const lineInput = z.object({
  stockItemId: z.string().min(1),
  unitName: z.string().trim().nullish(),
  qty: z.coerce.number().positive(),
  note: z.string().trim().nullish(),
});
const orderInput = z.object({
  worksiteId: z.string().min(1),
  neededOn: z.coerce.date().nullish(),
  note: z.string().trim().nullish(),
  lines: z.array(lineInput).min(1, 'Ajoutez au moins un article'),
});

async function nextRef(): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await nextCounter(`stock:prep:${year}`);
  return `PREP-${year}-${String(seq).padStart(3, '0')}`;
}

/** Vérifie chantier + articles + unités de chaque ligne ; renvoie les lignes normalisées. */
async function checkLines(worksiteId: string, lines: z.infer<typeof lineInput>[]) {
  if (!(await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { id: true } }))) throw new HttpError(422, 'Chantier introuvable');
  const items = await prisma.stockItem.findMany({ where: { id: { in: lines.map((l) => l.stockItemId) } }, include: { units: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return lines.map((l, position) => {
    const item = byId.get(l.stockItemId);
    if (!item || !item.active) throw new HttpError(422, 'Article introuvable ou désactivé');
    unitFactor(item, l.unitName); // 422 si unité inconnue
    const unitName = l.unitName?.trim() && !sameName(l.unitName, item.unit) ? l.unitName.trim() : null;
    return { stockItemId: item.id, unitName, qty: l.qty, note: l.note ?? null, position };
  });
}

async function loadOrder(id: string) {
  const o = await prisma.stockOrder.findUnique({ where: { id }, include: orderInclude });
  if (!o) throw new HttpError(404, 'Préparation introuvable');
  return o;
}

function userName(req: { user?: { email: string } }) {
  return req.user?.email?.split('@')[0] ?? null;
}

stockOrdersRouter.get(
  '/',
  requireAuth(...STOCK_READ),
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string>;
    const where: Prisma.StockOrderWhereInput =
      status === 'all' ? {} : status === 'prepared' ? { status: 'prepared' } : status === 'cancelled' ? { status: 'cancelled' } : { status: { in: OPEN } };
    const items = await prisma.stockOrder.findMany({
      where,
      orderBy: [{ neededOn: 'asc' }, { createdAt: 'desc' }],
      take: 300,
      include: { worksite: { select: { id: true, ref: true, title: true } }, lines: { select: { qty: true, pickedQty: true } } },
    });
    res.json({
      items: items.map(({ lines, ...o }) => ({
        ...o,
        lineCount: lines.length,
        doneLines: lines.filter((l) => l.pickedQty + EPS >= l.qty).length,
      })),
    });
  }),
);

stockOrdersRouter.get(
  '/:id',
  requireAuth(...STOCK_READ),
  asyncHandler(async (req, res) => res.json({ order: await loadOrder(req.params.id as string) })),
);

stockOrdersRouter.post(
  '/',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const d = orderInput.parse(req.body);
    const lines = await checkLines(d.worksiteId, d.lines);
    const order = await prisma.stockOrder.create({
      data: {
        ref: await nextRef(), worksiteId: d.worksiteId, neededOn: d.neededOn ?? null, note: d.note ?? null,
        createdById: req.user!.id, lines: { create: lines },
      },
      include: orderInclude,
    });
    res.status(201).json({ order });
  }),
);

stockOrdersRouter.patch(
  '/:id',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const cur = await loadOrder(req.params.id as string);
    if (!OPEN.includes(cur.status)) throw new HttpError(409, 'Cette préparation est terminée ou annulée');
    const d = orderInput.partial().parse(req.body);
    if (d.lines && cur.lines.some((l) => l.pickedQty > 0)) throw new HttpError(409, 'Des articles sont déjà préparés : la liste ne peut plus être modifiée');
    const lines = d.lines ? await checkLines(d.worksiteId ?? cur.worksiteId, d.lines) : null;
    await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.stockOrderLine.deleteMany({ where: { orderId: cur.id } });
        await tx.stockOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: cur.id })) });
      }
      await tx.stockOrder.update({
        where: { id: cur.id },
        data: {
          worksiteId: d.worksiteId,
          neededOn: d.neededOn === undefined ? undefined : d.neededOn,
          note: d.note === undefined ? undefined : (d.note ?? null),
        },
      });
    });
    res.json({ order: await loadOrder(cur.id) });
  }),
);

/** Picking : un scan = 1 (ou `qty`) de l'unité scannée, imputé sur la ligne de cette préparation. */
stockOrdersRouter.post(
  '/:id/scan',
  requireAuth(...STOCK_MOVE),
  asyncHandler(async (req, res) => {
    const { code, qty: qtyRaw } = z.object({ code: z.string().trim().min(1), qty: z.coerce.number().positive().optional() }).parse(req.body);
    const order = await loadOrder(req.params.id as string);
    if (!OPEN.includes(order.status)) throw new HttpError(409, 'Cette préparation est terminée ou annulée');

    const hit = await resolveStockCode(code);
    if (!hit) throw new HttpError(404, `Code « ${code} » inconnu`);
    const lines = order.lines.filter((l) => l.stockItemId === hit.item.id);
    if (!lines.length) throw new HttpError(422, `« ${hit.item.name} » n’est pas demandé dans cette préparation`);

    const scannedBase = round2((qtyRaw ?? 1) * unitFactor(hit.item, hit.unitName));
    const line = lines.find((l) => l.pickedQty + EPS < l.qty);
    if (!line) throw new HttpError(409, `« ${hit.item.name} » : quantité déjà complète`);
    const lineFactor = unitFactor(hit.item, line.unitName);
    const remainingBase = (line.qty - line.pickedQty) * lineFactor;
    if (scannedBase > remainingBase + EPS) {
      throw new HttpError(409, `« ${hit.item.name} » : il ne reste que ${round2(line.qty - line.pickedQty)} ${line.unitName ?? hit.item.unit} à préparer`);
    }
    await prisma.$transaction([
      prisma.stockOrderLine.update({ where: { id: line.id }, data: { pickedQty: round2(line.pickedQty + scannedBase / lineFactor) } }),
      prisma.stockOrder.update({ where: { id: order.id }, data: { status: 'preparing' } }),
    ]);
    res.json({ order: await loadOrder(order.id), lineId: line.id, itemName: hit.item.name });
  }),
);

/** Saisie manuelle de la quantité préparée d'une ligne (vrac pesé, article sans code…). */
stockOrdersRouter.post(
  '/:id/lines/:lid/picked',
  requireAuth(...STOCK_MOVE),
  asyncHandler(async (req, res) => {
    const { pickedQty } = z.object({ pickedQty: z.coerce.number().min(0) }).parse(req.body);
    const order = await loadOrder(req.params.id as string);
    if (!OPEN.includes(order.status)) throw new HttpError(409, 'Cette préparation est terminée ou annulée');
    const line = order.lines.find((l) => l.id === req.params.lid);
    if (!line) throw new HttpError(404, 'Ligne introuvable');
    if (pickedQty > line.qty + EPS) throw new HttpError(422, `Maximum ${line.qty} ${line.unitName ?? line.stockItem.unit}`);
    await prisma.$transaction([
      prisma.stockOrderLine.update({ where: { id: line.id }, data: { pickedQty: round2(pickedQty) } }),
      prisma.stockOrder.update({ where: { id: order.id }, data: { status: 'preparing' } }),
    ]);
    res.json({ order: await loadOrder(order.id) });
  }),
);

/** Valide la préparation : sorties de stock vers le chantier pour tout ce qui a été préparé. */
stockOrdersRouter.post(
  '/:id/complete',
  requireAuth(...STOCK_MOVE),
  asyncHandler(async (req, res) => {
    const { allowShort } = z.object({ allowShort: z.boolean().optional() }).parse(req.body ?? {});
    const order = await loadOrder(req.params.id as string);
    if (!OPEN.includes(order.status)) throw new HttpError(409, 'Cette préparation est terminée ou annulée');
    const picked = order.lines.filter((l) => l.pickedQty > 0);
    if (!picked.length) throw new HttpError(422, 'Rien n’a été préparé');
    const short = order.lines.filter((l) => l.pickedQty + EPS < l.qty);
    if (short.length && !allowShort) {
      throw new HttpError(409, `Il manque : ${short.map((l) => `${round2(l.qty - l.pickedQty)} ${l.unitName ?? l.stockItem.unit} de ${l.stockItem.name}`).join(', ')}`);
    }
    await prisma.$transaction(async (tx) => {
      // garde anti-double validation (deux terminaux) : le statut est relu dans la transaction
      const fresh = await tx.stockOrder.findUnique({ where: { id: order.id }, select: { status: true } });
      if (!fresh || !OPEN.includes(fresh.status)) throw new HttpError(409, 'Cette préparation vient d’être validée');
      for (const l of picked) {
        await applyStockMovement(
          tx,
          { stockItemId: l.stockItemId, type: 'out', qty: l.pickedQty, unit: l.unitName, worksiteId: order.worksiteId, note: `Préparation ${order.ref}` },
          req.user!.id,
        );
      }
      await tx.stockOrder.update({
        where: { id: order.id },
        data: { status: 'prepared', preparedAt: new Date(), preparedById: req.user!.id, preparedBy: userName(req) },
      });
    });
    res.json({ order: await loadOrder(order.id) });
  }),
);

stockOrdersRouter.post(
  '/:id/cancel',
  requireAuth(...STOCK_MANAGE),
  asyncHandler(async (req, res) => {
    const order = await loadOrder(req.params.id as string);
    if (order.status === 'prepared') throw new HttpError(409, 'Préparation déjà validée : le stock a été sorti');
    await prisma.stockOrder.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    res.json({ order: await loadOrder(order.id) });
  }),
);
