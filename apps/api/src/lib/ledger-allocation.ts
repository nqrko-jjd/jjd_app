/**
 * Répartition d'UNE facture d'achat entre plusieurs chantiers : une seule fiche, un seul PDF, un seul paiement, un seul rapprochement bancaire ;
 * seule la part de coût par chantier est détaillée (table LedgerAllocation). Les calculs de coût par chantier appellent `expandAllocations`
 * pour retrouver une « ligne virtuelle » par chantier (voir worksite-margin.ts, analytics.ts, consolidated.ts).
 */
import type { Prisma } from '@prisma/client';
import { HttpError } from './http.js';

export interface AllocPart { worksiteId: string; ht: number }
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Parts saisies (montants HT en valeur absolue) → parts à enregistrer : un même chantier saisi deux fois est cumulé, le signe suit celui de
 * l'écriture (une note de crédit peut être stockée en négatif), et la somme doit retomber sur le HT de l'écriture (à 2 centimes près).
 * Moins de deux chantiers distincts : pas de répartition (liste vide).
 */
export function normalizeParts(entryHt: number, input: { worksiteId: string; ht: number }[]): AllocPart[] {
  const merged = new Map<string, number>();
  for (const p of input) {
    if (!p.worksiteId) throw new HttpError(422, 'Chaque part de la répartition doit avoir un chantier.');
    if (!Number.isFinite(p.ht) || Math.abs(p.ht) < 0.005) throw new HttpError(422, 'Chaque part de la répartition doit avoir un montant HT.');
    merged.set(p.worksiteId, r2((merged.get(p.worksiteId) ?? 0) + Math.abs(p.ht)));
  }
  if (merged.size < 2) return [];
  const total = r2([...merged.values()].reduce((a, n) => a + n, 0));
  if (Math.abs(total - Math.abs(entryHt)) > 0.02) {
    throw new HttpError(422, `La somme des parts (${total.toFixed(2)} €) doit égaler le HT de la facture (${Math.abs(entryHt).toFixed(2)} €).`);
  }
  const sign = entryHt < 0 ? -1 : 1;
  // arrondi : l'écart éventuel (≤ 2 centimes) est reporté sur la plus grosse part pour que la somme soit EXACTEMENT le HT
  const parts = [...merged].map(([worksiteId, ht]) => ({ worksiteId, ht }));
  const gap = r2(Math.abs(entryHt) - total);
  if (gap) { const big = parts.reduce((m, p) => (p.ht > m.ht ? p : m), parts[0]!); big.ht = r2(big.ht + gap); }
  return parts.map((p) => ({ worksiteId: p.worksiteId, ht: r2(sign * p.ht) }));
}

/** Chantier principal d'une répartition : la plus grosse part (sert à l'affichage et aux filtres qui ne connaissent pas les parts). */
export const mainWorksite = (parts: AllocPart[]): string | null =>
  parts.length ? parts.reduce((m, p) => (Math.abs(p.ht) > Math.abs(m.ht) ? p : m), parts[0]!).worksiteId : null;

/** Remplace les parts d'une écriture (liste vide = plus de répartition) ; à appeler dans une transaction. */
export async function replaceAllocations(tx: Prisma.TransactionClient, entryId: string, parts: AllocPart[]): Promise<void> {
  await tx.ledgerAllocation.deleteMany({ where: { ledgerEntryId: entryId } });
  if (!parts.length) return;
  await tx.ledgerAllocation.createMany({ data: parts.map((p, i) => ({ ledgerEntryId: entryId, worksiteId: p.worksiteId, ht: p.ht, position: i })) });
  await tx.ledgerEntry.update({ where: { id: entryId }, data: { worksiteId: mainWorksite(parts) } });
}

/**
 * Une écriture répartie compte pour chaque chantier à hauteur de sa part : on la remplace par une « ligne virtuelle » par part
 * (même écriture, `worksiteId` et `ht` de la part). Les écritures sans répartition passent telles quelles.
 */
export function expandAllocations<T extends { worksiteId: string | null; ht: number; allocations?: AllocPart[] | null }>(rows: T[]): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (r.allocations?.length) for (const a of r.allocations) out.push({ ...r, worksiteId: a.worksiteId, ht: a.ht, allocations: undefined });
    else out.push(r);
  }
  return out;
}

/** Sélection Prisma des parts, à ajouter aux lectures de coûts par chantier. */
export const allocationSelect = { select: { worksiteId: true, ht: true }, orderBy: { position: 'asc' as const } };
