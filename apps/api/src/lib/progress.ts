/**
 * États d'avancement d'un devis : à chaque état, le bureau saisit l'avancement CUMULÉ (%) de chaque ligne du devis ; le montant de l'état =
 * total de la ligne × (cumulé − cumulé de l'état précédent). « Facturer » crée une facture brouillon liée au devis, avec la déduction
 * des acomptes déjà facturés AU PRORATA (acomptes ÷ total du devis, appliqué au montant de l'état).
 */
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { quoteBillings } from './quote-billing.js';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** AV-2026-277-1 : année et numéro du devis (D2026-277), puis rang de l'état. */
export function statementNumber(quote: { number: string | null; draftRef: string | null }, seq: number): string {
  const m = /^D(\d{4})-(\d+)$/.exec(quote.number ?? '');
  const base = m ? `${m[1]}-${Number(m[2])}` : `${new Date().getFullYear()}-${(quote.number ?? quote.draftRef ?? 'x').replace(/\D/g, '') || 'x'}`;
  return `AV-${base}-${seq}`;
}

export interface QuoteItemLine { id: string; position: number; label: string; qty: number; unit: string | null; unitPriceHt: number; discountPct: number; vatRate: number; totalHt: number }

export async function quoteItems(quoteId: string): Promise<QuoteItemLine[]> {
  const lines = await prisma.documentLine.findMany({ where: { documentId: quoteId, kind: 'item' }, orderBy: { position: 'asc' } });
  return lines.map((l) => ({ id: l.id, position: l.position, label: l.label, qty: l.qty, unit: l.unit, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct, vatRate: l.vatRate, totalHt: l.totalHt }));
}

/** Part des acomptes déjà facturés dans le devis (0–1) : sert à déduire les acomptes au prorata de chaque état. */
export async function depositRatio(quote: { id: string; totalHt: number }): Promise<number> {
  const b = (await quoteBillings([quote])).get(quote.id);
  if (!b || quote.totalHt <= 0) return 0;
  const deposits = b.invoices.filter((i) => i.kind === 'deposit_invoice').reduce((s, i) => s + i.netHt, 0);
  return Math.min(1, Math.max(0, deposits / quote.totalHt));
}

/** Remet d'équerre les états dont la facture brouillon a été supprimée depuis (ils redeviennent « validé »). */
export async function reconcileInvoices(quoteId: string) {
  const invoiced = await prisma.progressStatement.findMany({ where: { quoteId, status: 'invoiced', invoiceId: { not: null } } });
  for (const st of invoiced) {
    const inv = await prisma.document.findUnique({ where: { id: st.invoiceId! }, select: { id: true } });
    if (!inv) await prisma.progressStatement.update({ where: { id: st.id }, data: { status: 'validated', invoiceId: null } });
  }
}

export async function loadProgress(quoteId: string) {
  const quote = await prisma.document.findUnique({ where: { id: quoteId }, select: { id: true, kind: true, number: true, draftRef: true, status: true, lockedAt: true, totalHt: true, vatRate: true, title: true, worksite: { select: { id: true, ref: true, title: true } }, contact: { select: { id: true, name: true } } } });
  if (!quote) throw new HttpError(404, 'Devis introuvable');
  if (quote.kind !== 'quote') throw new HttpError(422, 'Les états d’avancement se font sur un devis');
  await reconcileInvoices(quoteId);
  const [items, statements, ratio] = await Promise.all([
    quoteItems(quoteId),
    prisma.progressStatement.findMany({ where: { quoteId }, orderBy: { seq: 'asc' }, include: { lines: true } }),
    depositRatio(quote),
  ]);
  const invoices = statements.some((s) => s.invoiceId)
    ? await prisma.document.findMany({ where: { id: { in: statements.map((s) => s.invoiceId).filter(Boolean) as string[] } }, select: { id: true, number: true, draftRef: true, status: true } })
    : [];
  return {
    quote, items, depositRatio: round2(ratio * 100) / 100, quoteTotalHt: quote.totalHt,
    statements: statements.map((s) => ({
      id: s.id, seq: s.seq, number: s.number, status: s.status, invoiceId: s.invoiceId, createdAt: s.createdAt, validatedAt: s.validatedAt,
      invoice: invoices.find((i) => i.id === s.invoiceId) ?? null,
      totalHt: round2(s.lines.reduce((t, l) => t + l.amountHt, 0)),
      lines: s.lines.map((l) => ({ quoteLineId: l.quoteLineId, cumulativePct: l.cumulativePct, amountHt: l.amountHt })),
    })),
  };
}

