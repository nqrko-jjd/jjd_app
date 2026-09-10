import { Router } from 'express';
import multer from 'multer';
import { unzipSync } from 'fflate';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, FIELD_OFFICE, OFFICE } from '../lib/auth.js';
import { storeImage, storeFile } from '../lib/media.js';
import { parseWhatsAppChat, buildWhatsAppAuthorMatcher, WHATSAPP_SKIP_BODY } from '../lib/whatsapp-import.js';
import { extractDocumentInfo } from '../lib/document-extract.js';

export const threadRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadZip = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

function deriveYM(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

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
        where: { threadId: thread.id, audience: 'internal' },
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
      data: { threadId: thread.id, authorId: req.user!.id, authorName: await authorName(req.user!.id), kind, body, audience: 'internal' },
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
        audience: 'internal',
      },
    });
    res.status(201).json({ message: msg });
  }),
);

/**
 * Importe un export WhatsApp (zip contenant le .txt de discussion + les
 * médias) directement dans le fil de ce chantier : les messages vont dans
 * le chat, les photos/vidéos/fichiers dans les pièces jointes. Idempotent :
 * relance l'import écrase le précédent (messages source "whatsapp" du fil).
 */
threadRouter.post(
  '/import-whatsapp',
  requireAuth(...FIELD_OFFICE),
  uploadZip.single('zip'),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const thread = await ensureThread(worksiteId);

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(req.file.buffer));
    } catch {
      throw new HttpError(422, 'Fichier zip illisible.');
    }

    const fileNames = Object.keys(entries).filter((n) => !n.endsWith('/'));
    const txtCandidates = fileNames.filter((n) => n.toLowerCase().endsWith('.txt'));
    const txtName = txtCandidates.find((n) => /chat|discussion/i.test(n)) ?? txtCandidates[0];
    if (!txtName) throw new HttpError(422, 'Aucun fichier .txt trouvé dans le zip (export de discussion WhatsApp attendu).');

    const text = Buffer.from(entries[txtName]!).toString('utf8');
    const msgs = parseWhatsAppChat(text);

    const byBasename = new Map<string, Uint8Array>();
    for (const n of fileNames) byBasename.set(n.split('/').pop()!.toLowerCase(), entries[n]!);

    const people = await prisma.person.findMany({
      where: { active: true },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    });
    const matchAuthor = buildWhatsAppAuthorMatcher(people);

    // idempotent : un nouvel import remplace le précédent pour ce fil
    await prisma.message.deleteMany({ where: { threadId: thread.id, source: 'whatsapp' } });

    let texts = 0, photos = 0, videos = 0, files = 0, skipped = 0;
    const warnings: string[] = [];
    let lastAt = 0; // garantit un ordre chronologique strict même en cas de rafale à la même minute

    for (const msg of msgs) {
      if (!msg.author) continue; // ligne système (création de groupe, chiffrement…)
      const body = msg.body.trim();
      if (!msg.attach && (WHATSAPP_SKIP_BODY.has(body) || body === '')) continue;
      const who = matchAuthor(msg.author);
      const at = Math.max(msg.at.getTime(), lastAt + 1);
      lastAt = at;
      const createdAt = new Date(at);

      if (!msg.attach) {
        await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'text', body, source: 'whatsapp', audience: 'internal', createdAt } });
        texts++;
        continue;
      }
      const buf = byBasename.get(msg.attach.toLowerCase());
      if (!buf) { skipped++; warnings.push(`${msg.attach} — média absent du zip`); continue; }
      const ext = msg.attach.toLowerCase().split('.').pop() ?? '';
      try {
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
          const img = await storeImage(Buffer.from(buf));
          await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'photo', fileUrl: img.url, thumbUrl: img.thumbUrl, source: 'whatsapp', audience: 'internal', createdAt } });
          photos++;
        } else if (['mp4', 'mov', '3gp'].includes(ext)) {
          const url = storeFile(Buffer.from(buf), msg.attach, 'whatsapp');
          await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'video', fileUrl: url, source: 'whatsapp', audience: 'internal', createdAt } });
          videos++;
        } else {
          const url = storeFile(Buffer.from(buf), msg.attach, 'whatsapp');
          await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'file', fileUrl: url, body: msg.attach, source: 'whatsapp', audience: 'internal', createdAt } });
          files++;
        }
      } catch {
        skipped++;
        warnings.push(`${msg.attach} — média illisible`);
      }
    }

    res.status(201).json({ imported: { texts, photos, videos, files, skipped }, warnings: warnings.slice(0, 30) });
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
        audience: 'internal',
      },
    });
    if (closing) {
      await prisma.worksite.update({ where: { id: worksiteId }, data: { status: 'done' } });
    }
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------- fil client */

