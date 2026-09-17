/**
 * Import des groupes WhatsApp de chantier (« fil de chantier »).
 *
 *   npm run import:whatsapp
 *
 * Chaque entrée de data-import/whatsapp/ = un export WhatsApp, soit déjà
 * décompressé (sous-dossier contenant le .txt + photos/vidéos), soit tel
 * quel (fichier .zip exporté depuis WhatsApp — pas besoin de le dézipper).
 * Le chantier est retrouvé via la réf R- du nom de dossier/fichier, ou via
 * data-import/whatsapp/mapping.txt (« bout du nom = R-123 »).
 * Idempotent : les messages source "whatsapp" du fil sont remplacés.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { PrismaClient } from '@prisma/client';
import { storeImage, storeFile } from '../src/lib/media.js';
import { parseWhatsAppChat as parseChat, buildWhatsAppAuthorMatcher, WHATSAPP_SKIP_BODY as SKIP_BODY } from '../src/lib/whatsapp-import.js';

/** Un export, qu'il vienne d'un dossier déjà extrait ou d'un .zip lu en mémoire. */
interface ExportSource {
  name: string; // nom du dossier ou du zip (sans extension) — sert à retrouver la réf R-
  txtName: string;
  readText: () => string;
  readAttachment: (basename: string) => Buffer | null;
}

function sourceFromDir(dirName: string, full: string): ExportSource | null {
  const txt = readdirSync(full).find((f) => f.toLowerCase().endsWith('.txt'));
  if (!txt) return null;
  return {
    name: dirName,
    txtName: txt,
    readText: () => readFileSync(path.join(full, txt), 'utf8'),
    readAttachment: (basename) => {
      const fp = path.join(full, basename);
      return existsSync(fp) ? readFileSync(fp) : null;
    },
  };
}

function sourceFromZip(zipName: string, full: string): ExportSource | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(readFileSync(full)));
  } catch {
    return null;
  }
  const fileNames = Object.keys(entries).filter((n) => !n.endsWith('/'));
  const txtCandidates = fileNames.filter((n) => n.toLowerCase().endsWith('.txt'));
  const txtName = txtCandidates.find((n) => /chat|discussion/i.test(n)) ?? txtCandidates[0];
  if (!txtName) return null;
  const byBasename = new Map<string, Uint8Array>();
  for (const n of fileNames) byBasename.set(n.split('/').pop()!.toLowerCase(), entries[n]!);
  return {
    name: zipName.replace(/\.zip$/i, ''),
    txtName,
    readText: () => Buffer.from(entries[txtName]!).toString('utf8'),
    readAttachment: (basename) => {
      const buf = byBasename.get(basename.toLowerCase());
      return buf ? Buffer.from(buf) : null;
    },
  };
}

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../data-import/whatsapp');

/* -------------------------------------------------------------- import */

function loadMapping(): { needle: string; ref: string }[] {
  const f = path.join(root, 'mapping.txt');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map((l) => {
    const m = l.split('=');
    if (m.length < 2) return null;
    const ref = m[1]!.trim().toUpperCase().replace(/\s/g, '');
    return { needle: m[0]!.trim().toLowerCase(), ref: /^R-?\d+$/.test(ref) ? ref.replace('R', 'R-').replace('R--', 'R-') : ref };
  }).filter((x): x is { needle: string; ref: string } => !!x);
}

function refFromName(name: string, mapping: { needle: string; ref: string }[]): string | null {
  const lo = name.toLowerCase();
  for (const m of mapping) if (lo.includes(m.needle)) return m.ref;
  const g = name.match(/\bR\s?-?\s?(\d{1,4})\b/i);
  return g ? `R-${g[1]}` : null;
}

