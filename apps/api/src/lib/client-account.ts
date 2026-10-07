import { round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { isCreditNoteSale, isPaid } from './consolidated.js';

/**
 * Part d'un virement ENTRANT qui n'est affectée à aucune facture : tout le montant s'il n'est rattaché à rien, le reste s'il n'est
 * rattaché que par parts (ex. 100 000 € dont 87 465,62 € répartis), rien si l'un des liens prend le montant entier (cas historique).
 */
export function txRemaining(tx: { amount: number | null; matches: { amount: number | null }[] }): number {
  const amount = tx.amount ?? 0;
  if (amount <= 0) return 0;
  if (tx.matches.length === 0) return round2(amount);
  if (tx.matches.some((m) => m.amount == null)) return 0;
  return Math.max(0, round2(amount - tx.matches.reduce((s, m) => s + (m.amount ?? 0), 0)));
}

/**
 * Compte d'un CLIENT (miroir du « solde du compte » d'un fournisseur) : ce qui lui est facturé, ce qui reste à encaisser sur ses factures,
 * et l'argent qu'il a versé SANS facture correspondante (acompte à facturer, trop-perçu à rendre) — virements attribués à ce client.
 * solde > 0 : le client doit encore de l'argent ; solde < 0 : crédit du client (à facturer ou à rembourser).
 */
export async function clientAccount(contactId: string) {
  const ledger = await prisma.ledgerEntry.findMany({
    where: { contactId, direction: { in: ['sale', 'credit_note'] }, source: { not: 'demo' } },
    select: { direction: true, ht: true, ttc: true, paymentStatus: true, categoryRaw: true, document: { select: { status: true, paidAmount: true, totalTtc: true } } },
  });
  let invoicedTtc = 0;
  let openTtc = 0;
  for (const e of ledger) {
    const ttc = e.ttc ?? e.ht ?? 0;
    if (e.direction === 'sale') {
      invoicedTtc += ttc;
      if (!isPaid(e.paymentStatus)) {
        const part = e.document && e.document.status === 'partial' ? Math.min(ttc, e.document.paidAmount) : 0; // payée partiellement : seul le reste est dû
        openTtc += ttc - part;
      }
    } else if (isCreditNoteSale(e.categoryRaw)) {
      invoicedTtc += ttc; // notes de crédit : montants négatifs
    }
  }
  const txs = await prisma.bankTransaction.findMany({
    where: { contactId, amount: { gt: 0 } },
    orderBy: { bookingDate: 'asc' },
    select: { id: true, bookingDate: true, bank: true, amount: true, description: true, communication: true, matches: { select: { amount: true } } },
  });
  const unallocated = txs
    .map((t) => ({ id: t.id, date: t.bookingDate, bank: t.bank, amount: t.amount ?? 0, remaining: txRemaining(t), description: t.description ?? t.communication ?? '' }))
    .filter((t) => t.remaining > 0.01);
  const unallocatedTotal = round2(unallocated.reduce((s, t) => s + t.remaining, 0));
  return {
    invoicedTtc: round2(invoicedTtc),
    openTtc: round2(openTtc),
    unallocated,
    unallocatedTotal,
    balance: round2(openTtc - unallocatedTotal),
  };
}
