import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import { createReadStream, existsSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';

/**
 * Documents d'un chantier (fiches techniques, plans, offres fournisseurs, certificats…) : le bureau les dépose,
 * toute l'équipe peut les ouvrir. La limite de 14 Mo par fichier est celle du proxy (15 Mo par requête) : un fichier
 * plus gros est refusé avec un message clair plutôt qu'une page d'erreur HTML.
 */
export const worksiteFilesRouter = Router({ mergeParams: true });

export const MAX_FILE_BYTES = 14 * 1024 * 1024;
export const FILE_CATEGORIES = ['Fiche technique', 'Plan', 'Offre / devis fournisseur', 'Certificat / garantie', 'Photo', 'Autre'] as const;
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.rtf', '.txt', '.csv', '.zip', '.dwg', '.dxf']);
const INLINE_TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
function uploadOne(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Fichier trop lourd : ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} Mo maximum par fichier.`));
    next(err);
  });
}

const cleanName = (s: string) => s.replace(/[\u0000-\u001f"\\/]/g, '_').trim();
/** Les noms de fichiers arrivent en latin1 depuis multer : on les remet en UTF-8 (accents). */
const fixName = (s: string) => { try { const u = Buffer.from(s, 'latin1').toString('utf8'); return u.includes('�') ? s : u; } catch { return s; } };

async function mustWorksite(id: string) {
  const w = await prisma.worksite.findUnique({ where: { id }, select: { id: true } });
  if (!w) throw new HttpError(404, 'Chantier introuvable');
}

function present(f: { id: string; label: string; category: string | null; originalName: string | null; mimeType: string | null; size: number; createdAt: Date; uploadedBy: { email: string; person: { displayName: string | null; firstName: string } | null } | null }, worksiteId: string) {
  return {
    id: f.id, label: f.label, category: f.category, originalName: f.originalName, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt,
    uploadedBy: f.uploadedBy ? (f.uploadedBy.person?.displayName || f.uploadedBy.person?.firstName || f.uploadedBy.email) : null,
    downloadPath: `/api/worksites/${worksiteId}/files/${f.id}/download`,
  };
}
const include = { uploadedBy: { select: { email: true, person: { select: { displayName: true, firstName: true } } } } } as const;

worksiteFilesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    await mustWorksite(worksiteId);
    const rows = await prisma.worksiteFile.findMany({ where: { worksiteId }, orderBy: { createdAt: 'desc' }, include });
    res.json({ items: rows.map((f) => present(f, worksiteId)), categories: FILE_CATEGORIES, maxBytes: MAX_FILE_BYTES });
  }),
);

worksiteFilesRouter.post(
  '/',
  requireAuth(...OFFICE),
  uploadOne,
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    await mustWorksite(worksiteId);
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const original = cleanName(fixName(req.file.originalname || 'fichier'));
    const ext = path.extname(original).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new HttpError(422, `Type de fichier non accepté (${ext || 'sans extension'}). Acceptés : PDF, images, Word/Excel/PowerPoint, texte, zip, plans DWG/DXF.`);
    const body = z.object({ label: z.string().max(200).optional(), category: z.string().max(60).optional() }).parse(req.body ?? {});
    const category = body.category && (FILE_CATEGORIES as readonly string[]).includes(body.category) ? body.category : null;
    const fileUrl = storeFile(req.file.buffer, original, 'worksite-files');
    const row = await prisma.worksiteFile.create({
      data: { worksiteId, label: body.label?.trim() || original.replace(/\.[^.]+$/, ''), category, fileUrl, originalName: original, mimeType: req.file.mimetype || null, size: req.file.size, uploadedById: req.user!.id },
      include,
    });
    res.status(201).json({ file: present(row, worksiteId) });
  }),
);

worksiteFilesRouter.patch(
  '/:fileId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const body = z.object({ label: z.string().min(1).max(200).optional(), category: z.string().max(60).nullable().optional() }).parse(req.body ?? {});
    const f = await prisma.worksiteFile.findFirst({ where: { id: req.params.fileId, worksiteId } });
    if (!f) throw new HttpError(404, 'Fichier introuvable');
    const row = await prisma.worksiteFile.update({
      where: { id: f.id },
      data: {
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.category !== undefined ? { category: body.category && (FILE_CATEGORIES as readonly string[]).includes(body.category) ? body.category : null } : {}),
      },
      include,
    });
    res.json({ file: present(row, worksiteId) });
  }),
);

worksiteFilesRouter.delete(
  '/:fileId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const f = await prisma.worksiteFile.findFirst({ where: { id: req.params.fileId, worksiteId: req.params.worksiteId } });
    if (!f) throw new HttpError(404, 'Fichier introuvable');
    await prisma.worksiteFile.delete({ where: { id: f.id } });
    try {
      const p = path.join(UPLOADS_DIR, path.normalize(f.fileUrl.replace(/^\/?uploads\//, '')));
      if (existsSync(p)) unlinkSync(p);
    } catch { /* le fichier disparu du disque ne doit pas bloquer la suppression */ }
    res.status(204).end();
  }),
);

worksiteFilesRouter.get(
  '/:fileId/download',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const f = await prisma.worksiteFile.findFirst({ where: { id: req.params.fileId, worksiteId: req.params.worksiteId } });
    if (!f) throw new HttpError(404, 'Fichier introuvable');
    const p = path.join(UPLOADS_DIR, path.normalize(f.fileUrl.replace(/^\/?uploads\//, '')));
    if (!existsSync(p)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const ext = path.extname(p).toLowerCase();
    const inline = INLINE_TYPES[ext];
    const name = `${(f.originalName ?? f.label).replace(/[^\w.\- ()]/g, '_')}`;
    res.setHeader('Content-Type', inline ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
    createReadStream(p).pipe(res);
  }),
);
