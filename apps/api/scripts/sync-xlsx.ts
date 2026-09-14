/**
 * Synchronisation incrémentale depuis le fichier Excel de rentabilité — contrairement à
 * `import-xlsx.ts` (destructif : purge tout ce qui vient de l'Excel puis réimporte), ce
 * script n'AJOUTE que ce qui est nouveau et ne touche jamais à une ligne déjà en base
 * (chantier existant, écriture déjà importée, contact déjà connu…). Sûr à rejouer autant
 * de fois que voulu après avoir complété le fichier (nouveaux R-, nouvelles factures).
 *
 *   npm run sync                       -> data-import/calculs-rentabilite.xlsx
 *   npm run sync -- chemin/vers.xlsx
 *
 * Important : maintenant que l'appli est utilisée en production (chantiers créés/modifiés
 * dans l'appli, contacts fusionnés, devis, tâches…), `import-xlsx.ts` (le réimport complet)
 * ne doit plus être exécuté — il effacerait ce travail. Ce script-ci est la seule façon
 * sûre de faire entrer de nouvelles lignes Excel dans l'appli.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  parseLooseDate, parseAmount, guessWorksiteStatus, parseStatusTags, normalizeName,
} from '@jjd/shared';
import { readXlsx, type SheetData } from '../src/lib/xlsx-read.js';
import { extractSyndic, guessClientKind, DedupeMap, str, num, looksLikeRef } from './lib/import-helpers.js';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.resolve(here, '../../../data-import/calculs-rentabilite.xlsx');
const file = process.argv[2] ? path.resolve(process.argv[2]) : defaultFile;

type Sev = 'info' | 'warning' | 'error';
const issues: { entity: string; sheet: string; rowRef: string; severity: Sev; message: string; rawData?: unknown }[] = [];
function issue(entity: string, sheet: string, rowRef: string, severity: Sev, message: string, rawData?: unknown) {
  issues.push({ entity, sheet, rowRef, severity, message, rawData });
}

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

const syndics = new DedupeMap();
const contacts = new DedupeMap();
const people = new DedupeMap();
const worksiteByRef = new Map<string, string>(); // "R-523" -> id (existants + nouveaux)

async function preload() {
  for (const s of await prisma.syndic.findMany({ select: { id: true, name: true } })) syndics.set(s.name, s.id);
  for (const c of await prisma.contact.findMany({ select: { id: true, name: true } })) contacts.set(c.name, c.id);
  for (const p of await prisma.person.findMany({ select: { id: true, displayName: true } })) {
    if (p.displayName) people.set(p.displayName, p.id);
  }
  for (const w of await prisma.worksite.findMany({ select: { id: true, ref: true } })) {
    worksiteByRef.set(w.ref.toUpperCase(), w.id);
  }
}

async function getSyndic(name: string): Promise<string> {
  const existing = syndics.get(name);
  if (existing) return existing;
  const row = await prisma.syndic.create({ data: { name: name.trim(), normalizedName: normalizeName(name) } });
  syndics.set(name, row.id);
  bump('syndics_new');
  return row.id;
}

async function getContact(rawName: string, type: 'client' | 'supplier'): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = contacts.get(name);
  if (existing) return existing;
  const { syndic } = extractSyndic(name);
  const syndicId = syndic ? await getSyndic(syndic) : null;
  const row = await prisma.contact.create({
    data: {
      name,
      normalizedName: normalizeName(name),
      type,
      kind: type === 'client' ? guessClientKind(name) : null,
      syndicId,
      source: 'xlsx',
    },
  });
  contacts.set(name, row.id);
  bump(type === 'client' ? 'contacts_client_new' : 'contacts_supplier_new');
  return row.id;
}

async function getPerson(rawName: string, role: 'foreman' | 'worker'): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const existing = people.get(name);
  if (existing) return existing;
  const [first, ...rest] = name.split(/\s+/);
  const row = await prisma.person.create({
    data: {
      firstName: first ?? name,
      lastName: rest.join(' ') || null,
      displayName: name,
      normalizedName: normalizeName(name),
      role,
      source: 'xlsx',
    },
  });
  people.set(name, row.id);
  bump('people_new');
  return row.id;
}

// ─────────────────────────────────────────────────── Data Projets -> chantiers (ajout seul)

function readTontonRefs(sh: SheetData | undefined): Set<string> {
  const refs = new Set<string>();
  if (!sh) return refs;
  for (const row of sh.rows) {
    if (row.r < 2) continue;
    const ref = str(row.cells.A);
    if (ref) refs.add(ref.toUpperCase());
  }
  return refs;
}

async function syncWorksites(sh: SheetData, tontonRefs: Set<string>) {
  const seenInFile = new Set<string>();
  for (const row of sh.rows) {
    if (row.r < 26) continue; // lignes 2-25 = légende
    const ref = str(row.cells.A);
    if (!ref || !/^(R-|E-)/i.test(ref)) continue;
    const upperRef = ref.toUpperCase();
    const rowRef = `${sh.name}!A${row.r}`;

    if (seenInFile.has(upperRef)) {
      issue('worksite', sh.name, rowRef, 'warning', `Référence ${ref} en double dans le fichier`, { ref });
      continue;
    }
    seenInFile.add(upperRef);

    if (worksiteByRef.has(upperRef)) {
      bump('worksites_already_present');
      continue; // déjà en base (import initial ou créé depuis l'appli) — jamais touché
    }

    const title = str(row.cells.B) ?? ref;
    const managerName = str(row.cells.C);
    const address = str(row.cells.D);
    const clientName = str(row.cells.E);
    const billTo = str(row.cells.F);
    const statusRaw = str(row.cells.G);
    const attribution = (str(row.cells.H) ?? '').toLowerCase();
    const startedOn = parseLooseDate(row.cells.L);
    const endedOn = parseLooseDate(row.cells.M);
    const quoted = parseAmount(row.cells.P);
    const isOverhead = /^E-/i.test(ref);

    const entity = tontonRefs.has(upperRef) ? 'tonton' : attribution.includes('m7') ? 'm7' : 'jjd';
    const clientId = clientName ? await getContact(clientName, 'client') : null;

    let acpId: string | null = null;
    if (clientId) {
      const clientContact = await prisma.contact.findUnique({ where: { id: clientId }, select: { kind: true } });
      if (clientContact?.kind === 'acp' || clientContact?.kind === 'developer') acpId = clientId;
    }

    const managerId = managerName ? await getPerson(managerName, 'foreman') : null;

    const ws = await prisma.worksite.create({
      data: {
        ref: upperRef,
        title,
        kind: isOverhead ? 'overhead' : 'project',
        entity,
        status: isOverhead ? 'in_progress' : guessWorksiteStatus(statusRaw),
        statusRaw,
        statusTags: statusRaw ? parseStatusTags(statusRaw) : undefined,
        clientId,
        acpId,
        managerId,
        billTo,
        address,
        startedOn,
        endedOn,
        quotedHt: quoted,
        source: 'xlsx',
      },
    });
    worksiteByRef.set(upperRef, ws.id);
    bump(isOverhead ? 'worksites_overhead_new' : 'worksites_new');
    issue('worksite', sh.name, rowRef, 'info', `Nouveau chantier importé depuis Excel : ${ref}`, { ref, title });
  }
}

// ─────────────────────────────────────────────────── Facture -> grand livre (ajout seul)

/**
 * Empreinte d'une ligne du grand livre — sert à détecter si elle a déjà été importée.
 * HT/TTC arrondis au centime : les colonnes HT du fichier sont calculées par formule
 * (HT = TTC / (1+TVA)) et un simple recalcul Excel (sans aucun changement de valeur pour
 * l'utilisateur) décale le flottant de quelques ULP — comparer les floats bruts ferait
 * rater des lignes pourtant identiques et créerait de faux doublons.
 */
