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

  const ACTIVE_STATUS = ['scheduled', 'in_progress', 'on_hold'];

  const [
    invoicedMonth, paidMonth, overdue, receivable, quotesPending, worksitesToInvoice,
    expiringDocs, ctExpiring, activeCount, activeWorksites,
    crmNextActions,
  ] = await Promise.all([
    prisma.document.aggregate({
      where: { kind: 'invoice', issuedOn: { gte: monthStart } }, _sum: { totalHt: true },
    }),
    prisma.document.aggregate({
      where: { kind: 'invoice', status: 'paid', issuedOn: { gte: monthStart } }, _sum: { totalHt: true },
    }),
    prisma.document.findMany({ where: { kind: 'invoice', status: 'overdue' } }),
    prisma.document.findMany({ where: { kind: 'invoice', status: { in: ['sent', 'partial', 'overdue'] } } }),
    prisma.document.findMany({ where: { kind: 'quote', status: 'sent' } }),
    prisma.worksite.count({ where: { status: 'to_invoice', archived: false } }),
    prisma.legalDoc.findMany({
      where: { expiresOn: { not: null, lte: in30 } },
      include: { person: true },
    }),
    prisma.vehicle.count({ where: { nextInspection: { not: null, lte: in30 } } }),
    prisma.worksite.count({ where: { archived: false, kind: 'project', status: { in: ACTIVE_STATUS } } }),
    prisma.worksite.findMany({
      where: { archived: false, kind: 'project', status: { in: ACTIVE_STATUS } },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      include: { client: { select: { name: true } }, manager: { select: { displayName: true, firstName: true } } },
    }),
    prisma.crmOpportunity.count({
      where: { stage: { notIn: ['won', 'lost'] }, nextActionOn: { not: null, lte: now } },
    }),
  ]);

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
      paidMonth: round2(paidMonth._sum.totalHt ?? 0),
      overdueAmount,
      overdueCount: overdue.length,
      openWorksites: activeCount,
      receivableAmount,
      quotesPendingAmount,
      quotesPendingCount: quotesPending.length,
    },
    alerts,
    inProgress: activeWorksites.map((w) => ({
      id: w.id,
      ref: w.ref,
      title: w.title,
      city: w.city,
      status: w.status,
      client: w.client?.name ?? null,
      manager: w.manager?.displayName || w.manager?.firstName || null,
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
