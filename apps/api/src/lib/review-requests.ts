/**
 * Demande d'avis client : quelques jours après le paiement complet d'une facture finale, on propose un e-mail court avec le lien vers la page d'avis
 * (Google…). Une seule demande par facture et par client sur 12 mois ; clients « ne plus relancer » exclus ; validation une par une par défaut,
 * envoi automatique seulement si le bureau l'a activé (même calendrier que lib/reminders.ts : semaine 8–18 h, une passe par jour).
 */
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { formatEur } from '@jjd/shared';
import { emailConfigured, sendEmailWithPdf } from './doc-mail.js';
import { getCompany } from './documents.js';
import { fillTemplate } from './reminders.js';

export interface ReviewSettings { autoSend: boolean; copyToSelf: boolean; reviewUrl: string; delayDays: number; maxAgeDays: number; minAmount: number; subject: string; body: string }
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  autoSend: false, copyToSelf: true, reviewUrl: '', delayDays: 3, maxAgeDays: 30, minAmount: 500,
  subject: 'Votre avis sur nos travaux{chantier}',
  body: 'Bonjour,\n\nMerci encore pour votre confiance{chantier}. Nous espérons que les travaux vous donnent entière satisfaction.\n\nSi vous avez 1 minute, votre avis nous aide beaucoup à nous faire connaître :\n{lien}\n\nEt s’il y a quoi que ce soit qui ne vous convienne pas, répondez simplement à ce message : nous le réglerons en priorité.\n\nMerci d’avance,\n{societe}\n{telephone}',
};

const KEY = 'reviewRequests';
export async function getReviewSettings(): Promise<ReviewSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { ...DEFAULT_REVIEW_SETTINGS, ...((row?.value ?? {}) as Partial<ReviewSettings>) };
}
export async function saveReviewSettings(i: ReviewSettings): Promise<ReviewSettings> {
  const reviewUrl = String(i.reviewUrl ?? '').trim();
  if (reviewUrl && !/^https:\/\/\S+$/.test(reviewUrl)) throw new HttpError(422, 'Le lien d’avis doit commencer par https://');
  const clean: ReviewSettings = {
    autoSend: !!i.autoSend, copyToSelf: !!i.copyToSelf, reviewUrl,
    delayDays: Math.min(60, Math.max(0, Math.round(Number(i.delayDays) || 0))), maxAgeDays: Math.min(180, Math.max(7, Math.round(Number(i.maxAgeDays) || 30))),
    minAmount: Math.max(0, Number(i.minAmount) || 0), subject: String(i.subject).slice(0, 200), body: String(i.body).slice(0, 4000),
  };
  if (!clean.subject.trim() || !clean.body.trim()) throw new HttpError(422, 'L’objet et le texte sont obligatoires.');
  if (clean.autoSend && !clean.reviewUrl) throw new HttpError(422, 'Indiquez le lien de la page d’avis avant d’activer l’envoi automatique.');
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: clean as never }, update: { value: clean as never } });
  return clean;
}

const DAY = 86_400_000;
export interface ReviewProposal {
  documentId: string; number: string | null; client: string; contactId: string | null; to: string | null; totalTtc: number; paidOn: Date; daysSince: number;
  subject: string; body: string; blocked: string | null; worksiteRef: string | null;
}

export async function computeReviewProposals(now = new Date()): Promise<ReviewProposal[]> {
  const s = await getReviewSettings();
  const company = await getCompany();
  const docs = await prisma.document.findMany({
    where: {
      kind: 'invoice', status: 'paid', source: { not: 'demo' }, totalTtc: { gte: s.minAmount },
      paidOn: { gte: new Date(now.getTime() - s.maxAgeDays * DAY), lte: new Date(now.getTime() - s.delayDays * DAY) },
    },
    include: { contact: { select: { id: true, name: true, email: true, reminderMode: true } }, worksite: { select: { ref: true } } },
    orderBy: { paidOn: 'desc' },
  });
  if (!docs.length) return [];
  const contactIds = docs.map((d) => d.contactId).filter((x): x is string => !!x);
  const done = await prisma.reviewRequest.findMany({
    where: { OR: [{ documentId: { in: docs.map((d) => d.id) } }, { contactId: { in: contactIds }, status: 'sent', sentAt: { gte: new Date(now.getTime() - 365 * DAY) } }] },
  });
  const doneDocs = new Set(done.map((r) => r.documentId));
  const doneContacts = new Set(done.filter((r) => r.status === 'sent').map((r) => r.contactId));
  // une facture corrigée par une note de crédit n'est pas un chantier réussi : pas de demande d'avis
  const credited = new Set((await prisma.document.findMany({ where: { kind: 'credit_note', parentId: { in: docs.map((d) => d.id) } }, select: { parentId: true } })).map((c) => c.parentId));
  const seen = new Set<string>();
  const out: ReviewProposal[] = [];
  for (const d of docs) {
    if (doneDocs.has(d.id) || !d.paidOn || credited.has(d.id) || d.contact?.reminderMode === 'off') continue;
    if (d.contact && doneContacts.has(d.contact.id)) continue;
    const key = d.contact?.id ?? d.id;
    if (seen.has(key)) continue; // un seul envoi par client dans la liste
    seen.add(key);
    const vars = {
      client: d.billingName ?? d.contact?.name ?? '', numero: d.number ?? '', montant: formatEur(d.totalTtc), lien: s.reviewUrl || '[lien à renseigner dans les réglages]',
      chantier: d.worksite ? ` (chantier ${d.worksite.ref})` : '', societe: company.name, telephone: company.phone ?? '',
    };
    const to = d.billingEmail ?? d.contact?.email ?? null;
    out.push({
      documentId: d.id, number: d.number, client: d.billingName ?? d.contact?.name ?? '—', contactId: d.contact?.id ?? null, to, totalTtc: d.totalTtc, paidOn: d.paidOn,
      daysSince: Math.floor((now.getTime() - d.paidOn.getTime()) / DAY), subject: fillTemplate(s.subject, vars), body: fillTemplate(s.body, vars).replace(/\n{3,}/g, '\n\n').trimEnd(),
      blocked: !s.reviewUrl ? 'Lien d’avis non renseigné' : to ? null : 'Aucune adresse e-mail pour ce client', worksiteRef: d.worksite?.ref ?? null,
    });
  }
  return out;
}

