/**
 * Import du planning depuis l'export iCal (.ics) de l'agenda Google « Planning JJD ».
 *
 *   npm run import:agenda                       (détecte le .ics dans data-import/)
 *   npm run import:agenda -- --since 2025-01-01  (fenêtre d'import — défaut : 120 jours en arrière)
 *   npm run import:agenda -- chemin/vers/fichier.ics --since 2026-01-01
 *
 * Rattachement au chantier : référence R- dans le titre, sinon dans la description.
 * La description est analysée pour « Ouvrier(s) : », « Véhicule : », « Matériel : », « Tâches : ».
 * Idempotent : chaque événement est upserté par son UID Google (`googleEventId`).
 * Les événements non rattachés partent dans la file de contrôle.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { normalizeName } from '@jjd/shared';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../data-import');

/* -------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
let sinceArg: string | null = null;
let fileArg: string | null = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--since') sinceArg = argv[++i] ?? null;
  else if (argv[i]!.endsWith('.ics')) fileArg = path.resolve(argv[i]!);
}
const since = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 120 * 86400_000);

function findIcs(): string {
  if (fileArg) return fileArg;
  if (!existsSync(dataDir)) throw new Error('data-import/ introuvable');
  const f = readdirSync(dataDir).find((n) => n.toLowerCase().endsWith('.ics'));
  if (!f) throw new Error('Aucun fichier .ics dans data-import/');
  return path.join(dataDir, f);
}

/* -------------------------------------------------------------- parse iCal */

interface RawEvent { [key: string]: string }

/** Déplie les lignes (RFC 5545 : une ligne qui commence par espace/tab continue la précédente). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseEvents(ics: string): RawEvent[] {
  const lines = unfold(ics);
  const events: RawEvent[] = [];
  let cur: RawEvent | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const rawKey = line.slice(0, idx); // ex. DTSTART;VALUE=DATE
    const value = line.slice(idx + 1);
    const key = rawKey.split(';')[0]!;
    cur[key] = value;
    // conserve les paramètres utiles
    if (rawKey.includes('VALUE=DATE')) cur[`${key}_DATEONLY`] = '1';
    const tz = rawKey.match(/TZID=([^;:]+)/);
    if (tz) cur[`${key}_TZ`] = tz[1]!;
  }
  return events;
}

/** « 20250516T083000Z » / « 20240919 » (date seule) -> Date. */
function parseIcalDate(value: string, dateOnly: boolean): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : null;
  const mm = m[5] ? Number(m[5]) : 0;
  const ss = m[6] ? Number(m[6]) : 0;
  if (dateOnly || hh === null) return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  if (m[7]) return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  // heure locale Bruxelles sans Z : approx UTC+1 (l'écart DST est mineur pour du planning)
  return new Date(Date.UTC(y, mo - 1, d, hh - 1, mm, ss));
}

/** Nettoie une description HTML/texte en texte simple. */
function cleanDescription(v: string): string {
  return unescapeText(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extrait la valeur d'un champ « Label : … » (jusqu'au prochain saut de ligne ou label). */
function field(desc: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i');
    const m = desc.match(re);
    if (m) return m[1]!.trim().replace(/[.;,\s]+$/, '');
  }
  return null;
}

function extractRef(...texts: (string | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/\bR-?\s?(\d{1,4})\b/i);
    if (m) return `R-${m[1]}`;
  }
  return null;
}

function splitPeople(raw: string): string[] {
  return raw
    .split(/\s*(?:,|\/|\bet\b|&|\+|;)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !/^(le|la|les|de|et)$/i.test(s));
}

/* -------------------------------------------------------------- import */

