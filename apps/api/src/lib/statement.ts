import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';

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
  const people = await prisma.person.findMany({ where: { active: true }, orderBy: { firstName: 'asc' } });
  const rows = [];
  for (const p of people) {
    const s = await monthlyStatement(p.id, year, month);
    if (s.entryCount === 0) continue;
    rows.push({
      personId: p.id,
      name: p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim(),
      contractType: p.contractType,
      hourlyRate: p.hourlyRate,
      hours: s.totalHours,
      amount: s.totalAmount,
      pending: s.pendingCount,
    });
  }
  return { year, month, rows, totalAmount: round2(rows.reduce((a, r) => a + r.amount, 0)) };
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
