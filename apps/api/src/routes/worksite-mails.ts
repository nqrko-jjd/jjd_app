/**
 * Suivi des e-mails d'un chantier (bureau uniquement) : liste, lecture type Outlook, pièces jointes, notes de suivi.
 * Jamais exposé aux chefs de chantier ni aux ouvriers, et distinct du fil de discussion qu'ils consultent.
 */
import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { mailSnippet } from '../lib/mail-render.js';
import { privateFilePath, removeStoredFiles, type StoredAttachment } from '../lib/worksite-mails.js';

export const worksiteMailsRouter = Router({ mergeParams: true });

const attachmentsOf = (v: unknown): StoredAttachment[] => (Array.isArray(v) ? (v as StoredAttachment[]) : []);
const publicAttachments = (v: unknown) => attachmentsOf(v).map((a, index) => ({ index, filename: a.filename, contentType: a.contentType, size: a.size, available: !!a.file, skipped: a.skipped ?? null }));

async function worksiteOr404(id: string | undefined) {
  const ws = await prisma.worksite.findUnique({ where: { id: id ?? '' }, select: { id: true } });
  if (!ws) throw new HttpError(404, 'Chantier introuvable');
  return ws;
}
async function mailOr404(worksiteId: string, id: string | undefined) {
  const m = await prisma.worksiteMail.findFirst({ where: { id: id ?? '', worksiteId } });
  if (!m) throw new HttpError(404, 'Mail ou note introuvable');
  return m;
}

worksiteMailsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await worksiteOr404(req.params.worksiteId);
    const rows = await prisma.worksiteMail.findMany({
      where: { worksiteId: ws.id },
      select: { id: true, kind: true, subject: true, fromAddress: true, receivedAt: true, createdAt: true, bodyText: true, note: true, attachments: true },
    });
    const items = rows
      .map((m) => ({
        id: m.id, kind: m.kind, subject: m.subject, fromAddress: m.fromAddress, at: m.receivedAt ?? m.createdAt,
        snippet: mailSnippet(m.kind === 'note' ? (m.note ?? '') : (m.bodyText ?? '')), hasNote: !!m.note, attachmentCount: attachmentsOf(m.attachments).length,
      }))
      .sort((a, b) => +new Date(b.at) - +new Date(a.at));
    res.json({ items });
  }),
);

worksiteMailsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await worksiteOr404(req.params.worksiteId);
    const d = z.object({ note: z.string().trim().min(1).max(8000), subject: z.string().trim().max(200).optional() }).parse(req.body);
    const created = await prisma.worksiteMail.create({ data: { worksiteId: ws.id, kind: 'note', subject: d.subject || null, note: d.note, createdById: req.user!.id } });
    res.status(201).json({ id: created.id });
  }),
);

worksiteMailsRouter.get(
  '/:mailId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await worksiteOr404(req.params.worksiteId);
    const m = await mailOr404(ws.id, req.params.mailId);
    res.json({
      id: m.id, kind: m.kind, subject: m.subject, fromAddress: m.fromAddress, toAddress: m.toAddress, at: m.receivedAt ?? m.createdAt,
      bodyText: m.bodyText, bodyHtml: m.bodyHtml, note: m.note, attachments: publicAttachments(m.attachments), updatedAt: m.updatedAt,
    });
  }),
);

worksiteMailsRouter.patch(
  '/:mailId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await worksiteOr404(req.params.worksiteId);
    const m = await mailOr404(ws.id, req.params.mailId);
    const d = z.object({ note: z.string().trim().max(8000) }).parse(req.body);
    if (m.kind === 'note' && !d.note) throw new HttpError(422, 'Une note ne peut pas être vide : supprime-la plutôt.');
    await prisma.worksiteMail.update({ where: { id: m.id }, data: { note: d.note || null } });
    res.json({ ok: true });
  }),
);

worksiteMailsRouter.delete(
  '/:mailId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await worksiteOr404(req.params.worksiteId);
    const m = await mailOr404(ws.id, req.params.mailId);
    await prisma.worksiteMail.delete({ where: { id: m.id } });
    removeStoredFiles(m.attachments);
    res.json({ ok: true });
  }),
);

// formats qu'un navigateur peut afficher sans risque ; tout le reste (html, svg, scripts…) est forcé en téléchargement
const INLINE_OK = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/i;

worksiteMailsRouter.get(
  '/:mailId/attachments/:index',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await worksiteOr404(req.params.worksiteId);
    const m = await mailOr404(ws.id, req.params.mailId);
    const att = attachmentsOf(m.attachments)[Number(req.params.index)];
    const abs = att?.file ? privateFilePath(att.file) : null;
    if (!att || !abs || !existsSync(abs)) throw new HttpError(404, att?.skipped ? `Pièce jointe non conservée : ${att.skipped}.` : 'Pièce jointe introuvable');
    const inline = INLINE_OK.test(att.contentType);
    res.setHeader('Content-Type', inline ? att.contentType : 'application/octet-stream');
    res.setHeader('Content-Length', String(statSync(abs).size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    createReadStream(abs).pipe(res);
  }),
);
