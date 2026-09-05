import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';
import { section, SECTION_LABEL, entityOf, isOuvrierRemuneration, isCreditNoteSale } from './consolidated.js';

/**
 * Séries pour la page « Analyse » : mensuel (CA / dépenses / résultat / heures),
 * répartition des dépenses, top chantiers, top clients, devis.
 */

type Entity = 'jjd' | 'tonton' | 'm7';
const norm = (s: string | null) => (s ?? '').toLowerCase();
const isPaid = (s: string | null) => norm(s).includes('pay');

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthsBack(n: number): { from: Date; keys: string[] } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1), 1));
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    keys.push(monthKey(d));
  }
  return { from: start, keys };
}

export interface AnalyticsInput {
  months?: number;
  entity?: Entity;
}

export async function analytics(input: AnalyticsInput = {}) {
  const months = Math.min(Math.max(input.months ?? 12, 3), 36);
  const win = monthsBack(months);
  const prevWin = monthsBack(months * 2); // fenêtre précédente = 1re moitié

  const [ledger, times, docs, worksites] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { date: { gte: prevWin.from } },
      select: { date: true, direction: true, ht: true, categoryRaw: true, paymentStatus: true, contactId: true, worksite: { select: { entity: true } } },
    }),
    prisma.timeEntry.findMany({
      where: { date: { gte: prevWin.from }, status: { in: ['approved', 'submitted'] } },
      select: { date: true, hours: true, amount: true },
    }),
    prisma.document.findMany({
      where: { kind: 'quote' },
      select: { status: true, totalHt: true, issuedOn: true, createdAt: true },
    }),
    prisma.worksite.findMany({ where: { kind: 'project' }, select: { id: true, ref: true, title: true, entity: true } }),
  ]);

  const keep = (ent: 'jjd' | 'tonton' | 'm7' | 'autre') => !input.entity || ent === input.entity || ent === 'autre';

  /* ---------------- séries mensuelles ---------------- */
  const zero = () => ({ revenue: 0, expenses: 0, invoiced: 0, collected: 0, hours: 0, labourCost: 0 });
  const byMonth = new Map<string, ReturnType<typeof zero>>();
  for (const k of win.keys) byMonth.set(k, zero());

  for (const e of ledger) {
    if (!e.date) continue;
    const k = monthKey(e.date);
    const m = byMonth.get(k);
    if (!m) continue;
    const ent = entityOf(e.categoryRaw, e.worksite?.entity ?? null);
    if (!keep(ent)) continue;
    if (e.direction === 'sale') {
      m.revenue += e.ht;
      m.invoiced += e.ht;
      if (isPaid(e.paymentStatus)) m.collected += e.ht;
    } else if (e.direction === 'credit_note' && norm(e.categoryRaw).includes('vente')) {
      m.revenue += e.ht; // signe déjà négatif
    } else {
      m.expenses += e.ht;
    }
  }
  for (const t of times) {
    if (!t.date) continue;
    const m = byMonth.get(monthKey(t.date));
    if (!m) continue;
    m.hours += t.hours ?? 0;
    m.labourCost += t.amount ?? 0;
  }

  const monthly = win.keys.map((k) => {
    const m = byMonth.get(k)!;
    return {
      month: k,
      revenue: round2(m.revenue),
      expenses: round2(m.expenses),
      result: round2(m.revenue - m.expenses),
      invoiced: round2(m.invoiced),
      collected: round2(m.collected),
      hours: round2(m.hours),
      labourCost: round2(m.labourCost),
    };
  });

  /* ---------------- totaux + fenêtre précédente (tendance) ---------------- */
  const sum = (list: typeof ledger, fromKey: string, toExclusiveKey: string) => {
    let revenue = 0, expenses = 0, collected = 0;
    for (const e of list) {
      if (!e.date) continue;
      const k = monthKey(e.date);
      if (k < fromKey || k >= toExclusiveKey) continue;
      const ent = entityOf(e.categoryRaw, e.worksite?.entity ?? null);
      if (!keep(ent)) continue;
      if (e.direction === 'sale') { revenue += e.ht; if (isPaid(e.paymentStatus)) collected += e.ht; }
      else if (e.direction === 'credit_note' && norm(e.categoryRaw).includes('vente')) revenue += e.ht;
      else expenses += e.ht;
    }
    return { revenue: round2(revenue), expenses: round2(expenses), result: round2(revenue - expenses), collected: round2(collected) };
  };
  const hoursSum = (fromKey: string, toExclusiveKey: string) => {
    let h = 0;
    for (const t of times) {
      if (!t.date) continue;
      const k = monthKey(t.date);
      if (k >= fromKey && k < toExclusiveKey) h += t.hours ?? 0;
    }
    return round2(h);
  };

  const curFromKey = win.keys[0]!;
  const afterKey = monthKey(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)));
  const prevFromKey = prevWin.keys[0]!;

  const totals = { ...sum(ledger, curFromKey, afterKey), hours: hoursSum(curFromKey, afterKey) };
  const prev = { ...sum(ledger, prevFromKey, curFromKey), hours: hoursSum(prevFromKey, curFromKey) };
  const marginPct = totals.revenue > 0 ? round2((totals.result / totals.revenue) * 100) : null;
  const prevMarginPct = prev.revenue > 0 ? round2((prev.result / prev.revenue) * 100) : null;

  /* ---------------- répartition des dépenses (donut) ---------------- */
  const expBySection = new Map<string, number>();
  for (const e of ledger) {
    if (!e.date || monthKey(e.date) < curFromKey || monthKey(e.date) >= afterKey) continue;
    if (e.direction === 'sale') continue;
    if (e.direction === 'credit_note' && norm(e.categoryRaw).includes('vente')) continue;
    const ent = entityOf(e.categoryRaw, e.worksite?.entity ?? null);
    if (!keep(ent)) continue;
    const sec = section(e.categoryRaw);
    expBySection.set(sec, (expBySection.get(sec) ?? 0) + e.ht);
  }
  const expenseSections = [...expBySection.entries()]
    .map(([key, total]) => ({ key, label: SECTION_LABEL[key] ?? key, total: round2(total) }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  /* ---------------- top chantiers (marge réelle sur la fenêtre) ---------------- */
  const wsMap = new Map(worksites.map((w) => [w.id, w]));
  const [buys, salesRaw, creditNotesRaw, timeByWs] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { direction: 'purchase', worksiteId: { not: null }, date: { gte: win.from } },
      select: { worksiteId: true, ht: true, categoryRaw: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { direction: 'sale', paymentStatus: { contains: 'Pay' }, worksiteId: { not: null }, date: { gte: win.from } },
      select: { worksiteId: true, ht: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { direction: 'credit_note', worksiteId: { not: null }, date: { gte: win.from } },
      select: { worksiteId: true, ht: true, categoryRaw: true, paymentStatus: true },
    }),
    prisma.timeEntry.groupBy({ by: ['worksiteId'], where: { status: { in: ['approved', 'submitted'] }, worksiteId: { not: null }, date: { gte: win.from } }, _sum: { amount: true } }),
  ]);
  // "Rémunération - Ouvrier" (ouvriers JJD pointés, payés à la journée puis facturés) remplace
  // l'estimation par pointage plutôt que de s'y ajouter (sinon la main-d'œuvre compte deux fois).
  // Les autres achats — dont "Rémunération - Julien/Tonton/M7", personnes distinctes des ouvriers
  // pointés — s'additionnent normalement.
  const buyW = new Map<string, number>();
  const invoicedLabourW = new Map<string, number>();
  for (const b of buys) {
    if (!b.worksiteId) continue;
    const target = isOuvrierRemuneration(b.categoryRaw) ? invoicedLabourW : buyW;
    target.set(b.worksiteId, (target.get(b.worksiteId) ?? 0) + b.ht);
  }
  const sellW = new Map<string, number>();
  for (const s of salesRaw) {
    if (!s.worksiteId) continue;
    sellW.set(s.worksiteId, (sellW.get(s.worksiteId) ?? 0) + s.ht);
  }
  // Notes de crédit : réduisent le CA encaissé si "vente" (et payées), sinon le coût matériaux.
  for (const c of creditNotesRaw) {
    if (!c.worksiteId) continue;
    if (isCreditNoteSale(c.categoryRaw)) {
      if ((c.paymentStatus ?? '').toLowerCase().includes('pay')) sellW.set(c.worksiteId, (sellW.get(c.worksiteId) ?? 0) + c.ht);
    } else {
      buyW.set(c.worksiteId, (buyW.get(c.worksiteId) ?? 0) + c.ht);
    }
  }
  const timeW = new Map(timeByWs.map((t) => [t.worksiteId, t._sum.amount ?? 0]));
  const topWorksites = [...sellW.entries()]
    .map(([worksiteId, paidHt]) => {
      const w = wsMap.get(worksiteId);
      if (!w) return null;
      if (input.entity && w.entity !== input.entity) return null;
      const invoicedLabour = invoicedLabourW.get(worksiteId) ?? 0;
      const labourCost = invoicedLabour > 0 ? invoicedLabour : (timeW.get(worksiteId) ?? 0);
      const margin = round2(paidHt - (buyW.get(worksiteId) ?? 0) - labourCost);
      return { ref: w.ref, title: w.title, entity: w.entity, paidHt: round2(paidHt), margin };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 8);

  /* ---------------- top clients (CA sur la fenêtre) ---------------- */
  const salesByClient = await prisma.ledgerEntry.groupBy({
    by: ['contactId'],
    where: { direction: 'sale', contactId: { not: null }, date: { gte: win.from } },
    _sum: { ht: true },
    _count: true,
  });
  const contactIds = salesByClient.map((s) => s.contactId).filter((x): x is string => !!x);
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
    : [];
  const cName = new Map(contacts.map((c) => [c.id, c.name]));
  const topClients = salesByClient
    .map((s) => ({ name: cName.get(s.contactId!) ?? '—', revenue: round2(s._sum.ht ?? 0), invoices: s._count }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  /* ---------------- devis ---------------- */
  const q = { sent: 0, accepted: 0, declined: 0, pending: 0, pipelineHt: 0 };
  for (const d of docs) {
    if (d.status === 'accepted') q.accepted++;
    else if (d.status === 'declined' || d.status === 'expired') q.declined++;
    else if (d.status === 'sent') { q.pending++; q.pipelineHt += d.totalHt; }
    q.sent++;
  }
  const decided = q.accepted + q.declined;
  const quotes = { ...q, pipelineHt: round2(q.pipelineHt), acceptRate: decided > 0 ? round2((q.accepted / decided) * 100) : null };

  return {
    range: { months, from: win.from.toISOString().slice(0, 10) },
    entity: input.entity ?? null,
    monthly,
    totals: { ...totals, marginPct },
    prev: { ...prev, marginPct: prevMarginPct },
    expenseSections,
    topWorksites,
    topClients,
    quotes,
  };
}
