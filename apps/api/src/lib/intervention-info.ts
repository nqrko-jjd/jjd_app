/**
 * Bloc « Intervention » des devis / factures adressés à une ACP (via un syndic) : ce que les syndics exigent pour
 * valider une facture sans aller-retour (Baltimo, novembre 2026) — nom exact de l'ACP, adresse de l'immeuble,
 * entrée / lot, date(s) d'intervention, bon de commande, demandeur, commun ou privatif, rapport signé.
 * Tout est repris du chantier ; `missing` liste ce qui manque pour le signaler avant l'envoi.
 */
import { prisma } from '../db.js';

export interface InterventionInfo {
  building: string | null;
  address: string | null;
  unit: string | null;
  dates: string[]; // ISO (AAAA-MM-JJ), triées
  orderRef: string | null;
  requestedBy: string | null;
  part: 'commun' | 'privatif' | null;
  signedReport: { date: string; signer: string | null } | null;
  missing: string[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function interventionInfo(doc: {
  id: string; kind: string; issuedOn: Date | null; poNumber?: string | null; worksiteId: string | null;
  contact: { name: string; kind?: string | null } | null;
}): Promise<InterventionInfo | null> {
  if (!doc.worksiteId) return null;
  const w = await prisma.worksite.findUnique({
    where: { id: doc.worksiteId },
    select: {
      id: true, address: true, box: true, postalCode: true, city: true, unitLabel: true, clientRef: true, partType: true,
      acp: { select: { name: true, kind: true } },
      contacts: { orderBy: { position: 'asc' }, select: { role: true, name: true } },
    },
  });
  if (!w) return null;
  const forAcp = doc.contact?.kind === 'acp' || doc.contact?.kind === 'developer' || !!w.acp;
  if (!forAcp) return null;

  // période couverte : depuis la facture précédente du même chantier (sinon depuis le début) jusqu'à la date du document
  const until = doc.issuedOn ?? new Date();
  const previous = doc.kind === 'quote' ? null : await prisma.document.findFirst({
    where: { worksiteId: w.id, id: { not: doc.id }, kind: { in: ['invoice', 'deposit_invoice'] }, number: { not: null }, issuedOn: { lt: until } },
    orderBy: { issuedOn: 'desc' }, select: { issuedOn: true },
  });
  const from = previous?.issuedOn ?? null;
  const range = { lte: new Date(until.getTime() + 86_400_000), ...(from ? { gt: from } : {}) };
  const [events, reports] = doc.kind === 'quote' ? [[], []] : await Promise.all([
    prisma.planningEvent.findMany({ where: { worksiteId: w.id, kind: 'intervention', startAt: range }, select: { startAt: true } }),
    prisma.worksiteReport.findMany({ where: { worksiteId: w.id, date: range }, select: { date: true, status: true, signedAt: true, clientName: true }, orderBy: { date: 'desc' } }),
  ]);
  const dates = [...new Set([...events.map((e) => day(e.startAt)), ...reports.map((r) => day(r.date))])].sort();
  const signed = reports.find((r) => r.status === 'signed');
  const requester = w.contacts.find((c) => c.role === 'demandeur') ?? w.contacts.find((c) => c.role === 'gestionnaire') ?? null;
  const address = [[w.address, w.box && `bte ${w.box}`].filter(Boolean).join(' '), [w.postalCode, w.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
  const part = w.partType === 'commun' || w.partType === 'privatif' ? w.partType : null;
  const orderRef = doc.poNumber?.trim() || w.clientRef?.trim() || null;

  const info: InterventionInfo = {
    building: w.acp?.name ?? doc.contact?.name ?? null,
    address, unit: w.unitLabel?.trim() || null, dates, orderRef,
    requestedBy: requester?.name ?? null, part,
    signedReport: signed ? { date: day(signed.signedAt ?? signed.date), signer: signed.clientName } : null,
    missing: [],
  };
  if (doc.kind !== 'quote') {
    if (!info.address) info.missing.push('adresse de l’immeuble (fiche chantier)');
    if (!info.dates.length) info.missing.push('date d’intervention (planning ou rapport)');
    if (!info.requestedBy) info.missing.push('demandeur (contacts du chantier)');
    if (!info.part) info.missing.push('commun ou privatif (fiche chantier)');
    if (!info.orderRef) info.missing.push('bon de commande du syndic, s’il y en a un');
    if (!info.signedReport) info.missing.push('rapport d’intervention signé');
  }
  return info;
}