// +1e-6 avant l'arrondi : une valeur "pile sur .5 centime" (ex. 39.325) peut retomber
// des deux côtés du seuil selon l'ordre des opérations flottantes utilisé par Excel pour
// calculer TTC/HT — l'écart induit est de l'ordre de 1e-13, donc un epsilon 1e6 fois plus
// grand absorbe le bruit sans jamais faire basculer deux montants réellement différents
// (qui, eux, diffèrent d'au moins 1 centime).
const toCents = (n: number | null): string => {
  if (n === null) return '';
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-6)).toString();
};
function ledgerFingerprint(f: {
  date: Date | null; worksiteRef: string | null; docType: string | null; docNumber: string | null;
  ht: number | null; ttc: number | null;
}): string {
  return [
    f.date ? f.date.toISOString().slice(0, 10) : '',
    (f.worksiteRef ?? '').toUpperCase(),
    (f.docType ?? '').toLowerCase().trim(),
    (f.docNumber ?? '').trim(),
    toCents(f.ht),
    toCents(f.ttc),
  ].join('|');
}

async function loadExistingLedgerFingerprints(): Promise<Set<string>> {
  const rows = await prisma.ledgerEntry.findMany({
    select: { date: true, worksiteRef: true, docType: true, docNumber: true, ht: true, ttc: true },
  });
  return new Set(rows.map(ledgerFingerprint));
}

