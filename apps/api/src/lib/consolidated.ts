import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';
import { allWorksitesTransport } from './vehicle-cost.js';

/**
 * P&L consolidé — reproduit l'onglet « Dashboard Général » du fichier Excel.
 * CA par entité (JJD / Tonton / M7), dépenses ventilées, résultat, marge.
 * Le partage des bénéfices est calculé à part (réservé aux associés).
 */

const norm = (s: string | null) => (s ?? '').toLowerCase().trim();

export function entityOf(cat: string | null, wsEntity: string | null): 'jjd' | 'tonton' | 'm7' | 'autre' {
  const c = norm(cat);
  if (c.includes('tonton')) return 'tonton';
  if (c.includes('m7')) return 'm7';
  if (c.includes('jjd') || c.includes('julien') || c.includes('ouvrier')) return 'jjd';
  if (wsEntity === 'tonton' || wsEntity === 'm7' || wsEntity === 'jjd') return wsEntity;
  return 'autre';
}

/**
 * Rémunération versée à un ouvrier JJD pointé (payé à la journée sur base du
 * pointage, puis facturé) — à distinguer de « Rémunération - Julien/Tonton »
 * (associés) et « Rémunération - M7 » (ancien associé, reclassé sous-traitance :
 * il ne pointe pas, sa facture s'ajoute au coût du chantier sans remplacer rien).
 */
export function isOuvrierRemuneration(cat: string | null): boolean {
  const c = norm(cat);
  return c === 'rémunération - ouvrier' || c === 'remuneration - ouvrier';
}

/** Regroupe une catégorie de dépense dans une section du compte de résultat. */
export function section(cat: string | null): string {
  const c = norm(cat);
  if (c.includes('m7')) return 'sous_traitance';
  if (c.startsWith('rémunération') || c.startsWith('remuneration')) return 'salaires';
  if (c.includes('sous-trait')) return 'sous_traitance';
  if (c.startsWith('matériel') || c.startsWith('materiel')) return 'materiel';
  if (['location matériel', 'location materiel', 'container/décheterie', 'container/decheterie'].includes(c)) return 'chantier_divers';
  if (['carburant', 'charges véhicules', 'charges vehicules', 'assurances auto', 'achat véhicule', 'achat vehicule', 'crédit auto', 'credit auto'].includes(c)) return 'vehicules';
  if (['loyer', 'garantie locative', 'charges'].includes(c)) return 'charges_fixes';
  if (['tva', 'impot', 'impôt'].includes(c)) return 'fiscal';
  if (c.includes('note de crédit') || c.includes('note de credit')) return 'notes_credit';
  return 'autres';
}

export const SECTION_LABEL: Record<string, string> = {
  materiel: 'Matériel',
  sous_traitance: 'Sous-traitance',
  chantier_divers: 'Location / décheterie',
  salaires: 'Rémunérations',
  vehicules: 'Véhicules',
  charges_fixes: 'Charges fixes',
  fiscal: 'TVA / impôts',
  notes_credit: 'Notes de crédit',
  autres: 'Autres',
};

export interface ConsolidatedInput {
  year?: number;
  month?: number; // 1-12
  entity?: 'jjd' | 'tonton' | 'm7';
}

