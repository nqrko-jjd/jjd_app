/**
 * Relances de paiement des factures impayées.
 *
 * Calendrier (réglable) : étape 1 à J+7 après l'échéance, étape 2 à J+21, étape 3 à J+45… Pour chaque facture en retard, on propose la PLUS HAUTE étape
 * atteinte qui n'a pas encore été traitée (envoyée ou ignorée) ; les étapes plus anciennes jamais traitées sont classées « ignorées » (jamais deux relances d'un coup).
 * Deux modes : à valider une par une depuis l'écran « Relances » (par défaut), ou envoi automatique (réglage, désactivé tant que le bureau ne l'a pas activé).
 * Jamais de relance : facture soldée / créditée, client marqué « ne pas relancer », ou moins de 7 jours depuis la dernière relance.
 */
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { formatEur, formatDateBE } from '@jjd/shared';
import { emailConfigured, sendEmailWithPdf } from './doc-mail.js';
import { getCompany } from './documents.js';

export interface ReminderStep { daysAfterDue: number; subject: string; body: string }
export interface ReminderSettings { autoSend: boolean; copyToSelf: boolean; minBalance: number; minDaysBetween: number; steps: ReminderStep[] }

const SIGN = '\n\nCordialement,\n{societe}\n{telephone}';
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  autoSend: false,
  copyToSelf: true,
  minBalance: 20,
  minDaysBetween: 7,
  steps: [
    { daysAfterDue: 7, subject: 'Rappel : facture {numero} échue le {echeance}',
      body: 'Bonjour,\n\nSauf erreur de notre part, la facture {numero} d’un montant de {restant} TTC, échue le {echeance}, n’a pas encore été réglée.\nSi le paiement est déjà en cours, merci de ne pas tenir compte de ce message.\n\nCommunication structurée : {communication}' + SIGN },
    { daysAfterDue: 21, subject: '2e rappel : facture {numero} impayée ({jours} jours de retard)',
      body: 'Bonjour,\n\nMalgré notre précédent rappel, la facture {numero} de {restant} TTC (échue le {echeance}) reste impayée à ce jour.\nNous vous remercions de procéder au règlement dans les meilleurs délais, ou de nous contacter si un point pose problème.\n\nCommunication structurée : {communication}' + SIGN },
    { daysAfterDue: 45, subject: 'Dernier rappel avant mise en demeure : facture {numero}',
      body: 'Bonjour,\n\nLa facture {numero} de {restant} TTC, échue le {echeance} ({jours} jours de retard), n’est toujours pas réglée.\nSans paiement de votre part sous 8 jours, nous serons contraints d’appliquer les intérêts et indemnités prévus à nos conditions et d’engager la procédure de recouvrement.\n\nCommunication structurée : {communication}' + SIGN },
  ],
};

const KEY = 'reminders';
export async function getReminderSettings(): Promise<ReminderSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<ReminderSettings>;
  const steps = Array.isArray(v.steps) && v.steps.length ? v.steps : DEFAULT_REMINDER_SETTINGS.steps;
  return { ...DEFAULT_REMINDER_SETTINGS, ...v, steps: [...steps].sort((a, b) => a.daysAfterDue - b.daysAfterDue) };
}
export async function saveReminderSettings(input: ReminderSettings): Promise<ReminderSettings> {
  const clean: ReminderSettings = {
    autoSend: !!input.autoSend, copyToSelf: !!input.copyToSelf,
    minBalance: Math.max(0, Number(input.minBalance) || 0), minDaysBetween: Math.max(1, Math.round(Number(input.minDaysBetween) || 7)),
    steps: input.steps.slice(0, 6).map((s) => ({ daysAfterDue: Math.max(1, Math.round(Number(s.daysAfterDue))), subject: String(s.subject).slice(0, 200), body: String(s.body).slice(0, 4000) })).sort((a, b) => a.daysAfterDue - b.daysAfterDue),
  };
  if (!clean.steps.length || clean.steps.some((s) => !s.subject.trim() || !s.body.trim())) throw new HttpError(422, 'Chaque étape de relance a besoin d’un objet et d’un texte.');
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: clean as never }, update: { value: clean as never } });
  return clean;
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function fillTemplate(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k]! : m));
}

