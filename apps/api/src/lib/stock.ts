import type { Prisma } from '@prisma/client';
import { round2, type StockMovementInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { HttpError } from './http.js';

export const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** Facteur de conversion d'une unité de saisie vers l'unité de base de l'article (1 si base/vide). */
export function unitFactor(item: { unit: string; units: { name: string; factor: number }[] }, unit: string | null | undefined): number {
  const u = unit?.trim();
  if (!u || sameName(u, item.unit)) return 1;
  const found = item.units.find((x) => sameName(x.name, u));
  if (!found) throw new HttpError(422, `Unité « ${u} » inconnue pour cet article`);
  return found.factor;
}

/**
 * Bon d'entrée / de sortie / d'inventaire — met à jour la quantité (et le coût moyen sur une entrée).
 * La saisie peut se faire dans une unité alternative de l'article (« 4 sacs ») : la quantité
 * stockée est toujours en unité de base (4 × 25 = 100 kg), le mouvement garde ce qui a été saisi.
 * Partagé entre la saisie manuelle, le scan, la validation d'une préparation et une réception.
 */
export async function applyStockMovement(tx: Prisma.TransactionClient, d: StockMovementInput, userId: string | null) {
  if (d.type === 'out' && !d.worksiteId) throw new HttpError(422, 'Chantier requis pour une sortie');
  if (d.type !== 'adjustment' && d.qty <= 0) throw new HttpError(422, 'Quantité invalide');

  const item = await tx.stockItem.findUnique({ where: { id: d.stockItemId }, include: { units: true } });
  if (!item) throw new HttpError(404, 'Article introuvable');

  const enteredUnit = d.unit?.trim() || null;
  const factor = unitFactor(item, enteredUnit);
  const customUnit = !!enteredUnit && !sameName(enteredUnit, item.unit);
  if (d.contactId) {
    if (d.type !== 'in') throw new HttpError(422, 'Un fournisseur ne s’indique que sur une entrée');
    if (!(await tx.contact.findUnique({ where: { id: d.contactId }, select: { id: true } }))) throw new HttpError(422, 'Fournisseur introuvable');
  }

  const baseQty = round2(d.qty * factor);
  const baseCost = d.unitCost != null ? round2(d.unitCost / factor) : null; // coût par unité de base

  let newQty: number;
  let newAvgCost = item.avgCost;
  let storedQty: number; // toujours positive pour in/out, delta signé pour adjustment

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
      enteredQty: customUnit ? d.qty : null,
      enteredUnit: customUnit ? enteredUnit : null,
      contactId: d.type === 'in' ? d.contactId ?? null : null,
      unitCost: d.type === 'in' ? baseCost : null,
      worksiteId: d.worksiteId ?? null,
      requestedByName: d.requestedByName ?? null,
      note: d.note ?? null,
      createdById: userId,
    },
    include: {
      stockItem: { select: { id: true, name: true, unit: true } },
      worksite: { select: { id: true, ref: true, title: true } },
      contact: { select: { id: true, name: true } },
    },
  });

  // Dernier prix payé chez ce fournisseur : met à jour sa ligne s'il est déjà lié à l'article.
  if (d.type === 'in' && d.contactId && d.unitCost != null) {
    await tx.stockSupplier.updateMany({
      where: { stockItemId: item.id, contactId: d.contactId, unitName: customUnit ? enteredUnit : null },
      data: { price: d.unitCost },
    });
  }
  return { item: updated, movement };
}

/**
 * Retrouve l'article d'un code scanné : code-barres enregistré (EAN du sac…) ou étiquette
 * interne « ART-0003 » / « ART-0003:sac » (référence + conditionnement). Renvoie l'article avec
 * ses unités et l'unité éventuelle (null = unité de base).
 */
export async function resolveStockCode(code: string) {
  const withUnits = { units: true } as const;
  const bc = await prisma.stockBarcode.findUnique({ where: { code }, include: { stockItem: { include: withUnits } } });
  if (bc?.stockItem.active) return { item: bc.stockItem, unitName: bc.unitName, via: 'barcode' as const };

  const m = code.match(/^(.+?)(?::(.+))?$/);
  const ref = (m?.[1] ?? code).trim().toUpperCase();
  const item = await prisma.stockItem.findFirst({ where: { ref, active: true }, include: withUnits });
  if (!item) return null;
  const wanted = m?.[2]?.trim() || null;
  const unitName = wanted && !sameName(wanted, item.unit) ? item.units.find((u) => sameName(u.name, wanted))?.name ?? null : null;
  return { item, unitName, via: 'ref' as const };
}
