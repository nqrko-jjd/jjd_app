import { Router } from 'express';
import multer from 'multer';
import { worksiteReportInput, reportSignInput, reportReviewInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, FIELD_OFFICE } from '../lib/auth.js';
import { storeImage } from '../lib/media.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const reportInclude = {
  photos: { orderBy: { createdAt: 'asc' } },
  worksite: { select: { id: true, ref: true, title: true, address: true, postalCode: true, city: true, client: { select: { name: true } }, acp: { select: { name: true } } } },
  author: { select: { email: true } },
} as const;

interface ReportWithWorksite { worksite: { acp: { name: string } | null } & Record<string, unknown> }
function shapeReport<T extends ReportWithWorksite>(r: T) {
  const { acp, ...worksiteRest } = r.worksite;
  return { ...r, worksite: { ...worksiteRest, building: acp } };
}

async function authorName(userId: string | undefined): Promise<string> {
  if (!userId) return 'Terrain';
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Terrain';
}

/* ------------------------------------------ sous /api/worksites/:worksiteId/reports */

export const worksiteReportsRouter = Router({ mergeParams: true });

worksiteReportsRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const items = await prisma.worksiteReport.findMany({
      where: { worksiteId: req.params.worksiteId },
      orderBy: { date: 'desc' },
      include: reportInclude,
    });
    res.json({ items: items.map(shapeReport) });
  }),
);

worksiteReportsRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId as string;
    const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const data = worksiteReportInput.parse(req.body);
    const report = await prisma.worksiteReport.create({
      data: {
        worksiteId,
        eventId: data.eventId ?? null,
        authorId: req.user!.id,
        authorName: await authorName(req.user!.id),
        date: data.date ?? new Date(),
        workDone: data.workDone ?? null,
        notes: data.notes ?? null,
      },
      include: reportInclude,
    });
    res.status(201).json({ report: shapeReport(report) });
  }),
);

/* ------------------------------------------------------ sous /api/reports/:id */

export const reportsRouter = Router();

/** File de relecture des rapports signés (bureau/chef de chantier) — tous statuts, filtrables côté client (onglets). */
reportsRouter.get(
  '/review-queue',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = { status: 'signed' };
    if (req.user!.role === 'foreman') {
      if (!req.user!.personId) return res.json({ items: [] });
      where.worksite = { managerId: req.user!.personId };
    }
    const items = await prisma.worksiteReport.findMany({
      where,
      orderBy: { signedAt: 'desc' },
      include: reportInclude,
      take: 200,
    });
    res.json({ items: items.map(shapeReport) });
  }),
);

reportsRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const report = await prisma.worksiteReport.findUnique({ where: { id: req.params.id }, include: reportInclude });
    if (!report) throw new HttpError(404, 'Rapport introuvable');
    res.json({ report: shapeReport(report) });
  }),
);

reportsRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const existing = await prisma.worksiteReport.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Rapport introuvable');
    if (existing.status === 'signed') throw new HttpError(409, 'Rapport déjà signé');
    const data = worksiteReportInput.partial().parse(req.body);
    const report = await prisma.worksiteReport.update({
      where: { id: existing.id },
      data: {
        workDone: data.workDone ?? undefined,
        notes: data.notes ?? undefined,
        date: data.date ?? undefined,
        eventId: data.eventId === undefined ? undefined : data.eventId,
      },
      include: reportInclude,
    });
    res.json({ report: shapeReport(report) });
  }),
);

reportsRouter.post(
  '/:id/photos',
  requireAuth(...STAFF),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const report = await prisma.worksiteReport.findUnique({ where: { id: req.params.id } });
    if (!report) throw new HttpError(404, 'Rapport introuvable');
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const img = await storeImage(req.file.buffer);
    const photo = await prisma.reportPhoto.create({
      data: { reportId: report.id, url: img.url, thumbUrl: img.thumbUrl, caption: String(req.body.caption ?? '').trim() || null },
    });
    res.status(201).json({ photo });
  }),
);

reportsRouter.delete(
  '/:id/photos/:photoId',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    await prisma.reportPhoto.deleteMany({ where: { id: req.params.photoId, reportId: req.params.id } });
    res.json({ ok: true });
  }),
);

/** Signature du client (data URL PNG, capturée au doigt sur l'appareil). */
reportsRouter.post(
  '/:id/sign',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const report = await prisma.worksiteReport.findUnique({ where: { id: req.params.id } });
    if (!report) throw new HttpError(404, 'Rapport introuvable');
    if (report.status === 'signed') throw new HttpError(409, 'Déjà signé');
    const { clientName, signature } = reportSignInput.parse(req.body);

    const m = /^data:image\/\w+;base64,(.+)$/.exec(signature.trim());
    if (!m) throw new HttpError(422, 'Signature illisible');
    const img = await storeImage(Buffer.from(m[1]!, 'base64'));

    const updated = await prisma.worksiteReport.update({
      where: { id: report.id },
      data: { clientName, signatureUrl: img.url, signedAt: new Date(), status: 'signed' },
      include: reportInclude,
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'report_signed', entity: 'worksite_report', entityId: report.id, meta: { clientName } },
    });

    // trace dans le fil de chantier
    const thread = await prisma.thread.upsert({
      where: { worksiteId: report.worksiteId },
      create: { worksiteId: report.worksiteId },
      update: {},
    });
    await prisma.message.create({
      data: { threadId: thread.id, authorName: updated.authorName, kind: 'status', body: `Rapport d'intervention signé par ${clientName}` },
    });

    res.json({ report: shapeReport(updated) });
  }),
);

/** Relecture interne (valider / demander un complément) — jamais visible du client, ne touche pas à la signature. */
reportsRouter.post(
  '/:id/review',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const report = await prisma.worksiteReport.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, worksiteId: true, worksite: { select: { managerId: true } } } });
    if (!report) throw new HttpError(404, 'Rapport introuvable');
    if (report.status !== 'signed') throw new HttpError(409, 'Le rapport doit être signé avant relecture');
    if (req.user!.role === 'foreman' && report.worksite.managerId !== req.user!.personId) {
      throw new HttpError(403, 'Ce rapport ne concerne pas vos chantiers');
    }
    const { decision, note } = reportReviewInput.parse(req.body);
    if (decision === 'needs_info' && !note?.trim()) throw new HttpError(422, 'Précise ce qui manque.');

    const updated = await prisma.worksiteReport.update({
      where: { id: report.id },
      data: { reviewStatus: decision, reviewNote: note?.trim() || null, reviewedAt: new Date(), reviewedById: req.user!.id },
      include: reportInclude,
    });

    if (decision === 'needs_info') {
      const thread = await prisma.thread.upsert({ where: { worksiteId: report.worksiteId }, create: { worksiteId: report.worksiteId }, update: {} });
      await prisma.message.create({
        data: { threadId: thread.id, authorName: await authorName(req.user!.id), kind: 'status', body: `Rapport à compléter : ${note!.trim()}` },
      });
    }

    res.json({ report: shapeReport(updated) });
  }),
);

reportsRouter.delete(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const r = await prisma.worksiteReport.findUnique({ where: { id: req.params.id } });
    if (!r) throw new HttpError(404, 'Rapport introuvable');
    if (r.status === 'signed') throw new HttpError(409, 'Un rapport signé ne peut pas être supprimé');
    await prisma.worksiteReport.delete({ where: { id: r.id } });
    res.json({ ok: true });
  }),
);