async function main() {
  if (!existsSync(root)) { console.log('Aucun dossier data-import/whatsapp/'); return; }
  const mapping = loadMapping();
  const entries = readdirSync(root);
  const dirs = entries.filter((d) => statSync(path.join(root, d)).isDirectory());
  const zips = entries.filter((f) => f.toLowerCase().endsWith('.zip'));

  const worksites = await prisma.worksite.findMany({ select: { id: true, ref: true } });
  const wsByRef = new Map(worksites.map((w) => [w.ref.toUpperCase(), w.id]));
  const people = await prisma.person.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true, displayName: true },
  });
  const matchAuthor = buildWhatsAppAuthorMatcher(people);

  await prisma.importIssue.deleteMany({ where: { batch: { source: 'whatsapp' } } });
  await prisma.importBatch.deleteMany({ where: { source: 'whatsapp' } });
  const batch = await prisma.importBatch.create({ data: { source: 'whatsapp', label: `${dirs.length + zips.length} groupes` } });

  let groups = 0, texts = 0, photos = 0, videos = 0, files = 0, skipped = 0;
  const issues: { rowRef: string; message: string }[] = [];

  const sources = [
    ...dirs.map((d) => sourceFromDir(d, path.join(root, d))),
    ...zips.map((z) => sourceFromZip(z, path.join(root, z))),
  ];

  for (const src of sources) {
    if (!src) { issues.push({ rowRef: '?', message: 'Aucun fichier .txt (export vide ou zip illisible ?)' }); continue; }

    const ref = refFromName(src.name, mapping);
    const wsId = ref ? wsByRef.get(ref.toUpperCase()) ?? null : null;
    if (!wsId) {
      skipped++;
      issues.push({ rowRef: src.name, message: ref ? `Chantier ${ref} introuvable` : 'Pas de réf R- dans le nom (utilise mapping.txt)' });
      continue;
    }

    const thread = await prisma.thread.upsert({ where: { worksiteId: wsId }, create: { worksiteId: wsId }, update: {} });
    await prisma.message.deleteMany({ where: { threadId: thread.id, source: 'whatsapp' } });

    const msgs = parseChat(src.readText());
    for (const msg of msgs) {
      if (!msg.author) continue; // ligne système
      const t = msg.body.trim();
      if (!msg.attach && (SKIP_BODY.has(t) || t === '')) continue;
      const who = matchAuthor(msg.author);

      if (!msg.attach) {
        await prisma.message.create({
          data: { threadId: thread.id, authorName: who.label, kind: 'text', body: msg.body.trim(), source: 'whatsapp', createdAt: msg.at },
        });
        texts++;
        continue;
      }

      const buf = src.readAttachment(msg.attach);
      if (!buf) { issues.push({ rowRef: `${ref}/${msg.attach}`, message: 'Média absent de l’export' }); continue; }
      const ext = msg.attach.toLowerCase().split('.').pop()!;
      try {
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
          const img = await storeImage(buf);
          await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'photo', fileUrl: img.url, thumbUrl: img.thumbUrl, source: 'whatsapp', createdAt: msg.at } });
          photos++;
        } else if (['mp4', 'mov', '3gp'].includes(ext)) {
          const url = storeFile(buf, msg.attach, `whatsapp/${ref}`);
          await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'video', fileUrl: url, body: null, source: 'whatsapp', createdAt: msg.at } });
          videos++;
        } else {
          const url = storeFile(buf, msg.attach, `whatsapp/${ref}`);
          await prisma.message.create({ data: { threadId: thread.id, authorName: who.label, kind: 'file', fileUrl: url, body: msg.attach, source: 'whatsapp', createdAt: msg.at } });
          files++;
        }
      } catch (e) {
        issues.push({ rowRef: `${ref}/${msg.attach}`, message: `Média illisible : ${(e as Error).message}` });
      }
    }
    groups++;
    console.log(`  ${ref} — ${msgs.length} lignes`);
  }

  if (issues.length) {
    await prisma.importIssue.createMany({
      data: issues.slice(0, 2000).map((i) => ({ batchId: batch.id, entity: 'message', sheet: 'whatsapp', rowRef: i.rowRef, severity: 'warning', message: i.message })),
    });
  }
  const stats = { groups, texts, photos, videos, files, skipped, issues: issues.length };
  await prisma.importBatch.update({ where: { id: batch.id }, data: { finishedAt: new Date(), stats } });
  console.log('WhatsApp importé :', JSON.stringify(stats, null, 1));
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
