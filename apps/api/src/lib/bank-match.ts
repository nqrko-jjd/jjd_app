/**
 * Rapprochement automatique : relie une transaction bancaire à une écriture
 * du grand livre (LedgerEntry — ventes et achats).
 *
 *  - « strong » : communication structurée identique
 *  - « good »   : même montant (± 2 c) + date proche (± 10 j) + sens cohérent,
 *                 et une seule écriture candidate
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export interface TxLite {
  id: string;
  amount: number | null;
  bookingDate: Date | null;
  structuredComm: string | null;
  counterpartyName: string | null;
  side: string | null; // "in" | "out"
}
export interface LedgerLite {
  id: string;
  ttc: number | null;
  ht: number;
  date: Date | null;
  direction: string; // sale | purchase | credit_note
  bankComm: string | null;
  supplierName: string | null;
  contactName: string | null;
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const DAY = 86_400_000;

// mots trop génériques pour discriminer une contrepartie
const STOP = new Set(['acp', 'sprl', 'bvba', 'srl', 'nv', 'sa', 'the', 'les', 'des', 'and', 'ets', 'via']);
function nameOverlap(a: string, b: string): boolean {
  const keep = (w: string) => w.length > 3 && !STOP.has(w);
  const wa = new Set(norm(a).split(/\s+/).filter(keep));
  return norm(b).split(/\s+/).filter(keep).some((w) => wa.has(w));
}

function sideMatches(tx: TxLite, l: LedgerLite): boolean {
  if (l.direction === 'sale') return tx.side !== 'out'; // encaissement
  if (l.direction === 'purchase') return tx.side !== 'in'; // décaissement
  return true; // note de crédit : les deux sens possibles
}

const amountOf = (l: LedgerLite) => Math.abs(l.ttc ?? l.ht ?? 0);

/** Cherche la meilleure écriture pour une transaction. */
export function pickMatch(tx: TxLite, ledgers: LedgerLite[]): { ledgerId: string; confidence: 'strong' | 'good' } | null {
  const amt = Math.abs(tx.amount ?? 0);
  if (!amt) return null;

  // 1. communication structurée
  if (tx.structuredComm && tx.structuredComm.length >= 10) {
    const hit = ledgers.filter((l) => digits(l.bankComm) && digits(l.bankComm) === tx.structuredComm);
    if (hit.length === 1) return { ledgerId: hit[0]!.id, confidence: 'strong' };
  }

  // 2. montant + date + sens
  const near = ledgers.filter((l) => {
    if (!sideMatches(tx, l)) return false;
    if (Math.abs(amountOf(l) - amt) > 0.02) return false;
    if (tx.bookingDate && l.date && Math.abs(tx.bookingDate.getTime() - l.date.getTime()) > 10 * DAY) return false;
    return true;
  });
  if (near.length === 1) return { ledgerId: near[0]!.id, confidence: 'good' };

  // 3. montant + date + nom de contrepartie (départage plusieurs candidats)
  if (near.length > 1 && tx.counterpartyName) {
    const byName = near.filter(
      (l) => nameOverlap(tx.counterpartyName!, l.supplierName ?? '') || nameOverlap(tx.counterpartyName!, l.contactName ?? ''),
    );
    if (byName.length === 1) return { ledgerId: byName[0]!.id, confidence: 'good' };
  }
  return null;
}

/**
 * Rapproche automatiquement les transactions non liées.
 * @returns nombre de rapprochements créés, par niveau de confiance.
 */
export async function autoMatchAll(
  opts: { onlyUnmatched?: boolean; txFilter?: Prisma.BankTransactionWhereInput } = {},
): Promise<{ strong: number; good: number; scanned: number }> {
  const txs = await prisma.bankTransaction.findMany({
    where: { ...(opts.onlyUnmatched === false ? {} : { matchedLedgerId: null }), ...opts.txFilter },
    select: { id: true, amount: true, bookingDate: true, structuredComm: true, counterpartyName: true, side: true },
    orderBy: { bookingDate: 'desc' },
  });

  const ledgerRows = await prisma.ledgerEntry.findMany({
    select: {
      id: true, ttc: true, ht: true, date: true, direction: true, bankComm: true,
      supplierName: true, contact: { select: { name: true } },
    },
  });
  const ledgers: LedgerLite[] = ledgerRows.map((l) => ({
    id: l.id, ttc: l.ttc, ht: l.ht, date: l.date, direction: l.direction, bankComm: l.bankComm,
    supplierName: l.supplierName, contactName: l.contact?.name ?? null,
  }));

  // index par montant arrondi pour éviter O(n²) complet
  const byAmount = new Map<number, LedgerLite[]>();
  for (const l of ledgers) {
    const k = Math.round(amountOf(l) * 100);
    (byAmount.get(k) ?? byAmount.set(k, []).get(k)!).push(l);
  }
  const commIndex = ledgers.filter((l) => digits(l.bankComm).length >= 10);

  let strong = 0;
  let good = 0;
  for (const tx of txs) {
    const amt = Math.round(Math.abs(tx.amount ?? 0) * 100);
    const pool = [
      ...(byAmount.get(amt) ?? []),
      ...(byAmount.get(amt - 1) ?? []),
      ...(byAmount.get(amt + 1) ?? []),
      ...(byAmount.get(amt - 2) ?? []),
      ...(byAmount.get(amt + 2) ?? []),
      ...commIndex,
    ];
    const uniq = [...new Map(pool.map((l) => [l.id, l])).values()];
    const m = pickMatch(tx as TxLite, uniq);
    if (!m) continue;
    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: { matchedLedgerId: m.ledgerId, matchConfidence: m.confidence, matchedAt: new Date() },
    });
    if (m.confidence === 'strong') strong++; else good++;
  }
  return { strong, good, scanned: txs.length };
}
