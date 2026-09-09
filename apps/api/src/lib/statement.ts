import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';
import { worksiteMargin } from './worksite-margin.js';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Décompte mensuel d'un ouvrier : heures + montant, ventilé par chantier.
 *
 * Règle métier : un jour presté est payé au minimum `person.dailyHours` (10h
 * par défaut), même si les pointages du jour totalisent moins (ex. 3h sur un
 * chantier proche). Ça ne s'applique qu'aux pointages faits dans l'app (pas
 * à l'historique importé de l'Excel, dont le montant réel est déjà connu).
 */
export async function monthlyStatement(personId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const [person, entries] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { hourlyRate: true, dailyHours: true } }),
    prisma.timeEntry.findMany({
      where: { personId, date: { gte: start, lt: end }, status: { in: ['submitted', 'approved'] } },
      include: { worksite: { select: { ref: true, title: true } } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const dailyHours = person?.dailyHours ?? 10;
  const defaultRate = person?.hourlyRate ?? null;

  // jour presté garanti : regroupe les pointages "app" (pas l'import xlsx) par jour
  const byDay = new Map<string, { hours: number; amount: number; rate: number | null }>();
  for (const e of entries) {
    if (e.source === 'xlsx' || !e.date) continue;
    const key = dayKey(e.date);
    const row = byDay.get(key) ?? { hours: 0, amount: 0, rate: null };
    row.hours += e.hours ?? 0;
    row.amount += e.amount ?? 0;
    row.rate = row.rate ?? e.rateUsed ?? null;
    byDay.set(key, row);
  }
  let floorHoursAdded = 0;
  let floorAmountAdded = 0;
  for (const row of byDay.values()) {
    const rate = row.rate ?? defaultRate;
    if (!rate) continue; // pas de taux connu -> impossible de garantir un montant
    const flooredHours = Math.max(row.hours, dailyHours);
    const flooredAmount = Math.max(row.amount, round2(dailyHours * rate));
    floorHoursAdded += flooredHours - row.hours;
    floorAmountAdded += flooredAmount - row.amount;
  }

  const byWorksite = new Map<string, { ref: string; title: string; hours: number; amount: number; days: number }>();
  let totalHours = 0;
  let totalAmount = 0;
  let pending = 0;
  for (const e of entries) {
    totalHours += e.hours ?? 0;
    totalAmount += e.amount ?? 0;
    if (e.status === 'submitted') pending++;
    const key = e.worksite?.ref ?? '—';
    const row = byWorksite.get(key) ?? { ref: key, title: e.worksite?.title ?? 'Sans chantier', hours: 0, amount: 0, days: 0 };
    row.hours += e.hours ?? 0;
    row.amount += e.amount ?? 0;
    row.days += 1;
    byWorksite.set(key, row);
  }
  totalHours += floorHoursAdded;
  totalAmount += floorAmountAdded;

  return {
    personId,
    year,
    month,
    totalHours: round2(totalHours),
    totalAmount: round2(totalAmount),
    dailyHoursGuarantee: dailyHours,
    guaranteeApplied: floorAmountAdded > 0.01,
    pendingCount: pending,
    entryCount: entries.length,
    worksiteCount: byWorksite.size,
    byWorksite: [...byWorksite.values()].map((r) => ({ ...r, hours: round2(r.hours), amount: round2(r.amount) })),
  };
}

/** Décompte du mois pour toute l'équipe (préparation des paiements). */
export async function teamMonthlyStatement(year: number, month: number) {
  const people = await prisma.person.findMany({
    where: { active: true },
    orderBy: { firstName: 'asc' },
    include: { adjustments: { where: { settled: false }, select: { amount: true } } },
  });
  const rows = [];
  for (const p of people) {
    const s = await monthlyStatement(p.id, year, month);
    if (s.entryCount === 0) continue;
    const toWithhold = round2(p.adjustments.reduce((sum, a) => sum + a.amount, 0));
    rows.push({
      personId: p.id,
      name: p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim(),
      contractType: p.contractType,
      hourlyRate: p.hourlyRate,
      hours: s.totalHours,
      amount: s.totalAmount,
      // avances/dettes non réglées -> à déduire de ce paiement (simple repère, pas soustrait
      // automatiquement des rapports de marge/consolidé, qui restent basés sur le pointage réel)
      toWithhold,
      netAmount: round2(s.totalAmount - toWithhold),
      pending: s.pendingCount,
    });
  }
  return {
    year, month, rows,
    totalAmount: round2(rows.reduce((a, r) => a + r.amount, 0)),
    totalNetAmount: round2(rows.reduce((a, r) => a + r.netAmount, 0)),
  };
}

/** Série mensuelle (montant, heures, nb de chantiers) pour le graphique de la fiche ouvrier. */
export async function personEarningsSeries(personId: string, months = 12) {
  const now = new Date();
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const s = await monthlyStatement(personId, d.getFullYear(), d.getMonth() + 1);
    series.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      amount: s.totalAmount,
      hours: s.totalHours,
      worksites: s.worksiteCount,
    });
  }
  return series;
}

/**
 * Revenus tout l'historique d'un ouvrier : total, ventilé par année et par
 * chantier, avec la garantie « jour presté » (même règle que le décompte
 * mensuel — voir plus haut) répartie sur l'année et, quand la journée ne
 * concerne qu'un seul chantier, sur ce chantier.
 *
 * La « rentabilité » affichée par chantier est celle du CHANTIER (marge
 * réelle calculée par worksiteMargin), pas une marge propre à l'ouvrier —
 * il n'y a pas de règle fiable pour répartir une marge chantier entre
 * plusieurs ouvriers. Ça sert de repère : est-ce que les chantiers où cette
 * personne travaille sont, dans l'ensemble, rentables ?
 */
