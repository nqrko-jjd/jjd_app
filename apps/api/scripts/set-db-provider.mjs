/**
 * Aligne le `provider` de prisma/schema.prisma sur le schéma de DATABASE_URL.
 *   postgres:// | postgresql://  -> "postgresql"
 *   file: (défaut)               -> "sqlite"
 * SQLite en dev (zéro service), PostgreSQL en prod, un seul schéma.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const envPath = path.join(root, '.env');
if (!existsSync(envPath) && existsSync(path.join(root, '.env.example'))) {
  copyFileSync(path.join(root, '.env.example'), envPath);
}

let url = process.env.DATABASE_URL ?? '';
if (!url && existsSync(envPath)) {
  const m = readFileSync(envPath, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/m);
  if (m) url = m[1].trim().replace(/^["']|["']$/g, '');
}

const provider = /^postgres(ql)?:\/\//i.test(url) ? 'postgresql' : 'sqlite';
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
const src = readFileSync(schemaPath, 'utf8');
const next = src.replace(/(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"/s, `$1"${provider}"`);
if (next !== src) {
  writeFileSync(schemaPath, next);
  console.log(`[set-db-provider] provider = "${provider}"`);
} else {
  console.log(`[set-db-provider] provider déjà "${provider}"`);
}
