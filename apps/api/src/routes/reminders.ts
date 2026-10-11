import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { emailConfigured } from '../lib/doc-mail.js';
import { computeProposals, getReminderSettings, saveReminderSettings, sendReminder, skipReminder } from '../lib/reminders.js';
import { getDocPdfBuffer } from './documents.js';
import { computeReviewProposals, getReviewSettings, saveReviewSettings, sendReviewRequest, skipReviewRequest } from '../lib/review-requests.js';
import { computeQuoteProposals, getFollowupSettings, saveFollowupSettings, sendQuoteFollowup } from '../lib/quote-followups.js';

/** Relances de paiement des factures impayées (bureau uniquement) — voir lib/reminders.ts. */
export const remindersRouter = Router();

remindersRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const [settings, proposals, history] = await Promise.all([
      getReminderSettings(),
      computeProposals(),
      prisma.invoiceReminder.findMany({
        where: { status: { in: ['sent', 'failed'] } }, orderBy: { createdAt: 'desc' }, take: 60,
        include: { document: { select: { id: true, number: true, status: true, totalTtc: true, paidAmount: true, contact: { select: { name: true } } } } },
      }),
    ]);
    res.json({
      emailConfigured: emailConfigured(), settings, proposals,
      history: history.map((h) => ({ id: h.id, step: h.step, status: h.status, auto: h.auto, toEmail: h.toEmail, subject: h.subject, error: h.error, sentAt: h.sentAt, createdAt: h.createdAt, daysLate: h.daysLate, balance: h.balance, document: h.document })),
    });
  }),
);

const settingsInput = z.object({
  autoSend: z.boolean(), copyToSelf: z.boolean(), minBalance: z.coerce.number().min(0), minDaysBetween: z.coerce.number().min(1).max(60),
  steps: z.array(z.object({ daysAfterDue: z.coerce.number().min(1).max(365), subject: z.string().max(200), body: z.string().max(4000) })).min(1).max(6),
});
remindersRouter.put(
  '/settings',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const saved = await saveReminderSettings(settingsInput.parse(req.body));
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'reminder.settings', entity: 'Setting', entityId: 'reminders', meta: { autoSend: saved.autoSend, steps: saved.steps.map((s) => s.daysAfterDue) } } });
    res.json({ settings: saved });
  }),
);

const sendInput = z.object({ documentId: z.string(), step: z.coerce.number().int().min(1), to: z.string().trim().email().optional(), subject: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(5000).optional() });
remindersRouter.post(
  '/send',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const i = sendInput.parse(req.body);
    const r = await sendReminder(i.documentId, i.step, { to: i.to, subject: i.subject, body: i.body, userId: req.user!.id, pdf: getDocPdfBuffer });
    res.json({ ok: true, note: `Relance envoyée à ${r.to}.` });
  }),
);

remindersRouter.post(
  '/skip',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const i = z.object({ documentId: z.string(), step: z.coerce.number().int().min(1) }).parse(req.body);
    await skipReminder(i.documentId, i.step, req.user!.id);
    res.json({ ok: true });
  }),
);

/** « Ne plus relancer ce client » (ou remettre les relances). */
remindersRouter.post(
  '/contact/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const off = z.object({ off: z.boolean() }).parse(req.body).off;
    const c = await prisma.contact.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!c) throw new HttpError(404, 'Contact introuvable');
    await prisma.contact.update({ where: { id: c.id }, data: { reminderMode: off ? 'off' : null } });
    res.json({ ok: true });
  }),
);

/** Historique des relances d'une facture. */
remindersRouter.get(
  '/document/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const items = await prisma.invoiceReminder.findMany({ where: { documentId: req.params.id }, orderBy: { step: 'asc' } });
    res.json({ items: items.map((r) => ({ step: r.step, status: r.status, auto: r.auto, toEmail: r.toEmail, sentAt: r.sentAt, error: r.error })) });
  }),
);

