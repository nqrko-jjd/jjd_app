import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';

/** Décompte mensuel d'un ouvrier : heures + montant, ventilé par chantier. */
export async function monthlyStatement(personId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const entries = await prisma.timeEntry.findMany({
    where: { personId, date: { gte: start, lt: end }, status: { in: ['submitted', 'approved'] } },
    include: { worksite: { select: { ref: true, title: true } } },
    orderBy: { date: 'asc' },
  });

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

  return {
    personId,
    year,
    month,
    totalHours: round2(totalHours),
    totalAmount: round2(totalAmount),
    pendingCount: pending,
    entryCount: entries.length,
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
