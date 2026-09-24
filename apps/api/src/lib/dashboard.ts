import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';

const DAY = 86_400_000;

export interface Alert {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  label: string;
  count: number;
  amount?: number;
  href: string;
}

/**
 * « Sur le terrain aujourd'hui » : les affectations du planning du jour, avec pour chaque
 * ouvrier son état de pointage (compteur en cours / heures déjà pointées sur ce chantier / rien).
 * Lecture seule, composée à partir du planning et du pointage existants.
 */
async function fieldTodayList(todayStart: Date, todayEnd: Date) {
  const events = await prisma.planningEvent.findMany({
    where: { startAt: { lt: todayEnd }, endAt: { gt: todayStart } },
    orderBy: { startAt: 'asc' },
    include: {
      worksite: { select: { id: true, ref: true, title: true, city: true } },
      team: { select: { name: true } },
      assignments: { include: { person: { select: { id: true, displayName: true, firstName: true } } } },
    },
  });
  const personIds = [...new Set(events.flatMap((e) => e.assignments.map((a) => a.personId)))];
  const entries = personIds.length
    ? await prisma.timeEntry.findMany({
        where: {
          personId: { in: personIds },
          OR: [{ status: 'running' }, { date: { gte: todayStart, lt: todayEnd } }],
        },
        select: { personId: true, worksiteId: true, status: true },
      })
    : [];
  return events.map((e) => ({
    id: e.id,
    startAt: e.startAt,
    endAt: e.endAt,
    allDay: e.allDay,
    tentative: e.status === 'tentative',
    worksite: e.worksite,
    team: e.team?.name ?? null,
    people: e.assignments.map((a) => {
      const mine = entries.filter((t) => t.personId === a.personId);
      const state: 'running' | 'done' | 'none' = mine.some((t) => t.status === 'running')
        ? 'running'
        : mine.some((t) => t.worksiteId === e.worksiteId && t.status !== 'rejected')
          ? 'done'
          : 'none';
      return { id: a.personId, name: a.person.displayName || a.person.firstName, state };
    }),
  }));
}

