/**
 * Alimente la pipeline commerciale (CRM) à partir des chantiers : un chantier « Devis envoyé » y apparaît tout seul dans la colonne « Devis envoyé »,
 * passe « Gagné » dès que le devis est accepté (chantier à planifier, planifié, en cours…), « Perdu » s'il est refusé ou abandonné,
 * et « Relancé » quand une relance de devis part. Une carte = un chantier (CrmOpportunity.worksiteId est unique).
 * Ne touche JAMAIS une opportunité non reliée à un chantier (saisie à la main) ; best-effort : une erreur ici n'empêche pas l'opération qui l'a déclenchée.
 */
import { prisma } from '../db.js';

const OPEN_EARLY = ['new', 'to_qualify', 'visit_scheduled'];
const OPEN = [...OPEN_EARLY, 'quote_sent', 'follow_up'];
const ACCEPTED_STATUSES = ['to_plan', 'scheduled', 'in_progress', 'done', 'to_invoice', 'invoiced', 'closed'];

/** Montant de la carte : devis envoyés en attente (à défaut acceptés, à défaut devisé du chantier). */
async function pipelineValue(worksiteId: string, quotedHt: number | null): Promise<number | null> {
  const quotes = await prisma.document.findMany({ where: { worksiteId, kind: 'quote', lockedAt: { not: null }, status: { in: ['sent', 'accepted'] } }, select: { status: true, totalHt: true } });
  const sum = (st: string) => Math.round(quotes.filter((q) => q.status === st).reduce((s, q) => s + q.totalHt, 0) * 100) / 100;
  return sum('sent') || sum('accepted') || quotedHt || null;
}

export async function syncCrmFromWorksite(worksiteId: string | null | undefined): Promise<void> {
  if (!worksiteId) return;
  try {
    const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { id: true, title: true, status: true, kind: true, source: true, clientId: true, acpId: true, quotedHt: true } });
    if (!ws || ws.kind !== 'project' || ws.source === 'demo') return;
    const opp = await prisma.crmOpportunity.findUnique({ where: { worksiteId: ws.id } });

    if (ws.status === 'quote_sent') {
      const value = await pipelineValue(ws.id, ws.quotedHt);
      if (!opp) {
        await prisma.crmOpportunity.create({ data: { title: ws.title, stage: 'quote_sent', contactId: ws.clientId, acpId: ws.acpId, worksiteId: ws.id, estimatedValue: value, source: 'devis envoyé' } });
      } else {
        const stage = OPEN_EARLY.includes(opp.stage) || !OPEN.includes(opp.stage) ? 'quote_sent' : opp.stage; // une carte déjà « Relancé » le reste
        await prisma.crmOpportunity.update({ where: { id: opp.id }, data: { stage, estimatedValue: value ?? opp.estimatedValue, ...(stage !== opp.stage ? { lostReason: null } : {}) } });
      }
      return;
    }
    if (!opp || !OPEN.includes(opp.stage)) return;
    if (ACCEPTED_STATUSES.includes(ws.status)) await prisma.crmOpportunity.update({ where: { id: opp.id }, data: { stage: 'won' } });
    else if (ws.status === 'refused' || ws.status === 'cancelled') await prisma.crmOpportunity.update({ where: { id: opp.id }, data: { stage: 'lost', lostReason: opp.lostReason ?? (ws.status === 'refused' ? 'autre' : 'projet_annule') } });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[pipeline] synchro impossible :', (e as Error).message);
  }
}

/** Une relance de devis est partie : la carte du chantier passe « Relancé » (seulement depuis « Devis envoyé »). */
export async function markCrmFollowedUp(worksiteId: string | null | undefined): Promise<void> {
  if (!worksiteId) return;
  await prisma.crmOpportunity.updateMany({ where: { worksiteId, stage: 'quote_sent' }, data: { stage: 'follow_up' } }).catch(() => undefined);
}
