import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { storeImage } from '../lib/media.js';

export const messagerieRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** Mise en service du suivi de lecture : sans ça, le tout premier calcul de non-lus pour
 *  chaque utilisateur remonterait l'historique complet (des années de chat WhatsApp importé)
 *  comme "non lu". Tant qu'aucun ThreadRead n'existe pour un fil, on considère lu jusqu'à
 *  cette date plutôt que depuis l'origine des temps — seuls les messages postés après
 *  comptent vraiment comme non lus. */
const READ_TRACKING_LAUNCHED_AT = new Date('2026-09-16T06:10:00.000Z');

async function ensureGeneralThread() {
  const existing = await prisma.thread.findFirst({ where: { kind: 'general' } });
  if (existing) return existing;
  return prisma.thread.create({ data: { kind: 'general', worksiteId: null } });
}

async function authorName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Inconnu';
}

function preview(m: { kind: string; body: string | null } | undefined): string {
  if (!m) return '';
  if (m.kind === 'photo') return m.body ? `📷 ${m.body}` : '📷 Photo';
  if (m.kind === 'video') return '🎥 Vidéo';
  if (m.kind === 'file') return `📎 ${m.body || 'Fichier'}`;
  if (m.kind === 'status') return `● ${m.body ?? ''}`;
  return m.body ?? '';
}

/** Liste les fils (généraux + par chantier) visibles par l'utilisateur, façon messagerie
 *  unifiée : le fil général en tête, puis les chantiers ayant déjà une conversation pour
 *  l'audience demandée — le bureau/admin voit tout, les autres seulement leurs chantiers
 *  (participants du fil). Onglet "client" : réservé au bureau (répond au client depuis l'app).
 *  `archived` bascule vers les chantiers clôturés/archivés (le fil général n'y figure jamais). */
async function listThreads(userId: string, role: string, personId: string | null, audience: 'internal' | 'client', archived = false) {
  const isOffice = role === 'admin' || role === 'office';
  if (audience === 'client' && !isOffice) return [];

  const items: {
    id: string; kind: string; title: string; sub: string; worksiteId: string | null; ref: string | null;
    lastMessage: string; lastAt: string | null; unread: number; pinned: boolean;
  }[] = [];

  if (audience === 'internal' && !archived) {
    const general = await ensureGeneralThread();
    const [lastMsg, read] = await Promise.all([
      prisma.message.findFirst({ where: { threadId: general.id }, orderBy: { createdAt: 'desc' } }),
      prisma.threadRead.findUnique({ where: { threadId_audience_userId: { threadId: general.id, audience: 'internal', userId } } }),
    ]);
    const unread = await prisma.message.count({ where: { threadId: general.id, createdAt: { gt: read?.lastReadAt ?? READ_TRACKING_LAUNCHED_AT } } });
    items.push({
      id: general.id, kind: 'general', title: 'Général JJD', sub: 'Équipe JJD · fil général',
      worksiteId: null, ref: null, lastMessage: lastMsg ? `${lastMsg.authorName ? lastMsg.authorName + ' : ' : ''}${preview(lastMsg)}` : '',
      lastAt: lastMsg?.createdAt.toISOString() ?? null, unread, pinned: true,
    });
  }

  const threads = await prisma.thread.findMany({
    where: {
      kind: 'worksite',
      messages: { some: { audience } },
      worksite: { source: { not: 'demo' }, archived },
      ...(isOffice ? {} : { participants: { some: { personId: personId ?? '__none__' } } }),
    },
    include: {
      worksite: { select: { id: true, ref: true, title: true, city: true, client: { select: { name: true } } } },
      messages: { where: { audience }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const reads = await prisma.threadRead.findMany({ where: { userId, audience, threadId: { in: threads.map((t) => t.id) } } });
  const readMap = new Map(reads.map((r) => [r.threadId, r.lastReadAt]));
  const unreadCounts = await Promise.all(
    threads.map((t) => prisma.message.count({ where: { threadId: t.id, audience, createdAt: { gt: readMap.get(t.id) ?? READ_TRACKING_LAUNCHED_AT } } })),
  );

  threads.forEach((t, i) => {
    if (!t.worksite) return;
    const last = t.messages[0];
    items.push({
      id: t.id, kind: 'worksite', title: `${t.worksite.ref} · ${t.worksite.title}`,
      sub: audience === 'client'
        ? `Client${t.worksite.client ? ` · ${t.worksite.client.name}` : ''}`
        : `Équipe interne${t.worksite.city ? ` · ${t.worksite.city}` : ''}`,
      worksiteId: t.worksite.id, ref: t.worksite.ref,
      lastMessage: last ? `${last.authorName ? last.authorName + ' : ' : ''}${preview(last)}` : '',
      lastAt: last?.createdAt.toISOString() ?? null, unread: unreadCounts[i]!, pinned: false,
    });
  });

  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastAt ?? '').localeCompare(a.lastAt ?? '');
  });
  return items;
}

messagerieRouter.get(
  '/threads',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const audience = req.query.audience === 'client' ? 'client' : 'internal';
    const archived = req.query.archived === '1';
    const items = await listThreads(req.user!.id, req.user!.role, req.user!.personId, audience, archived);
    res.json({ items });
  }),
);