export async function consolidatedPnl(input: ConsolidatedInput) {
  const where: Record<string, unknown> = {};
  if (input.year) where.year = input.year;
  if (input.month && input.year) {
    where.date = {
      gte: new Date(Date.UTC(input.year, input.month - 1, 1)),
      lt: new Date(Date.UTC(input.year, input.month, 1)),
    };
  }

  const entries = await prisma.ledgerEntry.findMany({
    where,
    select: { direction: true, ht: true, categoryRaw: true, worksite: { select: { entity: true } } },
  });

  const revenueByEntity: Record<string, number> = { jjd: 0, tonton: 0, m7: 0, autre: 0 };
  const creditNoteSales = { jjd: 0, tonton: 0, m7: 0, autre: 0 } as Record<string, number>;
  const expenseSections = new Map<string, { total: number; lines: Map<string, number> }>();
  let labour = 0;

  for (const e of entries) {
    const ent = entityOf(e.categoryRaw, e.worksite?.entity ?? null);
    if (input.entity && ent !== input.entity && ent !== 'autre') continue;

    if (e.direction === 'sale') {
      revenueByEntity[ent] = (revenueByEntity[ent] ?? 0) + e.ht;
    } else if (e.direction === 'credit_note' && norm(e.categoryRaw).includes('vente')) {
      creditNoteSales[ent] = (creditNoteSales[ent] ?? 0) + e.ht;
    } else {
      // achat ou note de crédit d'achat -> dépense
      const sec = section(e.categoryRaw);
      if (sec === 'salaires') labour += e.ht;
      const bucket = expenseSections.get(sec) ?? { total: 0, lines: new Map() };
      bucket.total += e.ht;
      bucket.lines.set(e.categoryRaw ?? '(sans catégorie)', (bucket.lines.get(e.categoryRaw ?? '(sans catégorie)') ?? 0) + e.ht);
      expenseSections.set(sec, bucket);
    }
  }

  // main-d'œuvre non facturée en interne : pointages validés (hors ce qui est déjà en "Rémunération")
  const timeAgg = await prisma.timeEntry.aggregate({
    where: {
      status: { in: ['approved', 'submitted'] },
      ...(input.year ? { date: { gte: new Date(Date.UTC(input.year, (input.month ?? 1) - 1, 1)) } } : {}),
    },
    _sum: { amount: true },
  });

  const revenueTotal = round2(Object.values(revenueByEntity).reduce((a, b) => a + b, 0));
  const creditNoteTotal = round2(Object.values(creditNoteSales).reduce((a, b) => a + b, 0));
  const netRevenue = round2(revenueTotal + creditNoteTotal);

  const sections = [...expenseSections.entries()]
    .map(([key, v]) => ({
      key,
      label: SECTION_LABEL[key] ?? key,
      total: round2(v.total),
      lines: [...v.lines.entries()].map(([label, amount]) => ({ label, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.total - a.total);

  const expenseTotal = round2(sections.reduce((a, s) => a + s.total, 0));
  const result = round2(netRevenue - expenseTotal);
  const margin = netRevenue > 0 ? round2((result / netRevenue) * 100) : null;

  return {
    filters: input,
    revenue: {
      total: revenueTotal,
      byEntity: Object.fromEntries(Object.entries(revenueByEntity).map(([k, v]) => [k, round2(v)])),
      creditNotes: creditNoteTotal,
      net: netRevenue,
    },
    expenses: { total: expenseTotal, sections },
    labour: round2(labour),
    timesheetLabour: round2(timeAgg._sum.amount ?? 0),
    result,
    margin,
  };
}

/**
 * Partage des bénéfices — réservé aux associés.
 * Reproduit les onglets « Calculs détails JJD » / « Calculs Tonton » :
 * somme des marges RÉELLES par chantier (CA encaissé − matériaux − main-d'œuvre),
 * groupée par entité. Bénéfice JJD ÷ 2 (David & Julien) ; bénéfice Tonton, la
 * « Part GT » = ÷ 3.
 */
export async function profitShare(_year?: number) {
  const [worksites, buys, sells, times, transportMap, materielTontonAgg, dejaPayeTontonAgg] = await Promise.all([
    prisma.worksite.findMany({ where: { kind: 'project' }, select: { id: true, entity: true } }),
    prisma.ledgerEntry.findMany({
      where: { direction: 'purchase', worksiteId: { not: null } },
      select: { worksiteId: true, ht: true, categoryRaw: true },
    }),
    prisma.ledgerEntry.groupBy({ by: ['worksiteId'], where: { direction: 'sale', paymentStatus: { contains: 'Pay' }, worksiteId: { not: null } }, _sum: { ht: true } }),
    prisma.timeEntry.groupBy({ by: ['worksiteId'], where: { status: { in: ['approved', 'submitted'] }, worksiteId: { not: null } }, _sum: { amount: true } }),
    allWorksitesTransport(),
    // Matériel que Tonton achète pour un chantier via sa société puis nous refacture (à
    // rembourser en plus de sa part de bénéfice — ce n'est pas une prestation).
    prisma.ledgerEntry.aggregate({ where: { direction: 'purchase', categoryRaw: 'Matériel - Tonton' }, _sum: { ht: true } }),
    // Déjà versé sur son bénéfice (factures "Rémunération - Tonton" à sa société GT Light Concept).
    prisma.ledgerEntry.aggregate({ where: { direction: 'purchase', categoryRaw: 'Rémunération - Tonton' }, _sum: { ht: true } }),
  ]);
  // "Rémunération - Ouvrier" (ouvriers JJD pointés) remplace l'estimation par pointage plutôt
  // que de s'y ajouter (sinon double compte). Les autres achats — dont "Rémunération -
  // Julien/Tonton/M7", personnes distinctes des ouvriers pointés — s'additionnent normalement.
  const buyMap = new Map<string, number>();
  const invoicedLabourMap = new Map<string, number>();
  for (const b of buys) {
    if (!b.worksiteId) continue;
    const target = isOuvrierRemuneration(b.categoryRaw) ? invoicedLabourMap : buyMap;
    target.set(b.worksiteId, (target.get(b.worksiteId) ?? 0) + b.ht);
  }
  const sellMap = new Map(sells.map((s) => [s.worksiteId, s._sum.ht ?? 0]));
  const timeMap = new Map(times.map((t) => [t.worksiteId, t._sum.amount ?? 0]));

  const totals: Record<string, { worksites: number; profit: number }> = {
    jjd: { worksites: 0, profit: 0 },
    tonton: { worksites: 0, profit: 0 },
    m7: { worksites: 0, profit: 0 },
  };

  for (const w of worksites) {
    const ent = (w.entity as keyof typeof totals) ?? 'jjd';
    if (!totals[ent]) continue;
    const invoicedLabour = invoicedLabourMap.get(w.id) ?? 0;
    const labourCost = invoicedLabour > 0 ? invoicedLabour : (timeMap.get(w.id) ?? 0);
    const profit = (sellMap.get(w.id) ?? 0) - (buyMap.get(w.id) ?? 0) - labourCost - (transportMap.get(w.id) ?? 0);
    totals[ent].worksites += 1;
    totals[ent].profit += profit;
  }

  const jjdProfit = round2(totals.jjd!.profit);
  const tontonProfit = round2(totals.tonton!.profit);

  return {
    year: _year ?? null,
    jjd: {
      worksites: totals.jjd!.worksites,
      profit: jjdProfit,
      david: round2(jjdProfit / 2),
      julien: round2(jjdProfit / 2),
    },
    tonton: {
      worksites: totals.tonton!.worksites,
      profit: tontonProfit,
      partGt: round2(tontonProfit / 3),
      resteJjd: round2(tontonProfit - tontonProfit / 3),
      // Solde = sa part de bénéfice + le matériel qu'il a avancé − ce qu'on lui a déjà versé.
      // Positif = on lui doit encore de l'argent ; négatif = on a payé plus que ce qu'il fallait.
      materielTonton: round2(materielTontonAgg._sum.ht ?? 0),
      dejaPayeTonton: round2(dejaPayeTontonAgg._sum.ht ?? 0),
      solde: round2(tontonProfit / 3 + (materielTontonAgg._sum.ht ?? 0) - (dejaPayeTontonAgg._sum.ht ?? 0)),
    },
    m7: { worksites: totals.m7!.worksites, profit: round2(totals.m7!.profit) },
  };
}
