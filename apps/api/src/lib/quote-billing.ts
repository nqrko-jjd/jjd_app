/**
 * Facturation d'un devis en plusieurs fois (acompte, acomptes suivants, solde) :
 * ce qui a déjà été facturé sur le devis est la somme de ses factures liées (brouillons compris, pour ne jamais facturer deux fois la même part),
 * moins ce qui a été crédité par note de crédit émise. Une facture entièrement créditée ne compte plus.
 */
import { prisma } from '../db.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BilledInvoice { id: string; number: string | null; draftRef: string | null; kind: string; status: string; totalHt: number; netHt: number; vatRate: number | null; date: Date | null }
export interface QuoteBilling { totalHt: number; billedHt: number; remainingHt: number; billedPct: number; invoices: BilledInvoice[] }

export async function quoteBillings(quotes: { id: string; totalHt: number }[]): Promise<Map<string, QuoteBilling>> {
  const out = new Map<string, QuoteBilling>();
  if (!quotes.length) return out;
  const children = await prisma.document.findMany({
    where: { parentId: { in: quotes.map((q) => q.id) }, kind: { in: ['invoice', 'deposit_invoice'] }, status: { not: 'credited' } },
    select: { id: true, parentId: true, number: true, draftRef: true, kind: true, status: true, totalHt: true, vatRate: true, createdAt: true, issuedOn: true, children: { where: { kind: 'credit_note', lockedAt: { not: null } }, select: { totalHt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const q of quotes) {
    const invoices = children.filter((c) => c.parentId === q.id).map((c) => ({
      id: c.id, number: c.number, draftRef: c.draftRef, kind: c.kind, status: c.status, totalHt: c.totalHt, vatRate: c.vatRate, date: c.issuedOn ?? c.createdAt,
      netHt: round2(c.totalHt - c.children.reduce((s, n) => s + Math.abs(n.totalHt ?? 0), 0)),
    }));
    const billedHt = round2(invoices.reduce((s, i) => s + i.netHt, 0));
    const remainingHt = Math.max(0, round2(q.totalHt - billedHt));
    out.set(q.id, { totalHt: q.totalHt, billedHt, remainingHt, billedPct: q.totalHt > 0 ? Math.min(100, Math.round((billedHt / q.totalHt) * 1000) / 10) : 0, invoices });
  }
  return out;
}
