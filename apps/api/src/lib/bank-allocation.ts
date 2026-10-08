import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

const cents = (n: number) => Math.round(Math.abs(n) * 100);
export interface AllocationLine {
  id: string; transactionId: string; invoiceId: string;
  transactionTotal: number; invoiceTotal: number; amount: number | null;
}

/** Explicit shares are authoritative. Legacy links consume only the remaining invoice/payment. */
export function allocateLines(lines: AllocationLine[]) {
  const amounts = new Map<string, number>();
  const invoices = new Map<string, number>();
  const transactions = new Map<string, number>();
  for (const line of [...lines.filter(l => l.amount != null), ...lines.filter(l => l.amount == null)]) {
    const paid = invoices.get(line.invoiceId) ?? 0;
    const used = transactions.get(line.transactionId) ?? 0;
    const amount = line.amount != null ? cents(line.amount) : Math.max(0, Math.min(cents(line.invoiceTotal) - paid, cents(line.transactionTotal) - used));
    amounts.set(line.id, amount / 100);
    invoices.set(line.invoiceId, paid + amount);
    transactions.set(line.transactionId, used + amount);
  }
  return { amounts, invoices: new Map([...invoices].map(([id,n]) => [id,n/100])), transactions: new Map([...transactions].map(([id,n]) => [id,n/100])) };
}

export async function allocationSnapshot(db: Prisma.TransactionClient = prisma) {
  const matches = await db.bankTransactionMatch.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { bankTransaction: true, ledgerEntry: true, document: true },
  });
  const numbers = matches.flatMap(m => m.ledgerEntry?.direction === 'sale' && m.ledgerEntry.docNumber ? [m.ledgerEntry.docNumber] : []);
  const docs = numbers.length ? await db.document.findMany({ where: { number: { in: numbers }, kind: { in: ['invoice', 'deposit_invoice'] } }, select: { id: true, number: true, contactId: true, totalTtc: true } }) : [];
  const keyFor = (m: typeof matches[number]) => {
    const l = m.ledgerEntry;
    const twins = l?.direction === 'sale' ? docs.filter(d => d.number === l.docNumber && (!l.contactId || d.contactId === l.contactId)) : [];
    const id = m.documentId ?? l?.documentId ?? (twins.length === 1 ? twins[0]!.id : null);
    return id ? `document:${id}` : `ledger:${m.ledgerEntryId}`;
  };
  const result = allocateLines(matches.map(m => ({ id: m.id, transactionId: m.bankTransactionId, invoiceId: keyFor(m), transactionTotal: m.bankTransaction.amount ?? 0, invoiceTotal: m.document?.totalTtc ?? m.ledgerEntry?.ttc ?? m.ledgerEntry?.ht ?? 0, amount: m.amount })));
  const ledgerPaid = new Map<string, number>();
  const docPaid = new Map<string, number>();
  for (const m of matches) {
    const key = keyFor(m);
    if (m.ledgerEntryId) ledgerPaid.set(m.ledgerEntryId, result.invoices.get(key) ?? 0);
    if (key.startsWith('document:')) docPaid.set(key.slice(9), result.invoices.get(key) ?? 0);
  }
  return { ...result, matches, ledgerPaid, docPaid, invoiceKeys: new Map(matches.map(m => [m.id, keyFor(m)])) };
}

/** Freeze inferred historical shares before any edit, so deleting a link cannot move money. */
export async function freezeLegacyAllocations(db: Prisma.TransactionClient, target: { transactionId: string; ledgerId?: string | null; documentId?: string | null } | { transactionId: string; ledgerId?: string | null; documentId?: string | null }[]) {
  const snapshot = await allocationSnapshot(db);
  const targets = Array.isArray(target) ? target : [target];
  const transactions = new Set(targets.map(t => t.transactionId));
  const invoices = new Set(snapshot.matches.filter(m => targets.some(t => t.ledgerId && m.ledgerEntryId === t.ledgerId || t.documentId && snapshot.invoiceKeys.get(m.id) === `document:${t.documentId}`)).map(m => snapshot.invoiceKeys.get(m.id)!));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const m of snapshot.matches) {
      const key = snapshot.invoiceKeys.get(m.id)!;
      if (transactions.has(m.bankTransactionId) || invoices.has(key)) {
        if (!transactions.has(m.bankTransactionId)) { transactions.add(m.bankTransactionId); expanded = true; }
        if (!invoices.has(key)) { invoices.add(key); expanded = true; }
      }
    }
  }
  for (const m of snapshot.matches) if (m.amount == null && transactions.has(m.bankTransactionId)) await db.bankTransactionMatch.update({ where: { id: m.id }, data: { amount: snapshot.amounts.get(m.id) ?? 0 } });
  return snapshot;
}