/** Le fil client de ce chantier (ce que le client voit/poste depuis le portail). */
threadRouter.get(
  '/client',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const messages = await prisma.message.findMany({
      where: { threadId: thread.id, audience: 'client' },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ thread, messages });
  }),
);

/** Le bureau répond au client depuis l'app (pas besoin du portail). */
threadRouter.post(
  '/client/messages',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const body = String(req.body.body ?? '').trim();
    if (!body) throw new HttpError(422, 'Message vide');
    const msg = await prisma.message.create({
      data: { threadId: thread.id, authorId: req.user!.id, authorName: await authorName(req.user!.id), kind: 'text', body, audience: 'client' },
    });
    res.status(201).json({ message: msg });
  }),
);

/** Partage (ou retire) une photo/vidéo interne dans la galerie visible du client. */
threadRouter.patch(
  '/messages/:id/share',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const thread = await ensureThread(worksiteId);
    const msg = await prisma.message.findFirst({ where: { id: req.params.id, threadId: thread.id } });
    if (!msg) throw new HttpError(404, 'Message introuvable');
    if (msg.kind !== 'photo' && msg.kind !== 'video') throw new HttpError(422, 'Seules les photos/vidéos peuvent être partagées.');
    const shared = req.body?.shared !== false;
    const updated = await prisma.message.update({ where: { id: msg.id }, data: { sharedWithClient: shared } });
    res.json({ message: updated });
  }),
);

/**
 * Envoie une facture depuis le fil (photo ou PDF) : jointe au fil interne ET
 * loggée en brouillon dans les achats (source "chat") pour vérification par le
 * bureau — jamais publiée telle quelle, juste une piste de dépense à confirmer.
 */
threadRouter.post(
  '/invoice',
  requireAuth(...STAFF),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const thread = await ensureThread(worksiteId);
    const isImage = /^image\/(jpe?g|png|webp|heic)$/.test(req.file.mimetype);
    const isPdf = req.file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) throw new HttpError(422, 'Format accepté : photo ou PDF.');

    let fileUrl: string;
    let thumbUrl: string | undefined;
    if (isImage) {
      const img = await storeImage(req.file.buffer);
      fileUrl = img.url;
      thumbUrl = img.thumbUrl;
    } else {
      fileUrl = storeFile(req.file.buffer, req.file.originalname || 'facture.pdf', 'expenses');
    }

    const extraction = isPdf ? await extractDocumentInfo(req.file.buffer, req.file.mimetype) : null;
    const date = extraction?.issuedOn ? new Date(extraction.issuedOn) : new Date();
    const ht = extraction?.totalHt ?? (extraction?.totalTtc != null ? Math.round((extraction.totalTtc / (1 + (extraction.vatRate ?? 0.21))) * 100) / 100 : 0);
    const expense = await prisma.ledgerEntry.create({
      data: {
        ...deriveYM(date),
        date,
        dueDate: extraction?.dueOn ? new Date(extraction.dueOn) : null,
        direction: 'purchase',
        docType: "Facture d'achat",
        docNumber: extraction?.docNumber ?? null,
        worksiteId,
        contactId: extraction?.contactId ?? null,
        ht,
        ttc: extraction?.totalTtc ?? null,
        vatRate: extraction?.vatRate ?? null,
        pdfPath: fileUrl,
        paymentStatus: 'Non payé',
        source: 'chat',
        createdById: req.user!.id,
      },
    });

    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: req.user!.id,
        authorName: await authorName(req.user!.id),
        kind: isImage ? 'photo' : 'file',
        body: isImage
          ? 'Facture envoyée — ajoutée aux achats, à vérifier'
          : (req.file.originalname || 'Facture') + ' — ajoutée aux achats, à vérifier',
        fileUrl,
        thumbUrl,
        audience: 'internal',
      },
    });
    res.status(201).json({ message: msg, expenseId: expense.id });
  }),
);