async function main() {
  const file = findIcs();
  const ics = readFileSync(file, 'utf8');
  const events = parseEvents(ics);
  console.log(`Agenda : ${events.length} événements dans ${path.basename(file)} · fenêtre depuis ${since.toISOString().slice(0, 10)}`);

  const [worksites, people, vehicles] = await Promise.all([
    prisma.worksite.findMany({ select: { id: true, ref: true } }),
    prisma.person.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true, displayName: true } }),
    prisma.vehicle.findMany({ select: { id: true, code: true, plate: true, brand: true, model: true } }),
  ]);
  const wsByRef = new Map(worksites.map((w) => [w.ref.toUpperCase(), w.id]));
  const personByName = new Map<string, string>();
  for (const p of people) {
    for (const n of [p.displayName, p.firstName, `${p.firstName} ${p.lastName ?? ''}`]) {
      if (n) personByName.set(normalizeName(n), p.id);
    }
  }
  const matchPerson = (raw: string): string | null => {
    const n = normalizeName(raw);
    if (personByName.has(n)) return personByName.get(n)!;
    for (const [k, id] of personByName) if (k.length >= 3 && (k.startsWith(n) || n.startsWith(k))) return id;
    return null;
  };
  const matchVehicle = (raw: string): string | null => {
    const n = raw.toLowerCase();
    for (const v of vehicles) {
      if (v.plate && n.includes(v.plate.toLowerCase())) return v.id;
      if (v.code && n.includes(v.code.toLowerCase())) return v.id;
      if (v.brand && n.includes(v.brand.toLowerCase())) return v.id;
    }
    return null;
  };

  await prisma.importIssue.deleteMany({ where: { batch: { source: 'agenda' } } });
  await prisma.importBatch.deleteMany({ where: { source: 'agenda' } });
  const batch = await prisma.importBatch.create({ data: { source: 'agenda', label: path.basename(file) } });

  let created = 0, updated = 0, skippedOld = 0, skippedNoRef = 0, assignments = 0;
  const issues: { rowRef: string; message: string; rawData: unknown }[] = [];

  for (const e of events) {
    const uid = e.UID;
    const summary = unescapeText(e.SUMMARY ?? '').trim();
    const start = e.DTSTART ? parseIcalDate(e.DTSTART, e.DTSTART_DATEONLY === '1') : null;
    const end = e.DTEND ? parseIcalDate(e.DTEND, e.DTEND_DATEONLY === '1') : null;
    if (!uid || !start) continue;
    if (start < since) { skippedOld++; continue; }

    const desc = cleanDescription(e.DESCRIPTION ?? '');
    const ref = extractRef(summary, desc);
    const wsId = ref ? wsByRef.get(ref.toUpperCase()) ?? null : null;

    if (!wsId) {
      skippedNoRef++;
      issues.push({
        rowRef: summary.slice(0, 80),
        message: ref ? `Chantier ${ref} introuvable` : 'Aucune référence R- dans le titre ni la description',
        rawData: { summary, start: start.toISOString(), location: unescapeText(e.LOCATION ?? ''), desc: desc.slice(0, 300) },
      });
      continue;
    }

    const endAt = end && end > start ? end : new Date(start.getTime() + 8 * 3600_000);
    const allDay = e.DTSTART_DATEONLY === '1';
    const tasks = field(desc, ['Tâches', 'Taches', 'Tâche', 'Objet']);
    const materials = field(desc, ['Matériel', 'Materiel', 'Matos']);
    const vehicleRaw = field(desc, ['Véhicule', 'Vehicule', 'Camion', 'Camionnette']);
    const workersRaw = field(desc, ['Ouvriers', 'Ouvrier', 'Équipe', 'Equipe']);

    const note = [tasks && `Tâches : ${tasks}`, !tasks && desc].filter(Boolean).join('').slice(0, 2000) || desc.slice(0, 2000) || null;

    const data = {
      worksiteId: wsId,
      title: summary.replace(/^R-?\s?\d+\s*[-–]\s*/i, '').slice(0, 160) || null,
      startAt: start,
      endAt,
      allDay,
      note,
      materialsNote: materials ?? (vehicleRaw ? `Véhicule : ${vehicleRaw}` : null),
      vehicleId: vehicleRaw ? matchVehicle(vehicleRaw) : null,
      googleEventId: uid,
      source: 'agenda-import',
    };

    const existing = await prisma.planningEvent.findUnique({ where: { googleEventId: uid } });
    let eventId: string;
    if (existing) {
      await prisma.planningEvent.update({ where: { id: existing.id }, data });
      eventId = existing.id;
      updated++;
    } else {
      const ev = await prisma.planningEvent.create({ data });
      eventId = ev.id;
      created++;
    }

    // affectations ouvriers
    if (workersRaw) {
      await prisma.eventAssignment.deleteMany({ where: { eventId } });
      const seen = new Set<string>();
      for (const name of splitPeople(workersRaw)) {
        const pid = matchPerson(name);
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          await prisma.eventAssignment.create({ data: { eventId, personId: pid } }).catch(() => {});
          assignments++;
        } else if (!pid) {
          issues.push({ rowRef: summary.slice(0, 60), message: `Ouvrier « ${name} » non reconnu`, rawData: { workersRaw } });
        }
      }
    }
  }

  if (issues.length) {
    await prisma.importIssue.createMany({
      data: issues.slice(0, 2000).map((i) => ({
        batchId: batch.id, entity: 'planning_event', sheet: 'agenda',
        rowRef: i.rowRef, severity: 'warning', message: i.message, rawData: i.rawData as object,
      })),
    });
  }

  const stats = { created, updated, skippedOld, skippedNoRef, assignments, issues: issues.length };
  await prisma.importBatch.update({ where: { id: batch.id }, data: { finishedAt: new Date(), stats } });
  console.log('Planning importé :', JSON.stringify(stats, null, 1));
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
