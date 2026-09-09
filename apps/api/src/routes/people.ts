import { Router } from 'express';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import multer from 'multer';
import { personInput, legalDocInput, personAdjustmentInput, normalizeName, round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE, hashPassword } from '../lib/auth.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';
import { monthlyStatement, personEarningsSeries, personEarningsBreakdown } from '../lib/statement.js';

export const peopleRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

attachPhotoRoutes(peopleRouter, (id, data) => prisma.person.update({ where: { id }, data }));

function fullName(p: { firstName: string; lastName?: string | null }) {
  return `${p.firstName} ${p.lastName ?? ''}`.trim();
}

peopleRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { role, active, q } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (active === '1') where.active = true;
    if (active === '0') where.active = false;
    if (q) where.OR = [{ firstName: { contains: q } }, { lastName: { contains: q } }, { displayName: { contains: q } }];
    const items = await prisma.person.findMany({
      where,
      orderBy: [{ active: 'desc' }, { firstName: 'asc' }],
      include: { _count: { select: { legalDocs: true, timeEntries: true } } },
    });
    res.json({ items });
  }),
);

peopleRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findUnique({
      where: { id: req.params.id },
      include: {
        legalDocs: { orderBy: { expiresOn: 'asc' } },
        equipment: true,
        user: { select: { id: true, email: true, role: true } },
        adjustments: { orderBy: { date: 'desc' } },
      },
    });
    if (!person) throw new HttpError(404, 'Fiche introuvable');

    // décompte du mois courant (jour presté garanti inclus)
    const now = new Date();
    const s = await monthlyStatement(person.id, now.getFullYear(), now.getMonth() + 1);
    // avances + dettes pas encore réglées -> montant à retenir sur la prochaine paie
    const toWithhold = round2(person.adjustments.filter((a) => !a.settled).reduce((sum, a) => sum + a.amount, 0));
    res.json({
      person,
      monthStatement: {
        hours: s.totalHours, amount: s.totalAmount,
        worksites: s.worksiteCount, guaranteeApplied: s.guaranteeApplied, dailyHours: s.dailyHoursGuarantee,
      },
      adjustmentBalance: toWithhold,
    });
  }),
);

/** Série mensuelle (montant, heures, chantiers) pour le graphique de la fiche. */
peopleRouter.get(
  '/:id/stats',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));
    res.json({ months: await personEarningsSeries(req.params.id!, months) });
  }),
);

/** Revenus tout l'historique : total, par année, par chantier (+ rentabilité du chantier). */
peopleRouter.get(
  '/:id/earnings',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    res.json(await personEarningsBreakdown(req.params.id!));
  }),
);

peopleRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personInput.parse(req.body);
    const person = await prisma.person.create({
      data: {
        ...data,
        email: data.email || null,
        displayName: data.displayName || data.firstName,
        normalizedName: normalizeName(fullName(data)),
        languages: data.languages,
        specialties: data.specialties,
        source: 'manual',
      },
    });
    res.status(201).json({ person });
  }),
);

peopleRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personInput.partial().parse(req.body);
    const person = await prisma.person.update({
      where: { id: req.params.id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
        languages: data.languages ?? undefined,
        specialties: data.specialties ?? undefined,
      },
    });
    res.json({ person });
  }),
);

/** Crée un compte de connexion pour cette personne (pour l'appli mobile). */
peopleRouter.post(
  '/:id/account',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!person) throw new HttpError(404, 'Fiche introuvable');
    if (person.user) throw new HttpError(409, 'Un compte existe déjà pour cette personne');

    const email = String(req.body.email ?? '').trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new HttpError(422, 'E-mail invalide');
    if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'Cet e-mail est déjà pris');

    const password = req.body.password || Math.random().toString(36).slice(2, 8);
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        role: person.role === 'foreman' ? 'foreman' : 'worker',
        personId: person.id,
      },
    });
    res.status(201).json({ email, password });
  }),
);

peopleRouter.post(
  '/:id/legal-docs',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = legalDocInput.parse({ ...req.body, personId: req.params.id });
    const doc = await prisma.legalDoc.create({ data });
    res.status(201).json({ doc });
  }),
);

peopleRouter.delete(
  '/:id/legal-docs/:docId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.legalDoc.delete({ where: { id: req.params.docId } });
    res.status(204).end();
  }),
);

/** Joint le scan/photo du document (PDF ou image). */
peopleRouter.post(
  '/:id/legal-docs/:docId/file',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const okType = req.file.mimetype === 'application/pdf' || /^image\/(jpe?g|png|webp|heic)$/.test(req.file.mimetype);
    if (!okType) throw new HttpError(422, 'Format accepté : PDF ou image.');
    const doc = await prisma.legalDoc.findFirst({ where: { id: req.params.docId, personId: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const rel = storeFile(req.file.buffer, req.file.originalname || 'document.pdf', 'legal-docs');
    const updated = await prisma.legalDoc.update({ where: { id: doc.id }, data: { fileUrl: rel } });
    res.status(201).json({ doc: updated });
  }),
);

peopleRouter.get(
  '/:id/legal-docs/:docId/file',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const doc = await prisma.legalDoc.findFirst({ where: { id: req.params.docId, personId: req.params.id } });
    if (!doc?.fileUrl) throw new HttpError(404, 'Aucune pièce jointe');
    const file = resolveUpload(doc.fileUrl);
    if (!existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename="${(doc.label ?? doc.type).replace(/[^\w.-]/g, '_')}${ext}"`);
    createReadStream(file).pipe(res);
  }),
);

/* -------------------------------------------------------- Avances & dettes */

peopleRouter.post(
  '/:id/adjustments',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personAdjustmentInput.parse(req.body);
    const adj = await prisma.personAdjustment.create({
      data: { personId: req.params.id as string, ...data, note: data.note ?? null, createdById: req.user!.id },
    });
    res.status(201).json({ adjustment: adj });
  }),
);

peopleRouter.patch(
  '/:id/adjustments/:adjId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personAdjustmentInput.partial().parse(req.body);
    const adj = await prisma.personAdjustment.update({
      where: { id: req.params.adjId },
      data: { ...data, note: data.note === undefined ? undefined : data.note ?? null },
    });
    res.json({ adjustment: adj });
  }),
);

/** Bascule réglé / à déduire (avance remboursée, dette payée…). */
peopleRouter.post(
  '/:id/adjustments/:adjId/settle',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const settled = req.body?.settled !== false;
    const adj = await prisma.personAdjustment.update({
      where: { id: req.params.adjId },
      data: { settled, settledOn: settled ? new Date() : null },
    });
    res.json({ adjustment: adj });
  }),
);

peopleRouter.delete(
  '/:id/adjustments/:adjId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.personAdjustment.delete({ where: { id: req.params.adjId } });
    res.json({ ok: true });
  }),
);
