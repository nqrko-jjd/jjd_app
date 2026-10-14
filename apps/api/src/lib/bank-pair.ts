import type { Prisma } from '@prisma/client';
import { round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { insensitive } from './search.js';

/**
 * « Lier un remboursement » : une entrée et une sortie du même montant qui s'annulent (double
 * paiement d'un client remboursé, avoir fournisseur reversé…). Aucune facture n'est concernée :
 * on ne passe donc PAS par BankTransactionMatch (qui additionne les montants en valeur absolue et
 * fausserait le « payé » de la facture) — chaque transaction pointe simplement vers l'autre.
 */

/** Écart toléré entre les deux montants (arrondi au centime). */
export const PAIR_TOLERANCE = 0.01;

/** Une transaction encore « à rapprocher » : ni facture liée, ni remboursement lié. */
export const UNRECONCILED: Prisma.BankTransactionWhereInput = { matches: { none: {} }, pairedTxId: null };
/** Une transaction rapprochée : au moins une facture, ou un remboursement lié. */
export const RECONCILED: Prisma.BankTransactionWhereInput = { OR: [{ matches: { some: {} } }, { pairedTxId: { not: null } }] };

interface PairableTx {
  id: string;
  amount: number | null;
  pairedTxId: string | null;
  _count: { matches: number };
}

/** Raison pour laquelle deux transactions ne peuvent pas être liées, ou null si c'est possible. */
export function pairRefusal(a: PairableTx, b: PairableTx): string | null {
  if (a.id === b.id) return 'Choisissez deux transactions différentes.';
  const x = a.amount ?? 0;
  const y = b.amount ?? 0;
  if (x === 0 || y === 0 || Math.sign(x) === Math.sign(y)) return 'Il faut une entrée et une sortie (un paiement et son remboursement).';
  if (Math.abs(round2(x + y)) > PAIR_TOLERANCE) return 'Les deux montants doivent être identiques.';
  if (a.pairedTxId || b.pairedTxId) return 'Une de ces transactions est déjà liée à un remboursement.';
  if (a._count.matches || b._count.matches) return 'Une de ces transactions est déjà rapprochée d’une facture : détachez-la d’abord.';
  return null;
}

const pairSelect = { id: true, amount: true, pairedTxId: true, _count: { select: { matches: true } } } as const;

export async function pairTransactions(id: string, otherId: string, note?: string | null) {
  return prisma.$transaction(async (db) => {
    const [a, b] = await Promise.all([
      db.bankTransaction.findUnique({ where: { id }, select: pairSelect }),
      db.bankTransaction.findUnique({ where: { id: otherId }, select: pairSelect }),
    ]);
    if (!a || !b) throw new HttpError(404, 'Transaction introuvable');
    const refusal = pairRefusal(a, b);
    if (refusal) throw new HttpError(409, refusal);
    const data = { pairNote: note?.trim() || null, pairedAt: new Date(), matchConfidence: 'manual', matchedAt: new Date() };
    await db.bankTransaction.update({ where: { id: a.id }, data: { ...data, pairedTxId: b.id } });
    await db.bankTransaction.update({ where: { id: b.id }, data: { ...data, pairedTxId: a.id } });
    return { id: a.id, pairedTxId: b.id };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

/** Défait la paire des deux côtés (les deux transactions repassent « à rapprocher »). */
export async function unpairTransaction(id: string) {
  return prisma.$transaction(async (db) => {
    const tx = await db.bankTransaction.findUnique({ where: { id }, select: { id: true, pairedTxId: true } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');
    if (!tx.pairedTxId) throw new HttpError(409, 'Cette transaction n’est liée à aucun remboursement.');
    const clear = { pairedTxId: null, pairNote: null, pairedAt: null, matchConfidence: null, matchedAt: null };
    await db.bankTransaction.updateMany({ where: { id: { in: [tx.id, tx.pairedTxId] } }, data: clear });
    return { ids: [tx.id, tx.pairedTxId] };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

/**
 * Transactions de sens opposé et de même montant, pas encore rapprochées — les plus proches en date
 * d'abord. Avec `q`, recherche libre (nom, communication) sans filtre de date.
 */
export async function pairSuggestions(id: string, q?: string) {
  const tx = await prisma.bankTransaction.findUnique({ where: { id }, select: { id: true, amount: true, bookingDate: true } });
  if (!tx) throw new HttpError(404, 'Transaction introuvable');
  const amount = tx.amount ?? 0;
  if (amount === 0) return { items: [] };
  const target = -amount;
  const words = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const day = 86400000;
  const window = !words.length && tx.bookingDate
    ? { bookingDate: { gte: new Date(tx.bookingDate.getTime() - 180 * day), lte: new Date(tx.bookingDate.getTime() + 180 * day) } }
    : {};
  const rows = await prisma.bankTransaction.findMany({
    where: {
      id: { not: tx.id },
      ...UNRECONCILED,
      amount: { gte: target - PAIR_TOLERANCE, lte: target + PAIR_TOLERANCE },
      ...window,
      AND: words.map((w) => ({ OR: [
        { counterpartyName: { contains: w, ...insensitive } },
        { description: { contains: w, ...insensitive } },
        { communication: { contains: w, ...insensitive } },
      ] })),
    },
    select: { id: true, bookingDate: true, bank: true, amount: true, counterpartyName: true, communication: true, description: true },
    take: 30,
  });
  const ref = tx.bookingDate?.getTime() ?? Date.now();
  rows.sort((r1, r2) => Math.abs((r1.bookingDate?.getTime() ?? 0) - ref) - Math.abs((r2.bookingDate?.getTime() ?? 0) - ref));
  return { items: rows.slice(0, 10) };
}
