/**
 * Stock de matériaux (dépôt) — distinct du parc d'outillage Bricoloc (routes/materiel.ts)
 * et du catalogue de consommables planifiés par jour de chantier (model Consumable).
 * Ici : de vraies quantités en stock, des bons d'entrée/sortie/inventaire, une valorisation
 * au coût moyen pondéré. Historique de mouvements immuable façon grand livre.
 */
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { stockItemInput, stockMovementInput, stockSupplierInput, round2 } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, FIELD_OFFICE, STAFF } from '../lib/auth.js';

export const stockRouter = Router();

/* ------------------------------------------------------------------ articles */

const itemInclude = {
  units: { orderBy: [{ position: 'asc' as const }, { name: 'asc' as const }] },
  suppliers: {
    orderBy: [{ preferred: 'desc' as const }, { updatedAt: 'desc' as const }],
    include: { contact: { select: { id: true, name: true } } },
  },
} satisfies Prisma.StockItemInclude;

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

function shapeItem<T extends { qty: number; avgCost: number | null; minQty: number | null }>(it: T) {
  return { ...it, value: round2(it.qty * (it.avgCost ?? 0)), low: it.minQty != null && it.qty < it.minQty };
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
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { q, active } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (active !== '0') where.active = true; // par défaut : masque les articles désactivés
    if (q) where.OR = [{ name: { contains: q } }, { category: { contains: q } }, { ref: { contains: q } }, { brand: { contains: q } }];
    const items = await prisma.stockItem.findMany({ where, orderBy: { name: 'asc' }, include: itemInclude });
    res.json({ items: items.map(shapeItem) });
  }),
);

stockRouter.get(
  '/items/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.id }, include: itemInclude });
    if (!item) throw new HttpError(404, 'Article introuvable');
    res.json({ item: shapeItem(item) });
  }),
);

stockRouter.post(
  '/items',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = stockItemInput.parse(req.body);
    checkUnits(d.unit, d.units ?? []);
    const ref = d.ref || (await nextItemRef());
    if (await prisma.stockItem.findUnique({ where: { ref }, select: { id: true } })) throw new HttpError(409, `La référence ${ref} existe déjà`);
    const item = await prisma.stockItem.create({
      data: {
        ref, name: d.name, unit: d.unit, brand: d.brand ?? null, note: d.note ?? null,
        category: d.category ?? null, minQty: d.minQty ?? null,
        units: { create: (d.units ?? []).map((u, i) => ({ name: u.name, factor: u.factor, position: i })) },
      },
      include: itemInclude,
    });
    res.status(201).json({ item: shapeItem(item) });
  }),
);

stockRouter.patch(
  '/items/:id',
  requireAuth(...OFFICE),
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
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const item = await prisma.stockItem.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ item });
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
  requireAuth(...OFFICE),
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
  requireAuth(...OFFICE),
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
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const r = await prisma.stockSupplier.deleteMany({ where: { id: req.params.sid, stockItemId: req.params.id } });
    if (!r.count) throw new HttpError(404, 'Fournisseur introuvable sur cet article');
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ mouvements */

stockRouter.get(
  '/movements',
  requireAuth(...STAFF),
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

/**
 * Bon d'entrée / de sortie / d'inventaire — met à jour la quantité (et le coût moyen sur une entrée).
 * La saisie peut se faire dans une unité alternative de l'article (« 4 sacs ») : la quantité
 * stockée est toujours en unité de base (4 × 25 = 100 kg), le mouvement garde ce qui a été saisi.
 */
stockRouter.post(
  '/movements',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const d = stockMovementInput.parse(req.body);
    if (d.type === 'out' && !d.worksiteId) throw new HttpError(422, 'Chantier requis pour une sortie');
    if (d.type !== 'adjustment' && d.qty <= 0) throw new HttpError(422, 'Quantité invalide');

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId }, include: { units: true } });
      if (!item) throw new HttpError(404, 'Article introuvable');

      const enteredUnit = d.unit?.trim() || null;
      let factor = 1;
      if (enteredUnit && !same(enteredUnit, item.unit)) {
        const u = item.units.find((x) => same(x.name, enteredUnit));
        if (!u) throw new HttpError(422, `Unité « ${enteredUnit} » inconnue pour cet article`);
        factor = u.factor;
      }
      if (d.contactId) {
        if (d.type !== 'in') throw new HttpError(422, 'Un fournisseur ne s’indique que sur une entrée');
        if (!(await tx.contact.findUnique({ where: { id: d.contactId }, select: { id: true } }))) throw new HttpError(422, 'Fournisseur introuvable');
      }

      const baseQty = round2(d.qty * factor);
      const baseCost = d.unitCost != null ? round2(d.unitCost / factor) : null; // coût par unité de base

      let newQty: number;
      let newAvgCost = item.avgCost;
      let storedQty: number; // valeur enregistrée sur le mouvement (toujours positive pour in/out, delta signé pour adjustment)

      if (d.type === 'in') {
        storedQty = baseQty;
        newQty = round2(item.qty + baseQty);
        if (baseCost != null) {
          const oldValue = item.qty * (item.avgCost ?? baseCost);
          newAvgCost = round2((oldValue + baseQty * baseCost) / (newQty || 1));
        }
      } else if (d.type === 'out') {
        storedQty = baseQty;
        newQty = round2(item.qty - baseQty);
      } else {
        // adjustment : baseQty = quantité réelle comptée (cible), pas un delta
        storedQty = round2(baseQty - item.qty);
        newQty = baseQty;
      }

      const updated = await tx.stockItem.update({ where: { id: item.id }, data: { qty: newQty, avgCost: newAvgCost } });
      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: item.id,
          type: d.type,
          qty: storedQty,
          enteredQty: enteredUnit && !same(enteredUnit, item.unit) ? d.qty : null,
          enteredUnit: enteredUnit && !same(enteredUnit, item.unit) ? enteredUnit : null,
          contactId: d.type === 'in' ? d.contactId ?? null : null,
          unitCost: d.type === 'in' ? baseCost : null,
          worksiteId: d.worksiteId ?? null,
          requestedByName: d.requestedByName ?? null,
          note: d.note ?? null,
          createdById: req.user!.id,
        },
        include: {
          stockItem: { select: { id: true, name: true, unit: true } },
          worksite: { select: { id: true, ref: true, title: true } },
          contact: { select: { id: true, name: true } },
        },
      });

      // Dernier prix payé chez ce fournisseur : met à jour sa ligne s'il est déjà lié à l'article.
      if (d.type === 'in' && d.contactId && d.unitCost != null) {
        const unitName = enteredUnit && !same(enteredUnit, item.unit) ? enteredUnit : null;
        await tx.stockSupplier.updateMany({
          where: { stockItemId: item.id, contactId: d.contactId, unitName },
          data: { price: d.unitCost },
        });
      }
      return { item: updated, movement };
    });

    res.status(201).json(result);
  }),
);

/* ------------------------------------------------------------------ meta */

stockRouter.get(
  '/meta',
  requireAuth(...STAFF),
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