type DocForReminder = {
  id: string; number: string | null; draftRef: string | null; totalTtc: number; paidAmount: number; dueOn: Date | null; structuredComm: string | null;
  billingEmail: string | null; billingName: string | null; contact: { id: string; name: string; email: string | null } | null;
};

export function composeReminder(doc: DocForReminder, step: ReminderStep, company: { name: string; phone: string }, daysLate: number) {
  const balance = round2(doc.totalTtc - doc.paidAmount);
  const vars = {
    client: doc.billingName ?? doc.contact?.name ?? '', numero: doc.number ?? doc.draftRef ?? '', montant: formatEur(doc.totalTtc), restant: formatEur(balance),
    echeance: doc.dueOn ? formatDateBE(doc.dueOn) : '', jours: String(daysLate), communication: doc.structuredComm ?? '—', societe: company.name, telephone: company.phone ?? '',
  };
  return { subject: fillTemplate(step.subject, vars), body: fillTemplate(step.body, vars).replace(/\n{3,}/g, '\n\n').trimEnd(), balance };
}

export interface Proposal {
  documentId: string; number: string | null; client: string; contactId: string | null; to: string | null; balance: number; dueOn: Date | null; daysLate: number;
  step: number; stepCount: number; subject: string; body: string; blocked: string | null; lastReminderAt: Date | null;
}

/** Relances à faire maintenant (une par facture), et classement « ignorées » des étapes dépassées jamais traitées. */
export async function computeProposals(now = new Date()): Promise<Proposal[]> {
  const settings = await getReminderSettings();
  const company = await getCompany();
  const docs = await prisma.document.findMany({
    where: { kind: { in: ['invoice', 'deposit_invoice'] }, lockedAt: { not: null }, status: { in: ['sent', 'partial', 'overdue'] }, dueOn: { lt: now }, source: { not: 'demo' } },
    include: { contact: { select: { id: true, name: true, email: true, reminderMode: true } }, reminders: true },
    orderBy: { dueOn: 'asc' },
  });
  const out: Proposal[] = [];
  for (const d of docs) {
    if (d.contact?.reminderMode === 'off') continue;
    const balance = round2(d.totalTtc - d.paidAmount);
    if (balance < Math.max(0.5, settings.minBalance)) continue;
    const daysLate = Math.floor((now.getTime() - d.dueOn!.getTime()) / DAY);
    const reached = settings.steps.map((s, i) => ({ s, n: i + 1 })).filter((x) => x.s.daysAfterDue <= daysLate);
    if (!reached.length) continue;
    const maxDone = Math.max(0, ...d.reminders.map((r) => r.step)); // une étape traitée (envoyée ou ignorée) clôt aussi les précédentes
    const next = [...reached].reverse().find((x) => x.n > maxDone);
    if (!next) continue;
    const lastSent = d.reminders.filter((r) => r.status === 'sent' && r.sentAt).sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0]?.sentAt ?? null;
    if (lastSent && (now.getTime() - lastSent.getTime()) / DAY < settings.minDaysBetween) continue;
    const msg = composeReminder(d, next.s, company, daysLate);
    const to = d.billingEmail ?? d.contact?.email ?? null;
    out.push({
      documentId: d.id, number: d.number, client: d.billingName ?? d.contact?.name ?? '—', contactId: d.contact?.id ?? null, to, balance: msg.balance, dueOn: d.dueOn, daysLate,
      step: next.n, stepCount: settings.steps.length, subject: msg.subject, body: msg.body, blocked: to ? null : 'Aucune adresse e-mail pour ce client', lastReminderAt: lastSent,
    });
  }
  return out;
}

