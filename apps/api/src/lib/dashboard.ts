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

/** Le dashboard bureau : KPI du mois + file d'alertes triée par urgence. */
export async function bureauDashboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30 = new Date(now.getTime() + 30 * DAY);

  const [
    invoicedMonth, paidMonth, overdue, quotesToFollow, worksitesToInvoice,
    expiringDocs, ctExpiring, unpaidFines, hoursWeek, openWorksites,
    crmNextActions,
  ] = await Promise.all([
    prisma.document.aggregate({
      where: { kind: 'invoice', issuedOn: { gte: monthStart } }, _sum: { totalHt: true },
    }),
    prisma.document.aggregate({
      where: { kind: 'invoice', status: 'paid', issuedOn: { gte: monthStart } }, _sum: { totalHt: true },
    }),
    prisma.document.findMany({ where: { kind: 'invoice', status: 'overdue' } }),
    prisma.document.count({ where: { kind: 'quote', status: 'sent' } }),
    prisma.worksite.count({ where: { status: 'to_invoice', archived: false } }),
    prisma.legalDoc.findMany({
      where: { expiresOn: { not: null, lte: in30 } },
      include: { person: true },
    }),
    prisma.vehicle.count({ where: { nextInspection: { not: null, lte: in30 } } }),
    prisma.fine.findMany({ where: { OR: [{ status: null }, { status: { not: 'Payé' } }] } }),
    prisma.timeEntry.aggregate({
      where: { date: { gte: new Date(now.getTime() - 7 * DAY) } }, _sum: { hours: true },
    }),
    prisma.worksite.count({
      where: { archived: false, status: { in: ['scheduled', 'in_progress', 'on_hold'] } },
    }),
    prisma.crmOpportunity.count({
      where: { stage: { notIn: ['won', 'lost'] }, nextActionOn: { not: null, lte: now } },
    }),
  ]);

  const overdueAmount = round2(overdue.reduce((s, d) => s + Math.max(0, (d.totalTtc || 0) - (d.paidAmount || 0)), 0));
  const finesAmount = round2(unpaidFines.reduce((s, f) => s + (f.amount || 0), 0));

  const alerts: Alert[] = [];
  if (overdue.length)
    alerts.push({ kind: 'overdue_invoices', severity: 'critical', label: 'Factures échues impayées', count: overdue.length, amount: overdueAmount, href: '/factures?statut=overdue' });
  if (worksitesToInvoice)
    alerts.push({ kind: 'to_invoice', severity: 'warning', label: 'Chantiers terminés à facturer', count: worksitesToInvoice, href: '/chantiers?statut=to_invoice' });
  if (quotesToFollow)
    alerts.push({ kind: 'quotes_follow', severity: 'warning', label: 'Devis envoyés sans réponse', count: quotesToFollow, href: '/devis?statut=sent' });
  if (crmNextActions)
    alerts.push({ kind: 'crm_due', severity: 'warning', label: 'Relances CRM à faire', count: crmNextActions, href: '/crm' });
  if (expiringDocs.length)
    alerts.push({ kind: 'expiring_docs', severity: 'warning', label: 'Documents légaux qui expirent (30 j)', count: expiringDocs.length, href: '/equipe?docs=expiring' });
  if (ctExpiring)
    alerts.push({ kind: 'ct_expiring', severity: 'info', label: 'Contrôles techniques à faire (30 j)', count: ctExpiring, href: '/flotte' });
  if (unpaidFines.length)
    alerts.push({ kind: 'unpaid_fines', severity: 'info', label: 'PV impayés', count: unpaidFines.length, amount: finesAmount, href: '/flotte/pv' });

  const order = { critical: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => order[a.severity] - order[b.severity] || (b.amount ?? 0) - (a.amount ?? 0));

  return {
    kpis: {
      invoicedMonth: round2(invoicedMonth._sum.totalHt ?? 0),
      paidMonth: round2(paidMonth._sum.totalHt ?? 0),
      overdueAmount,
      overdueCount: overdue.length,
      openWorksites,
      hoursWeek: round2(hoursWeek._sum.hours ?? 0),
    },
    alerts,
    expiringDocs: expiringDocs.map((d) => ({
      id: d.id,
      person: d.person.displayName || `${d.person.firstName} ${d.person.lastName ?? ''}`.trim(),
      type: d.type,
      label: d.label,
      expiresOn: d.expiresOn,
    })),
  };
}