async function syncLedger(sh: SheetData, existing: Set<string>) {
  const newRows: Prisma.LedgerEntryCreateManyInput[] = [];
  for (const row of sh.rows) {
    if (row.r < 2) continue;
    const c = row.cells;
    const rowRef = `${sh.name}!${row.r}`;
    const typeRaw = str(c.D);
    const ref = str(c.F);
    const ht = parseAmount(c.J);
    const ttc = parseAmount(c.M);
    if (!typeRaw && ht === null && ttc === null) continue;

    const date = parseLooseDate(c.A);
    const docNumber = str(c.E);
    // même normalisation qu'à l'écriture ci-dessous (ht ?? 0) — sinon une ligne sans HT
    // (ht=null ici, stocké 0 en base) ne matcherait jamais son empreinte déjà existante.
    const fp = ledgerFingerprint({ date, worksiteRef: ref, docType: typeRaw, docNumber, ht: ht ?? 0, ttc });
    if (existing.has(fp)) {
      bump('ledger_already_present');
      continue; // déjà importée — jamais modifiée
    }
    existing.add(fp); // évite un doublon si la même ligne apparaît 2x dans ce même run

    const t = (typeRaw ?? '').toLowerCase().trim();
    const direction = t.includes('note de crédit') || t.includes('note de credit')
      ? 'credit_note'
      : t === 'facture de vente'
        ? 'sale'
        : 'purchase';

    let worksiteId: string | null = null;
    if (looksLikeRef(ref)) {
      worksiteId = worksiteByRef.get(ref!.toUpperCase()) ?? null;
      if (!worksiteId) issue('ledger', sh.name, rowRef, 'info', `Écriture sur réf inconnue ${ref}`, { ref, ht, typeRaw });
    }
    const supplierName = str(c.H);
    const contactId = supplierName && direction === 'purchase' ? await getContact(supplierName, 'supplier') : null;

    newRows.push({
      date,
      year: num(c.B),
      month: str(c.C),
      direction,
      docType: typeRaw,
      docNumber,
      worksiteRef: ref,
      worksiteId,
      supplierName,
      contactId,
      categoryRaw: str(c.I),
      ht: ht ?? 0,
      vatRecup: parseAmount(c.K),
      vatDue: parseAmount(c.L),
      ttc,
      vatRate: num(c.P),
      quarter: str(c.Q),
      paymentStatus: str(c.R),
      bankComm: str(c.S),
      source: 'xlsx',
    });
    bump('ledger_new');
    issue('ledger', sh.name, rowRef, 'info', `Nouvelle écriture importée depuis Excel${ref ? ` (${ref})` : ''}`, { ref, typeRaw, ht, ttc });
  }
  for (let i = 0; i < newRows.length; i += 500) {
    await prisma.ledgerEntry.createMany({ data: newRows.slice(i, i + 500) });
  }
}

// ─────────────────────────────────────────────────────── run

async function main() {
  console.log(`Sync depuis ${file}`);
  const sheets = readXlsx(file);
  const byName = (n: string) => sheets.find((s) => s.name.trim().toLowerCase() === n.toLowerCase());

  await preload();
  const batch = await prisma.importBatch.create({ data: { source: 'xlsx-sync', label: path.basename(file) } });

  const dataProjets = byName('Data Projets');
  if (!dataProjets) throw new Error('Feuille « Data Projets » introuvable');
  const tontonRefs = readTontonRefs(byName('Calculs Tonton'));
  await syncWorksites(dataProjets, tontonRefs);
  console.log('  chantiers  ', stats.worksites_new ?? 0, 'nouveau(x) (+', stats.worksites_overhead_new ?? 0, 'frais généraux) —',
    stats.worksites_already_present ?? 0, 'déjà en base, inchangés');

  // le compteur R- ne doit jamais reculer
  let maxRef = 0;
  for (const ref of worksiteByRef.keys()) {
    const m = ref.match(/^R-(\d+)$/i);
    if (m) maxRef = Math.max(maxRef, Number(m[1]));
  }
  const counter = await prisma.counter.findUnique({ where: { name: 'worksite' } });
  if (!counter || counter.value < maxRef) {
    await prisma.counter.upsert({
      where: { name: 'worksite' },
      create: { name: 'worksite', value: maxRef },
      update: { value: maxRef },
    });
  }

  const facture = byName('Facture');
  if (facture) {
    const existingFingerprints = await loadExistingLedgerFingerprints();
    await syncLedger(facture, existingFingerprints);
  }
  console.log('  grand livre', stats.ledger_new ?? 0, 'nouvelle(s) écriture(s) —', stats.ledger_already_present ?? 0, 'déjà en base, inchangées');

  for (let i = 0; i < issues.length; i += 200) {
    await prisma.importIssue.createMany({
      data: issues.slice(i, i + 200).map((x) => ({
        batchId: batch.id,
        entity: x.entity,
        sheet: x.sheet,
        rowRef: x.rowRef,
        severity: x.severity,
        message: x.message,
        rawData: x.rawData === undefined ? undefined : (x.rawData as object),
      })),
    });
  }

  const bySeverity = issues.reduce<Record<string, number>>((a, x) => ((a[x.severity] = (a[x.severity] ?? 0) + 1), a), {});
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { finishedAt: new Date(), stats: { ...stats, issues: bySeverity } },
  });

  console.log('\nNouveaux contacts :', (stats.contacts_client_new ?? 0) + (stats.contacts_supplier_new ?? 0),
    `(${stats.contacts_client_new ?? 0} clients, ${stats.contacts_supplier_new ?? 0} fournisseurs)`);
  console.log('Nouveaux syndics  :', stats.syndics_new ?? 0);
  console.log('Nouvelles personnes :', stats.people_new ?? 0);
  console.log('\n-> visibles dans /api/imports/issues (interface bureau)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
