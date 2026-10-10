import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { emailConfigured } from '../lib/doc-mail.js';
import { computeProposals, getReminderSettings, saveReminderSettings, sendReminder, skipReminder } from '../lib/reminders.js';
import { getDocPdfBuffer } from './documents.js';

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
