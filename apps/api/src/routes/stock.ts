/**
 * Stock de matériaux (dépôt) — distinct du parc d'outillage Bricoloc (routes/materiel.ts)
 * et du catalogue de consommables planifiés par jour de chantier (model Consumable).
 * Ici : de vraies quantités en stock, des bons d'entrée/sortie/inventaire, une valorisation
 * au coût moyen pondéré. Historique de mouvements immuable façon grand livre.
 */
import { Router } from 'express';
import { stockItemInput, stockMovementInput, round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, FIELD_OFFICE } from '../lib/auth.js';

export const stockRouter = Router();

/* ------------------------------------------------------------------ articles */

stockRouter.get(
  '/items',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const { q, active } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (active !== '0') where.active = true; // par défaut : masque les articles désactivés
    if (q) where.OR = [{ name: { contains: q } }, { category: { contains: q } }];
    const items = await prisma.stockItem.findMany({ where, orderBy: { name: 'asc' } });
    res.json({
      items: items.map((it) => ({
        ...it,
        value: round2(it.qty * (it.avgCost ?? 0)),
        low: it.minQty != null && it.qty < it.minQty,
      })),
    });
  }),
);

stockRouter.post(
  '/items',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = stockItemInput.parse(req.body);
    const item = await prisma.stockItem.create({
      data: { name: d.name, unit: d.unit, category: d.category ?? null, minQty: d.minQty ?? null },
    });
    res.status(201).json({ item });
  }),
);

stockRouter.patch(
  '/items/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = stockItemInput.partial().parse(req.body);
    const item = await prisma.stockItem.update({
      where: { id: req.params.id },
      data: {
        name: d.name,
        unit: d.unit,
        category: d.category === undefined ? undefined : (d.category ?? null),
        minQty: d.minQty === undefined ? undefined : (d.minQty ?? null),
      },
    });
    res.json({ item });
  }),
);

/** Désactive un article (jamais de suppression : l'historique des mouvements doit rester lisible). */
stockRouter.delete(
  '/items/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ item });
  }),
);

/* ------------------------------------------------------------------ mouvements */

stockRouter.get(
  '/movements',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const { stockItemId, worksiteId, type, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (stockItemId) where.stockItemId = stockItemId;
    if (worksiteId) where.worksiteId = worksiteId;
    if (type) where.type = type;
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(500, Math.max(20, Math.trunc(Number(pageSizeStr)) || 50));
    const [items, totalCount] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          stockItem: { select: { id: true, name: true, unit: true } },
          worksite: { select: { id: true, ref: true, title: true } },
          createdBy: { select: { email: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json({ items, page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) });
  }),
);

/** Bon d'entrée / de sortie / d'inventaire — met à jour la quantité (et le coût moyen sur une entrée). */
stockRouter.post(
  '/movements',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const d = stockMovementInput.parse(req.body);
    if (d.type === 'out' && !d.worksiteId) throw new HttpError(422, 'Chantier requis pour une sortie');
    if (d.type !== 'adjustment' && d.qty <= 0) throw new HttpError(422, 'Quantité invalide');

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId } });
      if (!item) throw new HttpError(404, 'Article introuvable');

      let newQty: number;
      let newAvgCost = item.avgCost;
      let storedQty: number; // valeur enregistrée sur le mouvement (toujours positive pour in/out, delta signé pour adjustment)

      if (d.type === 'in') {
        storedQty = d.qty;
        newQty = round2(item.qty + d.qty);
        if (d.unitCost != null) {
          const oldValue = item.qty * (item.avgCost ?? d.unitCost);
          newAvgCost = round2((oldValue + d.qty * d.unitCost) / (newQty || 1));
        }
      } else if (d.type === 'out') {
        storedQty = d.qty;
        newQty = round2(item.qty - d.qty);
      } else {
        // adjustment : d.qty = quantité réelle comptée (cible), pas un delta
        storedQty = round2(d.qty - item.qty);
        newQty = round2(d.qty);
      }

      const updated = await tx.stockItem.update({ where: { id: item.id }, data: { qty: newQty, avgCost: newAvgCost } });
      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: item.id,
          type: d.type,
          qty: storedQty,
          unitCost: d.type === 'in' ? d.unitCost ?? null : null,
          worksiteId: d.worksiteId ?? null,
          requestedByName: d.requestedByName ?? null,
          note: d.note ?? null,
          createdById: req.user!.id,
        },
        include: {
          stockItem: { select: { id: true, name: true, unit: true } },
          worksite: { select: { id: true, ref: true, title: true } },
        },
      });
      return { item: updated, movement };
    });

    res.status(201).json(result);
  }),
);

/* ------------------------------------------------------------------ meta */

stockRouter.get(
  '/meta',
  requireAuth(...FIELD_OFFICE),
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
