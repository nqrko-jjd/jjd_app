import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, STAFF } from '../lib/auth.js';
import { asyncHandler, HttpError } from '../lib/http.js';

export const moderationRouter = Router();
moderationRouter.post('/reports', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const messageId = typeof req.body.messageId === 'string' ? req.body.messageId : '';
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!messageId || reason.length < 3 || reason.length > 1000) throw new HttpError(422, 'Indiquez un motif de 3 à 1000 caractères.');
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { thread: true } });
  if (!message || message.audience !== 'internal') throw new HttpError(404, 'Message introuvable');
  const user = req.user!;
  if (message.thread.worksiteId && !['admin', 'office'].includes(user.role)) {
    const assigned = user.personId && await prisma.person.findFirst({ where: { id: user.personId, OR: [
      { timeEntries: { some: { worksiteId: message.thread.worksiteId } } },
      { eventAssignments: { some: { event: { worksiteId: message.thread.worksiteId } } } },
      { threadParticipations: { some: { threadId: message.threadId } } },
    ] } });
    if (!assigned) throw new HttpError(403, 'Accès refusé');
  }
  const recent = await prisma.auditLog.count({ where: { actorId: user.id, action: 'message.report', at: { gt: new Date(Date.now() - 3600000) } } });
  if (recent >= 20) throw new HttpError(429, 'Trop de signalements. Contactez info@jjd-consult.be.');
  await prisma.auditLog.create({ data: { actorId: user.id, action: 'message.report', entity: 'message', entityId: messageId,
    meta: { reason, authorId: message.authorId, authorName: message.authorName, body: message.body, fileUrl: message.fileUrl, threadId: message.threadId } } });
  res.status(201).json({ ok: true });
}));

moderationRouter.get('/reports', requireAuth('admin'), asyncHandler(async (req, res) => {
  if (req.user!.entityScope) throw new HttpError(403, 'Administration globale requise');
  const items = await prisma.auditLog.findMany({ where: { action: 'message.report' }, orderBy: { at: 'desc' }, take: 100 });
  res.json({ items });
}));

moderationRouter.post('/reports/:id/resolve', requireAuth('admin'), asyncHandler(async (req, res) => {
  if (req.user!.entityScope) throw new HttpError(403, 'Administration globale requise');
  const report = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
  if (!report || report.action !== 'message.report' || !report.entityId) throw new HttpError(404, 'Signalement introuvable');
  const remove = req.body.remove === true;
  await prisma.$transaction(async tx => {
    if (remove) await tx.message.updateMany({ where: { id: report.entityId! }, data: { body: 'Message retiré par la modération.', fileUrl: null, thumbUrl: null, kind: 'status' } });
    await tx.auditLog.update({ where: { id: report.id }, data: { action: 'message.report.resolved', meta: { ...(report.meta as object), removed: remove, resolvedBy: req.user!.id, resolvedAt: new Date().toISOString() } } });
  });
  res.json({ ok: true });
}));

