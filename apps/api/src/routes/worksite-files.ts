import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import os from 'node:os';
import { nanoid } from 'nanoid';
import { createReadStream, existsSync, unlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { UPLOADS_DIR } from '../lib/media.js';

/**
 * Documents d'un chantier (fiches techniques, plans, offres fournisseurs, certificats, vidéos…) : le bureau les dépose,
 * toute l'équipe peut les ouvrir. 300 Mo par fichier (vidéos MP4 comprises) : il faut une règle dédiée côté proxy (nginx
 * limite les autres routes à 15 Mo) ; au-delà, refus avec un message clair plutôt qu'une page d'erreur HTML. Les envois
 * transitent par un fichier temporaire (pas en mémoire) pour ne pas saturer le serveur avec une grosse vidéo.
 */
export const worksiteFilesRouter = Router({ mergeParams: true });

export const MAX_FILE_BYTES = 300 * 1024 * 1024;
/** Limite effective (surchargeable par WORKSITE_FILE_MAX_MB, notamment pour les tests). */
export const maxFileBytes = () => (Number(process.env.WORKSITE_FILE_MAX_MB) > 0 ? Number(process.env.WORKSITE_FILE_MAX_MB) * 1024 * 1024 : MAX_FILE_BYTES);
export const FILE_CATEGORIES = ['Fiche technique', 'Plan', 'Offre / devis fournisseur', 'Certificat / garantie', 'Photo', 'Vidéo', 'Autre'] as const;
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.rtf', '.txt', '.csv', '.zip', '.dwg', '.dxf', '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp', '.mp3', '.m4a', '.wav', '.ogg', '.opus']);
const INLINE_TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };

const diskStorage = multer.diskStorage({ destination: os.tmpdir(), filename: (_req, _file, cb) => cb(null, `wf-${nanoid(12)}`) });
function uploadOne(req: Request, res: Response, next: NextFunction) {
  multer({ storage: diskStorage, limits: { fileSize: maxFileBytes(), files: 1 } }).single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Fichier trop lourd : ${Math.round(maxFileBytes() / 1024 / 1024)} Mo maximum par fichier.`));
    next(err);
  });
}
/** Range le fichier temporaire reçu dans uploads/worksite-files/AAAA/MM/ (copie + suppression : tmp et volume sont deux disques). */
function storeFromTmp(tmpPath: string, originalName: string): string {
  const now = new Date();
  const rel = path.join('worksite-files', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const dir = path.join(UPLOADS_DIR, rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ext = (originalName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const name = `${nanoid(14)}${ext}`;
  copyFileSync(tmpPath, path.join(dir, name));
  return `/uploads/${rel.replace(/\\/g, '/')}/${name}`;
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
    res.json({ items: rows.map((f) => present(f, worksiteId)), categories: FILE_CATEGORIES, maxBytes: maxFileBytes() });
  }),
);

worksiteFilesRouter.post(
  '/',
  requireAuth(...OFFICE),
  uploadOne,
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId!;
    const tmp = req.file?.path;
    try {
      await mustWorksite(worksiteId);
      if (!req.file) throw new HttpError(422, 'Aucun fichier');
      const original = cleanName(fixName(req.file.originalname || 'fichier'));
      const ext = path.extname(original).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) throw new HttpError(422, `Type de fichier non accepté (${ext || 'sans extension'}). Acceptés : PDF, images, vidéos (MP4, MOV…), sons, Word/Excel/PowerPoint, texte, zip, plans DWG/DXF.`);
      const body = z.object({ label: z.string().max(200).optional(), category: z.string().max(60).optional() }).parse(req.body ?? {});
      const category = body.category && (FILE_CATEGORIES as readonly string[]).includes(body.category) ? body.category : null;
      const fileUrl = storeFromTmp(req.file.path, original);
      const row = await prisma.worksiteFile.create({
        data: { worksiteId, label: body.label?.trim() || original.replace(/\.[^.]+$/, ''), category, fileUrl, originalName: original, mimeType: req.file.mimetype || null, size: req.file.size, uploadedById: req.user!.id },
        include,
      });
      res.status(201).json({ file: present(row, worksiteId) });
    } finally {
      if (tmp) { try { unlinkSync(tmp); } catch { /* déjà supprimé */ } }
    }
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
