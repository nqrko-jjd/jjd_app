import { round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { allocationSnapshot } from './bank-allocation.js';
import { isPaid } from './consolidated.js';

export async function supplierAccounts() {
  const [ledger, txs, snapshot, contacts] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { direction: { in: ['purchase', 'credit_note'] }, source: { not: 'demo' }, OR: [{ documentId: null }, { direction: 'purchase' }] }, include: { contact: { select: { id: true, name: true } } } }),
    prisma.bankTransaction.findMany({ where: { amount: { lt: 0 } }, include: { contact: { select: { id: true, name: true } }, matches: { include: { ledgerEntry: { select: { contactId: true, supplierName: true, direction: true } } } } } }),
    allocationSnapshot(),
    prisma.contact.findMany({ where: { type: { in: ['supplier', 'both'] } }, select: { id: true, name: true } }),
  ]);
  const groups = new Map<string, { id: string; contactId: string | null; name: string; openTtc: number; overdue: number; dueSoon: number; credits: number; unallocatedTotal: number; balance: number; nextDue: Date | null; invoices: { id: string; number: string | null; date: Date | null; dueDate: Date | null; total: number; paid: number; remaining: number }[]; advances: { id: string; date: Date | null; bank: string | null; amount: number; remaining: number }[] }>();
  const group = (id: string | null, name: string) => {
    const key = id ?? `name:${name.trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { id: key, contactId: id, name, openTtc: 0, overdue: 0, dueSoon: 0, credits: 0, unallocatedTotal: 0, balance: 0, nextDue: null, invoices: [], advances: [] });
    return groups.get(key)!;
  };
  for (const c of contacts) group(c.id, c.name);
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T00:00:00Z');
  const soon = new Date(today.getTime() + 30 * 86400000);
  for (const l of ledger) {
    // Sales credit notes do not belong to the supplier account.
    if (l.direction === 'credit_note' && /vente/i.test(l.categoryRaw ?? '')) continue;
    const g = group(l.contactId, l.contact?.name ?? l.supplierName ?? 'Fournisseur à identifier');
    const total = Math.abs(l.ttc ?? l.ht);
    if (l.direction === 'credit_note') { g.credits += total; continue; }
    const paid = snapshot.ledgerPaid.has(l.id) ? snapshot.ledgerPaid.get(l.id)! : isPaid(l.paymentStatus) ? total : 0;
    const remaining = round2(Math.max(0, total - paid));
    g.openTtc += remaining;
    g.invoices.push({ id: l.id, number: l.docNumber, date: l.date, dueDate: l.dueDate, total, paid: round2(paid), remaining });
    if (remaining > 0.01 && l.dueDate) {
      if (l.dueDate < today) g.overdue += remaining;
      else if (l.dueDate < soon) g.dueSoon += remaining;
      if (!g.nextDue || l.dueDate < g.nextDue) g.nextDue = l.dueDate;
    }
  }
  for (const t of txs) {
    let cid = t.contactId;
    let name = t.contact?.name;
    if (!cid) {
      const suppliers = t.matches.filter(m => m.ledgerEntry?.direction === 'purchase').map(m => m.ledgerEntry!);
      const ids = [...new Set(suppliers.map(l => l.contactId))];
      if (ids.length !== 1 || !ids[0] || suppliers.length !== t.matches.length) continue;
      cid = ids[0]; name = contacts.find(c => c.id === cid)?.name ?? suppliers[0]?.supplierName ?? undefined;
    }
    const remaining = round2(Math.max(0, Math.abs(t.amount ?? 0) - (snapshot.transactions.get(t.id) ?? 0)));
    if (remaining <= 0.01) continue;
    const g = group(cid, name ?? 'Fournisseur');
    g.unallocatedTotal += remaining;
    g.advances.push({ id: t.id, date: t.bookingDate, bank: t.bank, amount: Math.abs(t.amount ?? 0), remaining });
  }
  return [...groups.values()].map(g => ({ ...g, openTtc: round2(g.openTtc), overdue: round2(g.overdue), dueSoon: round2(g.dueSoon), credits: round2(g.credits), unallocatedTotal: round2(g.unallocatedTotal), balance: round2(g.openTtc - g.credits - g.unallocatedTotal), invoices: g.invoices.sort((a,b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)) })).sort((a,b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
}
