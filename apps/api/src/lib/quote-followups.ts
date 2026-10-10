/**
 * Suivi des devis envoyés restés sans réponse : relance courtoise à J+7, J+21, J+45 après l'envoi (réglable), avec le devis en PDF.
 * Même principe que les relances de factures (lib/reminders.ts) : une seule proposition par devis (la plus haute étape atteinte), jamais deux d'un coup,
 * validation une par une par défaut, envoi automatique seulement si le bureau l'a activé. Les devis trop anciens (froids) ne sont plus proposés.
 */
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { formatEur, formatDateBE } from '@jjd/shared';
import { emailConfigured, sendEmailWithPdf } from './doc-mail.js';
import { getCompany } from './documents.js';
import { fillTemplate } from './reminders.js';

export interface FollowupStep { daysAfterSent: number; subject: string; body: string }
export interface FollowupSettings { autoSend: boolean; copyToSelf: boolean; minDaysBetween: number; maxAgeDays: number; steps: FollowupStep[] }

const SIGN = '\n\nCordialement,\n{societe}\n{telephone}';
export const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettings = {
  autoSend: false, copyToSelf: true, minDaysBetween: 7, maxAgeDays: 90,
  steps: [
    { daysAfterSent: 7, subject: 'Votre devis {numero} — avez-vous des questions ?',
      body: 'Bonjour,\n\nNous vous avons transmis le devis {numero} ({montant} TTC) il y a {jours} jours{chantier}.\nAvez-vous pu en prendre connaissance ? Nous restons à votre disposition pour en discuter, l’ajuster ou planifier une visite.' + SIGN },
    { daysAfterSent: 21, subject: 'Devis {numero} : votre projet est-il toujours d’actualité ?',
      body: 'Bonjour,\n\nSans nouvelle de votre part depuis l’envoi du devis {numero} ({montant} TTC), nous nous permettons de revenir vers vous.\nSi votre projet est toujours d’actualité, nous pouvons réserver une date dans notre planning dès votre accord ; sinon, n’hésitez pas à nous dire ce qui vous retient, nous ferons de notre mieux pour y répondre.' + SIGN },
    { daysAfterSent: 45, subject: 'Dernier suivi pour le devis {numero}',
      body: 'Bonjour,\n\nNous clôturons prochainement le suivi de notre devis {numero} ({montant} TTC), envoyé il y a {jours} jours.\nSi vous souhaitez le maintenir ou le modifier, répondez simplement à ce message ; nous le mettrons à jour avec plaisir.' + SIGN },
  ],
};

const KEY = 'quoteFollowups';
export async function getFollowupSettings(): Promise<FollowupSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<FollowupSettings>;
  const steps = Array.isArray(v.steps) && v.steps.length ? v.steps : DEFAULT_FOLLOWUP_SETTINGS.steps;
  return { ...DEFAULT_FOLLOWUP_SETTINGS, ...v, steps: [...steps].sort((a, b) => a.daysAfterSent - b.daysAfterSent) };
}
export async function saveFollowupSettings(input: FollowupSettings): Promise<FollowupSettings> {
  const clean: FollowupSettings = {
    autoSend: !!input.autoSend, copyToSelf: !!input.copyToSelf,
    minDaysBetween: Math.max(1, Math.round(Number(input.minDaysBetween) || 7)), maxAgeDays: Math.max(14, Math.round(Number(input.maxAgeDays) || 90)),
    steps: input.steps.slice(0, 6).map((s) => ({ daysAfterSent: Math.max(1, Math.round(Number(s.daysAfterSent))), subject: String(s.subject).slice(0, 200), body: String(s.body).slice(0, 4000) })).sort((a, b) => a.daysAfterSent - b.daysAfterSent),
  };
  if (!clean.steps.length || clean.steps.some((s) => !s.subject.trim() || !s.body.trim())) throw new HttpError(422, 'Chaque étape de suivi a besoin d’un objet et d’un texte.');
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: clean as never }, update: { value: clean as never } });
  return clean;
}

const DAY = 86_400_000;
export interface QuoteProposal {
  documentId: string; number: string | null; client: string; contactId: string | null; to: string | null; totalTtc: number; sentOn: Date; daysSince: number;
  step: number; stepCount: number; subject: string; body: string; blocked: string | null; worksiteRef: string | null; lastFollowupAt: Date | null;
}

