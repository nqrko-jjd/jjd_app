import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF } from '../lib/auth.js';
import { storeImage } from '../lib/media.js';

export const threadRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function ensureThread(worksiteId: string) {
  const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
  if (!ws) throw new HttpError(404, 'Chantier introuvable');
  return prisma.thread.upsert({
    where: { worksiteId },
    create: { worksiteId },
    update: {},
  });
}

async function authorName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Inconnu';
}

/** Le fil complet d'un chantier. */
threadRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const [messages, participants] = await Promise.all([
      prisma.message.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true } } },
      }),
      prisma.threadParticipant.findMany({
        where: { threadId: thread.id },
        include: { person: { select: { id: true, displayName: true, firstName: true } } },
      }),
    ]);
    res.json({ thread, messages, participants: participants.map((p) => p.person) });
  }),
);

/** Poste un message texte. */
threadRouter.post(
  '/messages',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const body = String(req.body.body ?? '').trim();
    const kind = req.body.kind === 'status' ? 'status' : 'text';
    if (!body) throw new HttpError(422, 'Message vide');
    const msg = await prisma.message.create({
      data: { threadId: thread.id, authorId: req.user!.id, authorName: await authorName(req.user!.id), kind, body },
    });
    res.status(201).json({ message: msg });
  }),
);

/** Poste une photo (multipart : champ « file »). */
threadRouter.post(
  '/photos',
  requireAuth(...STAFF),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const thread = await ensureThread(worksiteId);
    const img = await storeImage(req.file.buffer);
    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: req.user!.id,
        authorName: await authorName(req.user!.id),
        kind: 'photo',
        body: String(req.body.caption ?? '').trim() || null,
        fileUrl: img.url,
        thumbUrl: img.thumbUrl,
      },
    });
    res.status(201).json({ message: msg });
  }),
);

/** Gère les participants (les ouvriers concernés). */
threadRouter.put(
  '/participants',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const ids: string[] = Array.isArray(req.body.personIds) ? req.body.personIds : [];
    await prisma.threadParticipant.deleteMany({ where: { threadId: thread.id } });
    if (ids.length) {
      await prisma.threadParticipant.createMany({
        data: ids.map((personId) => ({ threadId: thread.id, personId })),
      });
    }
    res.json({ ok: true });
  }),
);

/** Clôture / réouvre le fil (= chantier terminé côté terrain). */
threadRouter.post(
  '/close',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const closing = req.body.reopen !== true;
    await prisma.thread.update({ where: { id: thread.id }, data: { closedAt: closing ? new Date() : null } });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: req.user!.id,
        authorName: await authorName(req.user!.id),
        kind: 'status',
        body: closing ? 'Chantier signalé terminé' : 'Fil réouvert',
      },
    });
    if (closing) {
      await prisma.worksite.update({ where: { id: worksiteId }, data: { status: 'done' } });
    }
    res.json({ ok: true });
  }),
);