messagerieRouter.get(
  '/unread-count',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const isOffice = req.user!.role === 'admin' || req.user!.role === 'office';
    const [internal, client] = await Promise.all([
      listThreads(req.user!.id, req.user!.role, req.user!.personId, 'internal'),
      isOffice ? listThreads(req.user!.id, req.user!.role, req.user!.personId, 'client') : Promise.resolve([]),
    ]);
    res.json({
      internal: internal.reduce((s, t) => s + t.unread, 0),
      client: client.reduce((s, t) => s + t.unread, 0),
    });
  }),
);

messagerieRouter.get(
  '/general',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const thread = await ensureGeneralThread();
    const messages = await prisma.message.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: 'asc' } });
    res.json({ thread, messages });
  }),
);

messagerieRouter.post(
  '/general/messages',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const thread = await ensureGeneralThread();
    const body = String(req.body.body ?? '').trim();
    if (!body) throw new HttpError(422, 'Message vide');
    const msg = await prisma.message.create({
      data: { threadId: thread.id, authorId: req.user!.id, authorName: await authorName(req.user!.id), kind: 'text', body, audience: 'internal' },
    });
    res.status(201).json({ message: msg });
  }),
);

messagerieRouter.post(
  '/general/photos',
  requireAuth(...STAFF),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const thread = await ensureGeneralThread();
    const img = await storeImage(req.file.buffer);
    const msg = await prisma.message.create({
      data: {
        threadId: thread.id, authorId: req.user!.id, authorName: await authorName(req.user!.id),
        kind: 'photo', body: String(req.body.caption ?? '').trim() || null, fileUrl: img.url, thumbUrl: img.thumbUrl, audience: 'internal',
      },
    });
    res.status(201).json({ message: msg });
  }),
);

/** Marque un fil comme lu (par audience) pour l'utilisateur courant. */
messagerieRouter.post(
  '/read',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const threadId = String(req.body.threadId ?? '');
    const audience = req.body.audience === 'client' ? 'client' : 'internal';
    if (!threadId) throw new HttpError(422, 'threadId requis');
    if (audience === 'client' && req.user!.role !== 'admin' && req.user!.role !== 'office') throw new HttpError(403, 'Accès refusé');
    await prisma.threadRead.upsert({
      where: { threadId_audience_userId: { threadId, audience, userId: req.user!.id } },
      create: { threadId, audience, userId: req.user!.id },
      update: { lastReadAt: new Date() },
    });
    res.json({ ok: true });
  }),
);