/** Suivi des devis envoyés restés sans réponse (lib/quote-followups.ts). */
remindersRouter.get(
  '/quotes',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const [settings, proposals, history] = await Promise.all([
      getFollowupSettings(), computeQuoteProposals(),
      prisma.invoiceReminder.findMany({
        where: { status: { in: ['sent', 'failed'] }, document: { kind: 'quote' } }, orderBy: { createdAt: 'desc' }, take: 60,
        include: { document: { select: { id: true, number: true, status: true, totalTtc: true, contact: { select: { name: true } } } } },
      }),
    ]);
    res.json({
      emailConfigured: emailConfigured(), settings, proposals,
      history: history.map((h) => ({ id: h.id, step: h.step, status: h.status, auto: h.auto, toEmail: h.toEmail, subject: h.subject, error: h.error, sentAt: h.sentAt, createdAt: h.createdAt, daysLate: h.daysLate, balance: h.balance, document: h.document })),
    });
  }),
);

const followupSettingsInput = z.object({
  autoSend: z.boolean(), copyToSelf: z.boolean(), mode: z.enum(['after_sent', 'before_expiry']).optional(), minDaysBetween: z.coerce.number().min(1).max(60), maxAgeDays: z.coerce.number().min(14).max(365),
  steps: z.array(z.object({ daysAfterSent: z.coerce.number().min(1).max(365), subject: z.string().max(200), body: z.string().max(4000) })).min(1).max(6),
});
remindersRouter.put(
  '/quotes/settings',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const saved = await saveFollowupSettings(followupSettingsInput.parse(req.body));
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'quote.followup.settings', entity: 'Setting', entityId: 'quoteFollowups', meta: { autoSend: saved.autoSend, steps: saved.steps.map((s) => s.daysAfterSent) } } });
    res.json({ settings: saved });
  }),
);

remindersRouter.post(
  '/quotes/send',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const i = sendInput.parse(req.body);
    const r = await sendQuoteFollowup(i.documentId, i.step, { to: i.to, subject: i.subject, body: i.body, userId: req.user!.id, pdf: getDocPdfBuffer });
    res.json({ ok: true, note: `Suivi envoyé à ${r.to}.` });
  }),
);

/** Demandes d'avis client après une facture finale payée (lib/review-requests.ts). */
remindersRouter.get(
  '/reviews',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const [settings, proposals, history] = await Promise.all([
      getReviewSettings(), computeReviewProposals(),
      prisma.reviewRequest.findMany({ where: { status: { in: ['sent', 'failed'] } }, orderBy: { createdAt: 'desc' }, take: 60 }),
    ]);
    const docs = await prisma.document.findMany({ where: { id: { in: history.map((h) => h.documentId) } }, select: { id: true, number: true, contact: { select: { name: true } } } });
    const byId = new Map(docs.map((d) => [d.id, d]));
    res.json({
      emailConfigured: emailConfigured(), settings, proposals,
      history: history.map((h) => ({ id: h.id, status: h.status, auto: h.auto, toEmail: h.toEmail, error: h.error, sentAt: h.sentAt, createdAt: h.createdAt, document: byId.get(h.documentId) ?? null })),
    });
  }),
);

const reviewSettingsInput = z.object({
  autoSend: z.boolean(), copyToSelf: z.boolean(), reviewUrl: z.string().max(500), delayDays: z.coerce.number().min(0).max(60), maxAgeDays: z.coerce.number().min(7).max(180),
  minAmount: z.coerce.number().min(0), subject: z.string().max(200), body: z.string().max(4000),
});
remindersRouter.put(
  '/reviews/settings',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const saved = await saveReviewSettings(reviewSettingsInput.parse(req.body));
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'review.settings', entity: 'Setting', entityId: 'reviewRequests', meta: { autoSend: saved.autoSend } } });
    res.json({ settings: saved });
  }),
);

remindersRouter.post(
  '/reviews/send',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const i = z.object({ documentId: z.string(), to: z.string().trim().email().optional(), subject: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(5000).optional() }).parse(req.body);
    const r = await sendReviewRequest(i.documentId, { to: i.to, subject: i.subject, body: i.body, userId: req.user!.id });
    res.json({ ok: true, note: `Demande d’avis envoyée à ${r.to}.` });
  }),
);

remindersRouter.post(
  '/reviews/skip',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await skipReviewRequest(z.object({ documentId: z.string() }).parse(req.body).documentId, req.user!.id);
    res.json({ ok: true });
  }),
);