export async function personEarningsBreakdown(personId: string) {
  const [person, entries] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { hourlyRate: true, dailyHours: true } }),
    prisma.timeEntry.findMany({
      where: { personId, status: { in: ['submitted', 'approved'] } },
      select: {
        date: true, hours: true, amount: true, rateUsed: true, source: true, worksiteId: true,
        worksite: { select: { ref: true, title: true } },
      },
      orderBy: { date: 'asc' },
    }),
  ]);

  const dailyHours = person?.dailyHours ?? 10;
  const defaultRate = person?.hourlyRate ?? null;

  // garantie jour presté sur tout l'historique : par jour, le sous-total (heures/montant)
  // est relevé au minimum garanti — on note aussi si la journée ne touche qu'un chantier
  const byDay = new Map<string, { hours: number; amount: number; rate: number | null; worksiteIds: Set<string> }>();
  for (const e of entries) {
    if (e.source === 'xlsx' || !e.date) continue;
    const key = dayKey(e.date);
    const row = byDay.get(key) ?? { hours: 0, amount: 0, rate: null, worksiteIds: new Set<string>() };
    row.hours += e.hours ?? 0;
    row.amount += e.amount ?? 0;
    row.rate = row.rate ?? e.rateUsed ?? null;
    if (e.worksiteId) row.worksiteIds.add(e.worksiteId);
    byDay.set(key, row);
  }
  const yearFloorAdded = new Map<number, { hours: number; amount: number }>();
  const worksiteFloorAdded = new Map<string, { hours: number; amount: number }>();
  let floorHoursAdded = 0, floorAmountAdded = 0;
  for (const [day, row] of byDay) {
    const rate = row.rate ?? defaultRate;
    if (!rate) continue;
    const hoursAdded = Math.max(row.hours, dailyHours) - row.hours;
    const amountAdded = Math.max(row.amount, round2(dailyHours * rate)) - row.amount;
    if (amountAdded <= 0) continue;
    floorHoursAdded += hoursAdded;
    floorAmountAdded += amountAdded;
    const year = Number(day.slice(0, 4));
    const yr = yearFloorAdded.get(year) ?? { hours: 0, amount: 0 };
    yr.hours += hoursAdded;
    yr.amount += amountAdded;
    yearFloorAdded.set(year, yr);
    if (row.worksiteIds.size === 1) {
      const wsId = [...row.worksiteIds][0]!;
      const w = worksiteFloorAdded.get(wsId) ?? { hours: 0, amount: 0 };
      w.hours += hoursAdded;
      w.amount += amountAdded;
      worksiteFloorAdded.set(wsId, w);
    }
  }

  const byYear = new Map<number, { year: number; hours: number; amount: number; worksites: Set<string> }>();
  const byWorksite = new Map<string, { id: string; ref: string; title: string; hours: number; amount: number; days: Set<string> }>();
  let totalHours = 0, totalAmount = 0;
  for (const e of entries) {
    totalHours += e.hours ?? 0;
    totalAmount += e.amount ?? 0;
    if (e.date) {
      const year = e.date.getUTCFullYear();
      const yr = byYear.get(year) ?? { year, hours: 0, amount: 0, worksites: new Set() };
      yr.hours += e.hours ?? 0;
      yr.amount += e.amount ?? 0;
      if (e.worksiteId) yr.worksites.add(e.worksiteId);
      byYear.set(year, yr);
    }
    if (e.worksiteId) {
      const row = byWorksite.get(e.worksiteId) ?? {
        id: e.worksiteId, ref: e.worksite?.ref ?? '—', title: e.worksite?.title ?? 'Sans chantier',
        hours: 0, amount: 0, days: new Set<string>(),
      };
      row.hours += e.hours ?? 0;
      row.amount += e.amount ?? 0;
      if (e.date) row.days.add(dayKey(e.date));
      byWorksite.set(e.worksiteId, row);
    }
  }
  totalHours += floorHoursAdded;
  totalAmount += floorAmountAdded;
  for (const [year, add] of yearFloorAdded) {
    const yr = byYear.get(year);
    if (yr) { yr.hours += add.hours; yr.amount += add.amount; }
  }
  for (const [wsId, add] of worksiteFloorAdded) {
    const row = byWorksite.get(wsId);
    if (row) { row.hours += add.hours; row.amount += add.amount; }
  }

  const worksiteRows = [...byWorksite.values()].sort((a, b) => b.amount - a.amount);
  const margins = await Promise.all(worksiteRows.map((w) => worksiteMargin(w.id)));

  return {
    total: {
      hours: round2(totalHours),
      amount: round2(totalAmount),
      years: byYear.size,
      worksites: byWorksite.size,
    },
    byYear: [...byYear.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({ year: y.year, hours: round2(y.hours), amount: round2(y.amount), worksites: y.worksites.size })),
    byWorksite: worksiteRows.map((w, i) => ({
      id: w.id, ref: w.ref, title: w.title,
      hours: round2(w.hours), amount: round2(w.amount), days: w.days.size,
      marginPct: margins[i]?.realMarginPct ?? null,
      margin: margins[i]?.realMargin ?? null,
    })),
  };
}