/** Recalcule les montants d'un état à partir des % cumulés saisis (contrôle : ≥ état précédent, ≤ 100). */
export async function saveStatementLines(statementId: string, input: { quoteLineId: string; cumulativePct: number }[]) {
  const st = await prisma.progressStatement.findUnique({ where: { id: statementId }, include: { lines: true } });
  if (!st) throw new HttpError(404, 'État d’avancement introuvable');
  if (st.status !== 'draft') throw new HttpError(422, 'Un état validé ne se modifie plus.');
  const [items, prevSt] = await Promise.all([
    quoteItems(st.quoteId),
    prisma.progressStatement.findFirst({ where: { quoteId: st.quoteId, seq: { lt: st.seq } }, orderBy: { seq: 'desc' }, include: { lines: true } }),
  ]);
  const prev = new Map((prevSt?.lines ?? []).map((l) => [l.quoteLineId, l.cumulativePct]));
  const wanted = new Map(input.map((l) => [l.quoteLineId, Number(l.cumulativePct)]));
  const rows = items.map((it) => {
    const p = prev.get(it.id) ?? 0;
    const cum = wanted.has(it.id) ? wanted.get(it.id)! : (st.lines.find((l) => l.quoteLineId === it.id)?.cumulativePct ?? p);
    if (!Number.isFinite(cum) || cum < 0 || cum > 100) throw new HttpError(422, `Avancement invalide pour « ${it.label} » : entre 0 et 100 %.`);
    if (cum + 0.0001 < p) throw new HttpError(422, `« ${it.label} » : l’avancement ne peut pas redescendre sous l’état précédent (${p} %).`);
    return { statementId, quoteLineId: it.id, cumulativePct: round2(cum), amountHt: round2((it.totalHt * (round2(cum) - p)) / 100) };
  });
  await prisma.$transaction([
    prisma.progressStatementLine.deleteMany({ where: { statementId } }),
    prisma.progressStatementLine.createMany({ data: rows }),
  ]);
}

/** Crée l'état suivant (brouillon) : tous les % repartent de l'état précédent. */
export async function createStatement(quoteId: string) {
  const quote = await prisma.document.findUnique({ where: { id: quoteId }, select: { id: true, kind: true, number: true, draftRef: true, lockedAt: true } });
  if (!quote) throw new HttpError(404, 'Devis introuvable');
  if (quote.kind !== 'quote') throw new HttpError(422, 'Les états d’avancement se font sur un devis');
  if (!quote.lockedAt) throw new HttpError(422, 'Émettez d’abord le devis.');
  const existing = await prisma.progressStatement.findMany({ where: { quoteId }, orderBy: { seq: 'asc' }, include: { lines: true } });
  if (existing.some((s) => s.status === 'draft')) throw new HttpError(422, 'Un état d’avancement est déjà en brouillon sur ce devis : terminez-le d’abord.');
  const last = existing[existing.length - 1];
  const items = await quoteItems(quoteId);
  if (!items.length) throw new HttpError(422, 'Ce devis n’a aucune ligne à facturer.');
  if (last && items.every((it) => (last.lines.find((l) => l.quoteLineId === it.id)?.cumulativePct ?? 0) >= 99.995)) throw new HttpError(422, 'Toutes les lignes sont déjà à 100 %.');
  const seq = (last?.seq ?? 0) + 1;
  return prisma.progressStatement.create({
    data: {
      quoteId, seq, number: statementNumber(quote, seq),
      lines: { create: items.map((it) => ({ quoteLineId: it.id, cumulativePct: last?.lines.find((l) => l.quoteLineId === it.id)?.cumulativePct ?? 0, amountHt: 0 })) },
    },
  });
}

/** Lignes de la facture d'un état : une ligne par poste avancé, puis la déduction d'acompte au prorata (par taux de TVA). */
export async function invoiceLinesFor(statementId: string) {
  const st = await prisma.progressStatement.findUnique({ where: { id: statementId }, include: { lines: true, quote: { select: { id: true, totalHt: true, number: true, draftRef: true, vatRate: true } } } });
  if (!st) throw new HttpError(404, 'État d’avancement introuvable');
  const [items, prevSt, ratio] = await Promise.all([
    quoteItems(st.quoteId),
    prisma.progressStatement.findFirst({ where: { quoteId: st.quoteId, seq: { lt: st.seq } }, orderBy: { seq: 'desc' }, include: { lines: true } }),
    depositRatio(st.quote),
  ]);
  const prev = new Map((prevSt?.lines ?? []).map((l) => [l.quoteLineId, l.cumulativePct]));
  const out: { label: string; unitPriceHt: number; vatRate: number }[] = [];
  const byVat = new Map<number, number>();
  for (const it of items) {
    const l = st.lines.find((x) => x.quoteLineId === it.id);
    if (!l || l.amountHt <= 0.004) continue;
    out.push({ label: `${it.label} — avancement ${l.cumulativePct} %${(prev.get(it.id) ?? 0) > 0 ? ` (déjà facturé : ${prev.get(it.id)} %)` : ''}`, unitPriceHt: l.amountHt, vatRate: it.vatRate });
    byVat.set(it.vatRate, (byVat.get(it.vatRate) ?? 0) + l.amountHt);
  }
  if (ratio > 0.0001) {
    for (const [vat, amount] of byVat) {
      const ded = round2(amount * ratio);
      if (ded > 0.004) out.push({ label: `Déduction de l’acompte déjà facturé (${round2(ratio * 100)} % de cet état)`, unitPriceHt: -ded, vatRate: vat });
    }
  }
  return { statement: st, lines: out };
}