export async function computeQuoteProposals(now = new Date()): Promise<QuoteProposal[]> {
  const settings = await getFollowupSettings();
  const company = await getCompany();
  const docs = await prisma.document.findMany({
    where: { kind: 'quote', lockedAt: { not: null }, status: 'sent', source: { not: 'demo' } },
    include: { contact: { select: { id: true, name: true, email: true, reminderMode: true } }, worksite: { select: { ref: true } }, reminders: true },
    orderBy: { issuedOn: 'desc' },
  });
  const out: QuoteProposal[] = [];
  for (const d of docs) {
    if (d.contact?.reminderMode === 'off') continue;
    const sentOn = d.sentAt ?? d.issuedOn;
    if (!sentOn) continue;
    const daysSince = Math.floor((now.getTime() - sentOn.getTime()) / DAY);
    if (daysSince > settings.maxAgeDays) continue;
    const reached = settings.steps.map((s, i) => ({ s, n: i + 1 })).filter((x) => x.s.daysAfterSent <= daysSince);
    if (!reached.length) continue;
    const maxDone = Math.max(0, ...d.reminders.map((r) => r.step));
    const next = [...reached].reverse().find((x) => x.n > maxDone);
    if (!next) continue;
    const lastSent = d.reminders.filter((r) => r.status === 'sent' && r.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0]?.sentAt ?? null;
    if (lastSent && (now.getTime() - lastSent.getTime()) / DAY < settings.minDaysBetween) continue;
    const vars = {
      client: d.billingName ?? d.contact?.name ?? '', numero: d.number ?? d.draftRef ?? '', montant: formatEur(d.totalTtc), jours: String(daysSince), envoye: formatDateBE(sentOn),
      validite: d.validUntil ? formatDateBE(d.validUntil) : '', chantier: d.worksite ? ` (chantier ${d.worksite.ref})` : '', societe: company.name, telephone: company.phone ?? '',
    };
    const to = d.billingEmail ?? d.contact?.email ?? null;
    out.push({
      documentId: d.id, number: d.number, client: d.billingName ?? d.contact?.name ?? '—', contactId: d.contact?.id ?? null, to, totalTtc: d.totalTtc, sentOn, daysSince,
      step: next.n, stepCount: settings.steps.length, subject: fillTemplate(next.s.subject, vars), body: fillTemplate(next.s.body, vars).replace(/\n{3,}/g, '\n\n').trimEnd(),
      blocked: to ? null : 'Aucune adresse e-mail pour ce client', worksiteRef: d.worksite?.ref ?? null, lastFollowupAt: lastSent,
    });
  }
  return out;
}

export async function sendQuoteFollowup(
  documentId: string, step: number, o: { subject?: string; body?: string; to?: string; auto?: boolean; userId?: string | null; pdf: (id: string) => Promise<{ buffer: Buffer; filename: string }> },
): Promise<{ to: string }> {
  if (!emailConfigured()) throw new HttpError(503, 'Envoi par e-mail non configuré.');
  const proposal = (await computeQuoteProposals()).find((p) => p.documentId === documentId && p.step === step);
  if (!proposal) throw new HttpError(409, 'Ce suivi n’est plus à faire (devis accepté, refusé, déjà relancé ou trop ancien).');
  const to = (o.to ?? proposal.to ?? '').trim();
  if (!to) throw new HttpError(422, 'Aucune adresse e-mail pour ce client.');
  const settings = await getFollowupSettings();
  const subject = (o.subject ?? proposal.subject).trim();
  const body = (o.body ?? proposal.body).trim();
  const common = { documentId, step, auto: !!o.auto, toEmail: to, subject, body, daysLate: proposal.daysSince, balance: proposal.totalTtc, sentById: o.userId ?? null };
  try {
    await sendEmailWithPdf({ to: [to], subject, message: body, copyToSelf: settings.copyToSelf }, await o.pdf(documentId));
  } catch (e) {
    await prisma.invoiceReminder.upsert({ where: { documentId_step: { documentId, step } }, create: { ...common, status: 'failed', error: (e as Error).message.slice(0, 300) }, update: { status: 'failed', error: (e as Error).message.slice(0, 300) } });
    throw e;
  }
  await prisma.invoiceReminder.upsert({ where: { documentId_step: { documentId, step } }, create: { ...common, status: 'sent', sentAt: new Date() }, update: { ...common, status: 'sent', error: null, sentAt: new Date() } });
  await prisma.auditLog.create({ data: { actorId: o.userId ?? null, action: 'quote.followup', entity: 'document', entityId: documentId, meta: { step, to, auto: !!o.auto } } });
  return { to };
}

export async function runAutoFollowups(pdf: (id: string) => Promise<{ buffer: Buffer; filename: string }>, now = new Date()): Promise<number> {
  const settings = await getFollowupSettings();
  if (!settings.autoSend || !emailConfigured()) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  if (['Sat', 'Sun'].includes(wd) || hour < 8 || hour >= 18) return 0;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now);
  const lastKey = 'quoteFollowups:lastRun';
  const last = await prisma.setting.findUnique({ where: { key: lastKey } });
  if ((last?.value as { day?: string } | null)?.day === day) return 0;
  await prisma.setting.upsert({ where: { key: lastKey }, create: { key: lastKey, value: { day } }, update: { value: { day } } });
  let sent = 0;
  for (const p of (await computeQuoteProposals(now)).filter((x) => x.to).slice(0, 25)) {
    try { await sendQuoteFollowup(p.documentId, p.step, { auto: true, pdf }); sent++; } catch (e) { console.error('[suivi devis] échec :', (e as Error).message); }
  }
  return sent;
}
