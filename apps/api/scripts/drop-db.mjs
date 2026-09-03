/**
 * Supprime la base SQLite de dev. Prisma interdit `db push --force-reset` sous
 * agent IA -> on efface le fichier à la main (dev uniquement).
 * Ne fait rien si DATABASE_URL pointe ailleurs que sur un fichier SQLite local.
 */
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let url = process.env.DATABASE_URL ?? '';
if (!url && existsSync(path.join(root, '.env'))) {
  url = readFileSync(path.join(root, '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
}
if (!url.startsWith('file:')) {
  console.log('[drop-db] DATABASE_URL non-SQLite, rien à supprimer.');
  process.exit(0);
}
const rel = url.slice('file:'.length);
const dbPath = path.resolve(root, 'prisma', rel.replace(/^\.\/?/, '').replace(/^prisma[\\/]/, ''));
for (const f of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(f)) {
    rmSync(f);
    console.log(`[drop-db] supprimé ${path.basename(f)}`);
  }
}
