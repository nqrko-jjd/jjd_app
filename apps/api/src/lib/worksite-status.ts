import { prisma } from '../db.js';
import { WORKSITE_STATUS_LABEL, type WorksiteStatus } from '@jjd/shared';
import { worksiteQuotedHtBatch, worksiteInvoicedHtBatch } from './worksite-margin.js';

/**
 * Statut d'un chantier qui avance tout seul, au gré de ce qui se passe (devis, planning, pointage, factures, paiements).
 *
 *   Demande → Devis à faire → À planifier → Planifié → En cours → Terminé → À facturer → Facturé → Clôturé
 *                                          (+ « En observation / attente », « Refusé », « Abandonné » à côté)
 *
 * Principes :
 *  - on AVANCE ; seul retour en arrière : « Planifié » → « À planifier » quand la dernière intervention disparaît ; « Clôturé » ne bouge plus ;
 *  - « Abandonné » n'est jamais touché ; « Refusé » ne repart que si un devis est finalement accepté ;
 *  - « En observation / attente » ne reprend que si on planifie une intervention ou si on pointe sur le chantier ;
 *  - un changement manuel de statut reste ce qu'il est : l'automatisme ne réagit qu'à un NOUVEL événement du chantier ;
 *  - chaque changement automatique est tracé (journal + « Dernière activité » du chantier).
 */
export type StatusTrigger = 'event' | 'timesheet' | 'document' | 'sweep' | 'field-done';

export interface StatusSignals {
  status: string;
  /** devis émis du chantier */
  quotes: { accepted: number; sent: number; declined: number };
  /** devisé HT (devis acceptés, à défaut envoyés, à défaut montant historique) ; 0 si inconnu */
  quotedHt: number;
  /** facturé HT net des notes de crédit */
  invoicedHt: number;
  /** factures de vente émises (grand livre) */
  invoices: number;
  creditNotes: number;
  /** toutes les factures émises sont payées */
  allPaid: boolean;
  /** au moins une intervention (pas un RDV) prévue après aujourd'hui / démarrée (aujourd'hui ou avant) */
  futureIntervention: boolean;
  startedIntervention: boolean;
  anyIntervention: boolean;
  hasTimesheet: boolean;
}

const PRE_WORK = ['lead', 'quote_needed', 'to_plan', 'scheduled'];
const FINISHED = ['done', 'to_invoice', 'invoiced', 'closed'];

type Step = { to: WorksiteStatus; reason: string };

/** UNE transition à partir du statut courant (ou null). */
function step(s: string, sig: StatusSignals, trigger: StatusTrigger): Step | null {
  if (s === 'cancelled') return null;
  // « Clôturé » est définitif pour l'automatisme : l'historique importé (notes de crédit, factures « non payées » de l'Excel…) n'est pas assez
  // fiable pour rouvrir un dossier tout seul — on ne rouvre qu'à la main
  if (s === 'closed') return null;
  if (s === 'refused') return trigger === 'document' && sig.quotes.accepted > 0 ? { to: 'to_plan', reason: 'devis finalement accepté' } : null;

  // ---- facturation / encaissement (déclenchés par un document, un paiement, ou la fin signalée sur le terrain)
  if (trigger === 'document' || trigger === 'field-done') {
    const hasQuote = sig.quotedHt > 0;
    const tol = Math.max(1, sig.quotedHt * 0.02);
    // pas de devis connu : « entièrement facturé » seulement si le travail est fini et qu'au moins une facture existe
    const fully = sig.invoices > 0 && (hasQuote ? sig.invoicedHt + tol >= sig.quotedHt : FINISHED.includes(s) && sig.invoicedHt > 0);
    if (fully) {
      const to: WorksiteStatus = sig.allPaid ? 'closed' : 'invoiced';
      if (s !== to) return { to, reason: sig.allPaid ? 'tout est facturé et encaissé' : 'tout est facturé' };
    } else {
      // terminé sur le terrain mais pas (entièrement) facturé
      if (s === 'done') return { to: 'to_invoice', reason: 'terminé, reste à facturer' };
      // un acompte émis = le client s'engage
      if ((s === 'lead' || s === 'quote_needed') && sig.invoices > 0) return { to: 'to_plan', reason: 'acompte facturé' };
    }
    if (trigger === 'document') {
      if ((s === 'lead' || s === 'quote_needed') && sig.quotes.accepted > 0) return { to: 'to_plan', reason: 'devis accepté' };
      if (['lead', 'quote_needed', 'to_plan'].includes(s) && sig.quotes.declined > 0 && sig.quotes.accepted === 0 && sig.quotes.sent === 0 && sig.invoices === 0 && !sig.anyIntervention) {
        return { to: 'refused', reason: 'devis refusé' };
      }
    }
  }

  // ---- terrain : planning et pointage
  const mayResume = s === 'on_hold' && (trigger === 'event' || trigger === 'timesheet');
  if (PRE_WORK.includes(s) || mayResume) {
    if (sig.startedIntervention || (trigger === 'timesheet' && sig.hasTimesheet)) return { to: 'in_progress', reason: trigger === 'timesheet' ? 'premier pointage' : 'intervention démarrée' };
    if (sig.futureIntervention && s !== 'scheduled') return { to: 'scheduled', reason: 'intervention planifiée' };
  }
  // reculs : la dernière intervention planifiée a été supprimée / déplacée avant d'avoir commencé
  if (s === 'scheduled' && trigger === 'event' && !sig.futureIntervention && !sig.startedIntervention) return { to: 'to_plan', reason: 'plus aucune intervention planifiée' };
  return null;
}