/** Le dashboard bureau : KPI du mois + file d'alertes triée par urgence. */
export async function bureauDashboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const in30 = new Date(now.getTime() + 30 * DAY);

  const ACTIVE_STATUS = ['scheduled', 'in_progress', 'on_hold'];

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + DAY);

  const [
    invoicedMonth, invoicedPrevMonth, paidMonth, overdue, receivable, quotesPending, worksitesToInvoice,
    expiringDocs, ctExpiring, activeCount, activeWorksites,
    crmNextActions, todayEvents,
  ] = await Promise.all([
    prisma.document.aggregate({
      where: { kind: { in: ['invoice', 'deposit_invoice'] }, issuedOn: { gte: monthStart }, source: { not: 'demo' } }, _sum: { totalHt: true },
    }),
    prisma.document.aggregate({
      where: { kind: { in: ['invoice', 'deposit_invoice'] }, issuedOn: { gte: prevMonthStart, lt: monthStart }, source: { not: 'demo' } }, _sum: { totalHt: true },
    }),
    prisma.document.aggregate({
      where: { kind: { in: ['invoice', 'deposit_invoice'] }, status: 'paid', issuedOn: { gte: monthStart }, source: { not: 'demo' } }, _sum: { totalHt: true },
    }),
    prisma.document.findMany({ where: { kind: { in: ['invoice', 'deposit_invoice'] }, status: 'overdue', source: { not: 'demo' } } }),
    prisma.document.findMany({ where: { kind: { in: ['invoice', 'deposit_invoice'] }, status: { in: ['sent', 'partial', 'overdue'] }, source: { not: 'demo' } } }),
    prisma.document.findMany({ where: { kind: 'quote', status: 'sent', source: { not: 'demo' } } }),
    prisma.worksite.count({ where: { status: 'to_invoice', archived: false, source: { not: 'demo' } } }),
    prisma.legalDoc.findMany({
      where: { expiresOn: { not: null, lte: in30 } },
      include: { person: true },
    }),
    prisma.vehicle.count({ where: { nextInspection: { not: null, lte: in30 } } }),
    prisma.worksite.count({ where: { archived: false, kind: 'project', status: { in: ACTIVE_STATUS }, source: { not: 'demo' } } }),
    prisma.worksite.findMany({
      where: { archived: false, kind: 'project', status: { in: ACTIVE_STATUS }, source: { not: 'demo' } },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      include: {
        client: { select: { name: true } },
        manager: { select: { displayName: true, firstName: true } },
        acp: { select: { photoThumbUrl: true } },
      },
    }),
    prisma.crmOpportunity.count({
      where: { stage: { notIn: ['won', 'lost'] }, nextActionOn: { not: null, lte: now } },
    }),
    prisma.planningEvent.findMany({
      where: { startAt: { lt: todayEnd }, endAt: { gt: todayStart } },
      select: { teamId: true },
    }),
  ]);

  const teamsOnSiteToday = new Set(todayEvents.map((e) => e.teamId).filter((id): id is string => !!id)).size;
  const fieldToday = await fieldTodayList(todayStart, todayEnd);

  const overdueAmount = round2(overdue.reduce((s, d) => s + Math.max(0, (d.totalTtc || 0) - (d.paidAmount || 0)), 0));
  const receivableAmount = round2(receivable.reduce((s, d) => s + Math.max(0, (d.totalTtc || 0) - (d.paidAmount || 0)), 0));
  const quotesPendingAmount = round2(quotesPending.reduce((s, d) => s + (d.totalHt || 0), 0));

  const alerts: Alert[] = [];
  if (overdue.length)
    alerts.push({ kind: 'overdue_invoices', severity: 'critical', label: 'Factures échues impayées', count: overdue.length, amount: overdueAmount, href: '/app/documents?kind=invoice&statut=overdue' });
  if (worksitesToInvoice)
    alerts.push({ kind: 'to_invoice', severity: 'warning', label: 'Chantiers terminés à facturer', count: worksitesToInvoice, href: '/app/chantiers?statut=to_invoice' });
  if (quotesPending.length)
    alerts.push({ kind: 'quotes_follow', severity: 'warning', label: 'Devis envoyés sans réponse', count: quotesPending.length, amount: quotesPendingAmount, href: '/app/documents?kind=quote&statut=sent' });
  if (crmNextActions)
    alerts.push({ kind: 'crm_due', severity: 'warning', label: 'Relances CRM à faire', count: crmNextActions, href: '/app/crm' });
  if (expiringDocs.length)
    alerts.push({ kind: 'expiring_docs', severity: 'warning', label: 'Documents légaux qui expirent (30 j)', count: expiringDocs.length, href: '/app/equipe' });
  if (ctExpiring)
    alerts.push({ kind: 'ct_expiring', severity: 'info', label: 'Contrôles techniques à faire (30 j)', count: ctExpiring, href: '/app/flotte' });

  const order = { critical: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => order[a.severity] - order[b.severity] || (b.amount ?? 0) - (a.amount ?? 0));

  return {
    kpis: {
      invoicedMonth: round2(invoicedMonth._sum.totalHt ?? 0),
      invoicedPrevMonth: round2(invoicedPrevMonth._sum.totalHt ?? 0),
      paidMonth: round2(paidMonth._sum.totalHt ?? 0),
      overdueAmount,
      overdueCount: overdue.length,
      openWorksites: activeCount,
      teamsOnSiteToday,
      receivableAmount,
      quotesPendingAmount,
      quotesPendingCount: quotesPending.length,
    },
    alerts,
    fieldToday,
    inProgress: activeWorksites.map((w) => ({
      id: w.id,
      ref: w.ref,
      title: w.title,
      city: w.city,
      status: w.status,
      client: w.client?.name ?? null,
      manager: w.manager?.displayName || w.manager?.firstName || null,
      photoThumbUrl: w.acp?.photoThumbUrl ?? null,
    })),
    expiringDocs: expiringDocs.map((d) => ({
      id: d.id,
      person: d.person.displayName || `${d.person.firstName} ${d.person.lastName ?? ''}`.trim(),
      type: d.type,
      label: d.label,
      expiresOn: d.expiresOn,
    })),
  };
}
