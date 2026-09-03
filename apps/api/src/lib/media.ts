/**
 * Stockage local des photos de chantier. En dev : dossier apps/api/uploads/,
 * servi en statique. En prod : à basculer sur un volume / S3 (lot 7).
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { nanoid } from 'nanoid';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// En prod (Docker), UPLOADS_DIR pointe vers un volume persistant.
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(root, 'uploads');

export interface StoredImage {
  url: string; // chemin relatif portable, ex. /uploads/media/2026/09/abc.webp
  thumbUrl: string;
  width: number;
  height: number;
}

/** Redimensionne en WebP (1600px max) + vignette 480px, écrit sur disque. */
export async function storeImage(buffer: Buffer): Promise<StoredImage> {
  const now = new Date();
  const rel = path.join('media', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const dir = path.join(UPLOADS_DIR, rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const id = nanoid(14);
  const img = sharp(buffer, { failOn: 'none' }).rotate(); // respecte l'EXIF orientation
  const meta = await img.metadata();

  await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toFile(path.join(dir, `${id}.webp`));
  await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 }).toFile(path.join(dir, `${id}_t.webp`));

  const base = `/uploads/${rel.replace(/\\/g, '/')}`;
  return {
    url: `${base}/${id}.webp`,
    thumbUrl: `${base}/${id}_t.webp`,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

/** Stocke un fichier tel quel (vidéo, PDF…) sous uploads/<subdir>/. Renvoie l'URL relative. */
export function storeFile(buffer: Buffer, originalName: string, subdir = 'files'): string {
  const now = new Date();
  const rel = path.join(subdir, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const dir = path.join(UPLOADS_DIR, rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ext = (originalName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const name = `${nanoid(14)}${ext}`;
  writeFileSync(path.join(dir, name), buffer);
  return `/uploads/${rel.replace(/\\/g, '/')}/${name}`;
}