/** Enchaîne les transitions (ex. devis accepté puis intervention déjà planifiée → Planifié) jusqu'à stabilité. */
export function nextWorksiteStatus(sig: StatusSignals, trigger: StatusTrigger): { to: WorksiteStatus; reason: string } | null {
  let s = sig.status;
  const reasons: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = step(s, sig, trigger);
    if (!t || t.to === s) break;
    s = t.to;
    reasons.push(t.reason);
  }
  return s === sig.status ? null : { to: s as WorksiteStatus, reason: reasons.join(' → ') };
}

async function loadSignals(id: string, status: string, historicQuotedHt: number | null): Promise<StatusSignals> {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
  const [quoteDocs, quotedMap, invoicedMap, sales, creditNotes, events, timesheets] = await Promise.all([
    prisma.document.findMany({ where: { kind: 'quote', worksiteId: id, lockedAt: { not: null } }, select: { status: true } }),
    worksiteQuotedHtBatch([id]),
    worksiteInvoicedHtBatch([id]),
    prisma.ledgerEntry.findMany({ where: { worksiteId: id, direction: 'sale' }, select: { paymentStatus: true } }),
    prisma.ledgerEntry.count({ where: { worksiteId: id, direction: 'credit_note' } }),
    prisma.planningEvent.findMany({ where: { worksiteId: id, kind: 'intervention' }, select: { startAt: true } }),
    prisma.timeEntry.count({ where: { worksiteId: id } }),
  ]);
  const count = (st: string) => quoteDocs.filter((q) => q.status === st).length;
  return {
    status,
    quotes: { accepted: count('accepted'), sent: count('sent'), declined: count('declined') },
    quotedHt: quotedMap.get(id) ?? historicQuotedHt ?? 0,
    invoicedHt: invoicedMap.get(id) ?? 0,
    invoices: sales.length,
    creditNotes,
    allPaid: sales.length > 0 && sales.every((e) => e.paymentStatus === 'Payé'),
    futureIntervention: events.some((e) => e.startAt >= startOfTomorrow),
    startedIntervention: events.some((e) => e.startAt < startOfTomorrow),
    anyIntervention: events.length > 0,
    hasTimesheet: timesheets > 0,
  };
}

/**
 * Réévalue le statut d'un chantier après un événement et l'applique si besoin. Silencieux : une erreur ici
 * ne doit jamais empêcher l'opération qui l'a déclenchée (émettre une facture, planifier…).
 * Renvoie le nouveau statut, ou null s'il n'a pas changé.
 */
export async function refreshWorksiteStatus(worksiteId: string | null | undefined, trigger: StatusTrigger): Promise<WorksiteStatus | null> {
  if (!worksiteId) return null;
  try {
    const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { id: true, ref: true, status: true, kind: true, source: true, quotedHt: true } });
    if (!ws || ws.kind !== 'project' || ws.source === 'demo') return null;
    const next = nextWorksiteStatus(await loadSignals(ws.id, ws.status, ws.quotedHt), trigger);
    if (!next) return null;
    await prisma.worksite.update({
      where: { id: ws.id },
      // un chantier clôturé est archivé (et désarchivé s'il sort de « Clôturé »), comme à la main
      data: { status: next.to, ...(next.to === 'closed' ? { archived: true } : ws.status === 'closed' ? { archived: false } : {}) },
    });
    await prisma.auditLog.create({
      data: {
        action: 'auto_status', entity: 'worksite', entityId: ws.id,
        meta: { from: ws.status, to: next.to, reason: next.reason, trigger, label: `Statut passé automatiquement de « ${WORKSITE_STATUS_LABEL[ws.status as WorksiteStatus] ?? ws.status} » à « ${WORKSITE_STATUS_LABEL[next.to]} » (${next.reason})` },
      },
    });
    return next.to;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[statut chantier] échec :', (e as Error).message);
    return null;
  }
}

/**
 * Passage du temps : un chantier « À planifier » / « Planifié » dont une intervention démarre AUJOURD'HUI passe « En cours ».
 * Ne regarde que les interventions du jour (pas de rattrapage massif de l'historique) ; rejouable à volonté.
 */
export async function sweepWorksiteStatuses(): Promise<number> {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
  const rows = await prisma.worksite.findMany({
    where: {
      kind: 'project', status: { in: ['to_plan', 'scheduled'] },
      events: { some: { kind: 'intervention', startAt: { gte: startOfToday, lt: startOfTomorrow } } },
    },
    select: { id: true },
  });
  let n = 0;
  for (const r of rows) if (await refreshWorksiteStatus(r.id, 'sweep')) n++;
  return n;
}