/** Envoie une relance (avec la facture en PDF) et la consigne. Rien n'est consigné « envoyé » si le serveur SMTP refuse. */
export async function sendReminder(
  documentId: string, step: number, o: { subject?: string; body?: string; to?: string; auto?: boolean; userId?: string | null; pdf: (id: string) => Promise<{ buffer: Buffer; filename: string }> },
): Promise<{ to: string }> {
  if (!emailConfigured()) throw new HttpError(503, 'Envoi par e-mail non configuré.');
  const proposal = (await computeProposals()).find((p) => p.documentId === documentId && p.step === step);
  if (!proposal) throw new HttpError(409, 'Cette relance n’est plus à faire (facture réglée, déjà relancée ou client exclu).');
  const to = (o.to ?? proposal.to ?? '').trim();
  if (!to) throw new HttpError(422, 'Aucune adresse e-mail pour ce client.');
  const settings = await getReminderSettings();
  const subject = (o.subject ?? proposal.subject).trim();
  const body = (o.body ?? proposal.body).trim();
  try {
    await sendEmailWithPdf({ to: [to], subject, message: body, copyToSelf: settings.copyToSelf }, await o.pdf(documentId));
  } catch (e) {
    await prisma.invoiceReminder.upsert({
      where: { documentId_step: { documentId, step } },
      create: { documentId, step, status: 'failed', auto: !!o.auto, toEmail: to, subject, body, daysLate: proposal.daysLate, balance: proposal.balance, error: (e as Error).message.slice(0, 300), sentById: o.userId ?? null },
      update: { status: 'failed', error: (e as Error).message.slice(0, 300) },
    });
    throw e;
  }
  await prisma.invoiceReminder.upsert({
    where: { documentId_step: { documentId, step } },
    create: { documentId, step, status: 'sent', auto: !!o.auto, toEmail: to, subject, body, daysLate: proposal.daysLate, balance: proposal.balance, sentById: o.userId ?? null, sentAt: new Date() },
    update: { status: 'sent', auto: !!o.auto, toEmail: to, subject, body, daysLate: proposal.daysLate, balance: proposal.balance, error: null, sentById: o.userId ?? null, sentAt: new Date() },
  });
  await prisma.auditLog.create({ data: { actorId: o.userId ?? null, action: 'reminder.send', entity: 'document', entityId: documentId, meta: { step, to, auto: !!o.auto } } });
  return { to };
}

export async function skipReminder(documentId: string, step: number, userId: string | null) {
  await prisma.invoiceReminder.upsert({
    where: { documentId_step: { documentId, step } },
    create: { documentId, step, status: 'skipped', sentById: userId },
    update: { status: 'skipped', sentById: userId },
  });
}

/** Passage automatique (tâche quotidienne) : n'envoie que si le mode automatique est activé, en semaine, en journée (heure de Bruxelles). */
export async function runAutoReminders(pdf: (id: string) => Promise<{ buffer: Buffer; filename: string }>, now = new Date()): Promise<number> {
  const settings = await getReminderSettings();
  if (!settings.autoSend || !emailConfigured()) return 0;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  if (['Sat', 'Sun'].includes(wd) || hour < 8 || hour >= 18) return 0;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now);
  const last = await prisma.setting.findUnique({ where: { key: 'reminders:lastRun' } });
  if ((last?.value as { day?: string } | null)?.day === day) return 0; // une seule passe par jour
  await prisma.setting.upsert({ where: { key: 'reminders:lastRun' }, create: { key: 'reminders:lastRun', value: { day } }, update: { value: { day } } });
  let sent = 0;
  for (const p of (await computeProposals(now)).filter((x) => x.to).slice(0, 25)) {
    try { await sendReminder(p.documentId, p.step, { auto: true, pdf }); sent++; } catch (e) { console.error('[relances] échec :', (e as Error).message); }
  }
  return sent;
}
