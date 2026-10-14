/**
 * Rattache aux devis les factures importées (TrustUp…) qui n'ont aucun lien avec eux : leur intitulé cite le numéro du devis
 * (« Facture d'acompte pour devis D2025-237 », « Etat d'avancement n° 1 suivant devis D2025-237 »).
 * Seules les factures qui citent UN SEUL devis sont rattachées ; celles qui en citent plusieurs (« D2025-277 / D2025-281 »)
 * sont listées pour un rattachement à la main, car une facture n'a qu'un devis parent.
 */
import { prisma } from '../db.js';

const QUOTE_NUMBER = /\bD\d{4}-\d{2,4}\b/g;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LinkPlan {
  links: { invoiceId: string; invoiceNumber: string | null; quoteId: string; quoteNumber: string; netHt: number }[];
  ambiguous: { invoiceNumber: string | null; title: string | null; quotes: string[] }[];
  unknownQuote: { invoiceNumber: string | null; title: string | null; quote: string }[];
  /** Devis dont les factures dépassent le devis (> 102 %) ou dont le total est nul/négatif : rien n'est rattaché, à vérifier à la main. */
  review: { quoteNumber: string; totalHt: number; addedHt: number; afterPct: number; invoices: string[] }[];
  perQuote: { quoteNumber: string; totalHt: number; alreadyBilledHt: number; addedHt: number; afterPct: number }[];
}

export async function planInvoiceQuoteLinks(): Promise<LinkPlan> {
  const invoices = await prisma.document.findMany({
    where: { kind: { in: ['invoice', 'deposit_invoice'] }, direction: 'sale', parentId: null, status: { not: 'credited' }, title: { not: null } },
    select: { id: true, number: true, title: true, totalHt: true, worksiteId: true, children: { where: { kind: 'credit_note' }, select: { totalHt: true } } },
  });
  const quotes = await prisma.document.findMany({ where: { kind: 'quote', number: { not: null } }, select: { id: true, number: true, totalHt: true, worksiteId: true } });
  const byNumber = new Map(quotes.map((q) => [q.number!, q]));
  const plan: LinkPlan = { links: [], ambiguous: [], unknownQuote: [], review: [], perQuote: [] };
  for (const inv of invoices) {
    const cited = [...new Set(inv.title!.match(QUOTE_NUMBER) ?? [])];
    if (!cited.length) continue;
    if (cited.length > 1) { plan.ambiguous.push({ invoiceNumber: inv.number, title: inv.title, quotes: cited }); continue; }
    const q = byNumber.get(cited[0]!);
    if (!q) { plan.unknownQuote.push({ invoiceNumber: inv.number, title: inv.title, quote: cited[0]! }); continue; }
    if (inv.worksiteId && q.worksiteId && inv.worksiteId !== q.worksiteId) { plan.ambiguous.push({ invoiceNumber: inv.number, title: `${inv.title} (chantier différent de celui du devis)`, quotes: cited }); continue; }
    plan.links.push({ invoiceId: inv.id, invoiceNumber: inv.number, quoteId: q.id, quoteNumber: q.number!, netHt: round2(inv.totalHt - inv.children.reduce((s, c) => s + Math.abs(c.totalHt ?? 0), 0)) });
  }
  const existing = await prisma.document.findMany({ where: { parentId: { in: [...new Set(plan.links.map((l) => l.quoteId))] }, kind: { in: ['invoice', 'deposit_invoice'] }, status: { not: 'credited' } }, select: { parentId: true, totalHt: true } });
  for (const quoteId of new Set(plan.links.map((l) => l.quoteId))) {
    const q = quotes.find((x) => x.id === quoteId)!;
    const already = round2(existing.filter((e) => e.parentId === quoteId).reduce((s, e) => s + e.totalHt, 0));
    const added = round2(plan.links.filter((l) => l.quoteId === quoteId).reduce((s, l) => s + l.netHt, 0));
    const afterPct = q.totalHt > 0 ? Math.round(((already + added) / q.totalHt) * 1000) / 10 : 0;
    if (q.totalHt <= 0 || afterPct > 102) {
      plan.review.push({ quoteNumber: q.number!, totalHt: q.totalHt, addedHt: added, afterPct, invoices: plan.links.filter((l) => l.quoteId === quoteId).map((l) => l.invoiceNumber ?? '(brouillon)') });
      plan.links = plan.links.filter((l) => l.quoteId !== quoteId);
      continue;
    }
    plan.perQuote.push({ quoteNumber: q.number!, totalHt: q.totalHt, alreadyBilledHt: already, addedHt: added, afterPct });
  }
  return plan;
}

export async function applyInvoiceQuoteLinks(plan: LinkPlan): Promise<number> {
  let n = 0;
  for (const l of plan.links) {
    const r = await prisma.document.updateMany({ where: { id: l.invoiceId, parentId: null }, data: { parentId: l.quoteId } });
    n += r.count;
  }
  return n;
}
