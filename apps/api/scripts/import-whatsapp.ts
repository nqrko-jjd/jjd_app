/**
 * Import des groupes WhatsApp de chantier (« fil de chantier »).
 *
 *   npm run import:whatsapp
 *
 * Chaque sous-dossier de data-import/whatsapp/ = un export WhatsApp
 * (fichier « Discussion WhatsApp avec ….txt » + photos/vidéos).
 * Le chantier est retrouvé via la réf R- du nom de dossier, ou via
 * data-import/whatsapp/mapping.txt (« bout du nom = R-123 »).
 * Idempotent : les messages source "whatsapp" du fil sont remplacés.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { normalizeName } from '@jjd/shared';
import { storeImage, storeFile } from '../src/lib/media.js';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../data-import/whatsapp');

/* -------------------------------------------------------------- parsing */

const LINE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s(\d{1,2}):(\d{2})\s[-–]\s(.*)$/;
const ATTACH_RE = /^‎?(.+?\.(jpe?g|png|webp|mp4|mov|3gp|opus|m4a|aac|pdf|vcf|docx?|xlsx?))\s*\((fichier joint|file attached)\)$/i;
const MARKS_RE = /[‎‏⁦-⁩]/g;
const SKIP_BODY = new Set([
  'null', 'Ce message a été supprimé.', 'This message was deleted.',
  '<Médias omis>', '<Médias omis>', '<Media omitted>',
  'Vous avez supprimé ce message.', 'You deleted this message.',
]);
/** Lignes système WhatsApp (création de groupe, ajout/départ de membres, chiffrement…). */
const SYSTEM_RE = /^(Les messages et les appels|Vous avez (créé|ajouté|retiré|expulsé|changé|modifié|supprimé le sujet|activé|désactivé)|Vous êtes maintenant|Vous avez rejoint|.{0,60}\b(a créé le groupe|a ajouté|a été ajouté|a quitté|a retiré|a expulsé|a changé|a modifié|a rejoint|ont rejoint|est maintenant admin|a supprimé|a été expulsé|a activé le verrouillage|a désactivé))/i;

interface Msg { at: Date; author: string | null; body: string; attach: string | null }

function parseChat(text: string): Msg[] {
  const out: Msg[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = LINE_RE.exec(raw);
    if (!m) {
      if (out.length) out[out.length - 1]!.body += `\n${raw}`;
      continue;
    }
    const [, d, mo, y, hh, mm, restRaw] = m;
    const rest = restRaw!.replace(MARKS_RE, '');
    const at = new Date(Date.UTC(2000 + Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)));
    if (SYSTEM_RE.test(rest)) { out.push({ at, author: null, body: '', attach: null }); continue; }
    const colon = rest.indexOf(': ');
    let author: string | null = null;
    let body = rest;
    if (colon > 0 && colon < 42) { author = rest.slice(0, colon).trim(); body = rest.slice(colon + 2); }
    const a = ATTACH_RE.exec(body.trim());
    out.push({ at, author, body: a ? '' : body, attach: a ? a[1]! : null });
  }
  return out;
}

/** « Julien Sweert 😁 » -> « Julien Sweert » ; retire emoji + marques directionnelles. */
function cleanName(n: string): string {
  return n
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}☀-➿️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const dirs = readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory());

  const worksites = await prisma.worksite.findMany({ select: { id: true, ref: true } });
  const wsByRef = new Map(worksites.map((w) => [w.ref.toUpperCase(), w.id]));
  const people = await prisma.person.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true, displayName: true },
  });
  // n'indexe que les fiches "individuelles" (pas les libellés composites « Julien / Pascal »)
  const personByToken = new Map<string, { id: string; label: string }>();
  for (const p of people) {
    const label = p.displayName || p.firstName;
    if (/[/&+]|,/.test(label)) continue;
    const keys = [normalizeName(label), normalizeName(`${p.firstName} ${p.lastName ?? ''}`.trim())];
    if (/^[A-Za-zÀ-ÿ]+$/.test(p.firstName)) keys.push(normalizeName(p.firstName));
    for (const k of keys) if (k && !personByToken.has(k)) personByToken.set(k, { id: p.id, label });
  }
  const matchAuthor = (waName: string): { label: string; personId: string | null } => {
    const clean = cleanName(waName);
    const words = clean.split(' ').filter(Boolean);
    for (const cand of [normalizeName(clean), ...words.map((w) => normalizeName(w))]) {
      const hit = personByToken.get(cand);
      if (hit) return { label: hit.label, personId: hit.id };
    }
    return { label: words[0] ? words.slice(0, 2).join(' ') : clean, personId: null };
  };

  await prisma.importIssue.deleteMany({ where: { batch: { source: 'whatsapp' } } });
  await prisma.importBatch.deleteMany({ where: { source: 'whatsapp' } });
  const batch = await prisma.importBatch.create({ data: { source: 'whatsapp', label: `${dirs.length} groupes` } });

  let groups = 0, texts = 0, photos = 0, videos = 0, files = 0, skipped = 0;
  const issues: { rowRef: string; message: string }[] = [];

  for (const dir of dirs) {
    const full = path.join(root, dir);
    const txt = readdirSync(full).find((f) => f.toLowerCase().endsWith('.txt'));
    if (!txt) { issues.push({ rowRef: dir, message: 'Aucun fichier .txt (export vide ?)' }); continue; }

    const ref = refFromName(dir, mapping);
    const wsId = ref ? wsByRef.get(ref.toUpperCase()) ?? null : null;
    if (!wsId) {
      skipped++;
      issues.push({ rowRef: dir, message: ref ? `Chantier ${ref} introuvable` : 'Pas de réf R- dans le nom (utilise mapping.txt)' });
      continue;
    }

    const thread = await prisma.thread.upsert({ where: { worksiteId: wsId }, create: { worksiteId: wsId }, update: {} });
    await prisma.message.deleteMany({ where: { threadId: thread.id, source: 'whatsapp' } });

    const msgs = parseChat(readFileSync(path.join(full, txt), 'utf8'));
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

      const fp = path.join(full, msg.attach);
      if (!existsSync(fp)) { issues.push({ rowRef: `${ref}/${msg.attach}`, message: 'Média absent de l’export' }); continue; }
      const buf = readFileSync(fp);
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