export async function sendReviewRequest(documentId: string, o: { subject?: string; body?: string; to?: string; auto?: boolean; userId?: string | null }): Promise<{ to: string }> {
  if (!emailConfigured()) throw new HttpError(503, 'Envoi par e-mail non configuré.');
  const p = (await computeReviewProposals()).find((x) => x.documentId === documentId);
  if (!p) throw new HttpError(409, 'Cette demande d’avis n’est plus à faire (déjà envoyée, ignorée ou trop ancienne).');
  const settings = await getReviewSettings();
  if (!settings.reviewUrl) throw new HttpError(422, 'Renseignez d’abord le lien de la page d’avis dans les réglages.');
  const to = (o.to ?? p.to ?? '').trim();
  if (!to) throw new HttpError(422, 'Aucune adresse e-mail pour ce client.');
  const subject = (o.subject ?? p.subject).trim();
  const body = (o.body ?? p.body).trim();
  if (!body.includes(settings.reviewUrl)) throw new HttpError(422, 'Le message doit contenir le lien de la page d’avis.');
  const common = { documentId, contactId: p.contactId, auto: !!o.auto, toEmail: to, subject, body, sentById: o.userId ?? null };
  try {
    await sendEmailWithPdf({ to: [to], subject, message: body, copyToSelf: settings.copyToSelf }, { buffer: Buffer.alloc(0), filename: '' }, true);
  } catch (e) {
    await prisma.reviewRequest.upsert({ where: { documentId }, create: { ...common, status: 'failed', error: (e as Error).message.slice(0, 300) }, update: { status: 'failed', error: (e as Error).message.slice(0, 300) } });
    throw e;
  }
  await prisma.reviewRequest.upsert({ where: { documentId }, create: { ...common, status: 'sent', sentAt: new Date() }, update: { ...common, status: 'sent', error: null, sentAt: new Date() } });
  await prisma.auditLog.create({ data: { actorId: o.userId ?? null, action: 'review.request', entity: 'document', entityId: documentId, meta: { to, auto: !!o.auto } } });
  return { to };
}

export async function skipReviewRequest(documentId: string, userId: string | null): Promise<void> {
  const d = await prisma.document.findUnique({ where: { id: documentId }, select: { contactId: true } });
  await prisma.reviewRequest.upsert({ where: { documentId }, create: { documentId, contactId: d?.contactId ?? null, status: 'skipped', sentById: userId }, update: { status: 'skipped' } });
}

export async function runAutoReviewRequests(now = new Date()): Promise<number> {
  const settings = await getReviewSettings();
  if (!settings.autoSend || !settings.reviewUrl || !emailConfigured()) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  if (['Sat', 'Sun'].includes(wd) || hour < 8 || hour >= 18) return 0;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now);
  const lastKey = 'reviewRequests:lastRun';
  const last = await prisma.setting.findUnique({ where: { key: lastKey } });
  if ((last?.value as { day?: string } | null)?.day === day) return 0;
  await prisma.setting.upsert({ where: { key: lastKey }, create: { key: lastKey, value: { day } }, update: { value: { day } } });
  let sent = 0;
  for (const p of (await computeReviewProposals(now)).filter((x) => !x.blocked).slice(0, 10)) {
    try { await sendReviewRequest(p.documentId, { auto: true }); sent++; } catch (e) { console.error('[demande d’avis] échec :', (e as Error).message); }
  }
  return sent;
}
