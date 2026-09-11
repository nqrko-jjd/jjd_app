/**
 * Import additif des notes de crédit (et factures isolées) depuis un export TrustUp
 * déposé après coup — contrairement à `import-trustup.ts`, ce script n'efface RIEN :
 * il ne fait qu'ajouter/mettre à jour (upsert sur kind+number), donc sûr à relancer
 * sans perdre les devis/factures déjà importés.
 *
 *   npm run import:credit-notes -- data-import/credit-note-.../xxxx.csv
 *   npm run import:credit-notes             (détecte tout seul les CSV dans un dossier
 *                                             data-import/credit-note-* / *credit-note*)
 *
 * Le type de chaque ligne est déduit du préfixe de son numéro (NC… -> note de crédit,
 * F… -> facture, D… -> devis), pas du nom de fichier — un même export peut mélanger
 * les deux (cf. l'export du 2026-09-11, une NC et une facture dans le même CSV).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseLooseDate, parseAmount, normalizeName } from '@jjd/shared';
import { readTable, pick, type TableRow } from '../src/lib/table-io.js';
import { readXlsx } from '../src/lib/xlsx-read.js';

// Helpers dupliqués (pas importés) depuis import-trustup.ts : ce script doit rester
// totalement indépendant de ce fichier, qui exécute un `main()` destructeur (deleteMany)
// au chargement du module — l'importer, même juste pour ses fonctions, le déclencherait.
const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../data-import');
const pdfOutDir = path.resolve(here, '../uploads/documents');

function copyOriginalPdf(csvFile: string, number: string): string | null {
  const src = path.join(path.dirname(csvFile), 'documents', `${number}.pdf`);
  if (!existsSync(src)) return null;
  mkdirSync(pdfOutDir, { recursive: true });
  const name = `${number}.pdf`;
  try {
    copyFileSync(src, path.join(pdfOutDir, name));
    return name;
  } catch {
    return null;
  }
}

/** number (F2024090040 / D2024...) -> réf chantier (R-xxx), depuis le fichier Excel. */
function buildDocToWorksite(): Map<string, string> {
  const map = new Map<string, string>();
  const xlsx = path.join(dataDir, 'calculs-rentabilite.xlsx');
  if (!existsSync(xlsx)) return map;
  const sheets = readXlsx(xlsx);

  const dp = sheets.find((s) => s.name.trim().toLowerCase() === 'data projets');
  for (const row of dp?.rows ?? []) {
    if (row.r < 26) continue;
    const ref = String(row.cells.A ?? '').trim().toUpperCase();
    if (!/^R-\d/.test(ref)) continue;
    for (const m of String(row.cells.J ?? '').matchAll(/[FD]\s?\d[\w-]*/g)) {
      map.set(m[0].replace(/\s/g, '').toUpperCase(), ref);
    }
  }

  const rd = sheets.find((s) => s.name.trim().toLowerCase() === 'relance devis');
  for (const row of rd?.rows ?? []) {
    if (row.r < 2) continue;
    const num = String(row.cells.C ?? '').replace(/\s/g, '').toUpperCase();
    const ref = String(row.cells.D ?? '').trim().toUpperCase();
    if (/^D\d|^D-/.test(num) && /^R-\d/.test(ref)) map.set(num, ref);
  }

  return map;
}

const syndicCache = new Map<string, string>();
async function getSyndic(rawName: string): Promise<string> {
  const nn = normalizeName(rawName);
  if (syndicCache.has(nn)) return syndicCache.get(nn)!;
  let s = await prisma.syndic.findFirst({ where: { normalizedName: nn } });
  if (!s) s = await prisma.syndic.create({ data: { name: rawName.trim(), normalizedName: nn } });
  syndicCache.set(nn, s.id);
  return s.id;
}

/** « ACP Iris (c/o Baltimo) » -> base « ACP Iris », syndic « Baltimo ». */
function splitSyndic(name: string): { base: string; syndic: string | null } {
  const m = name.match(/^(.*?)[\s(–-]*c\/o\s+([^)]+?)\)?\s*$/i);
  if (m) return { base: m[1]!.replace(/[\s(–-]+$/, '').trim(), syndic: m[2]!.trim() };
  return { base: name.trim(), syndic: null };
}

async function contactFor(name: string | null, vat: string | null): Promise<string | null> {
  if (!name) return null;
  const nn = normalizeName(name);
  let c = await prisma.contact.findFirst({ where: { normalizedName: nn } });
  const { base, syndic } = splitSyndic(name);
  const syndicId = syndic ? await getSyndic(syndic) : null;
  const kind = /\bacp\b|copropri|\bvme\b/i.test(name) ? 'acp' : /\b(srl|sprl|sa|nv|bv|scrl)\b/i.test(name) ? 'company' : 'individual';

  if (!c) {
    c = await prisma.contact.create({
      data: { name: name.trim(), normalizedName: nn, type: 'client', kind, vat: vat || null, syndicId, source: 'trustup' },
    });
  } else {
    const patch: Record<string, unknown> = {};
    if (vat && !c.vat) patch.vat = vat;
    if (syndicId && !c.syndicId) patch.syndicId = syndicId;
    if (Object.keys(patch).length) await prisma.contact.update({ where: { id: c.id }, data: patch });
  }

  if (kind === 'acp' && syndicId) {
    const bn = normalizeName(base || name);
    const existing = await prisma.building.findFirst({ where: { normalizedName: bn } });
    if (!existing) {
      await prisma.building.create({
        data: { name: base || name, normalizedName: bn, syndicId, clientId: c.id, source: 'trustup' },
      });
    } else if (!existing.syndicId) {
      await prisma.building.update({ where: { id: existing.id }, data: { syndicId, clientId: c.id } });
    }
  }
  return c.id;
}

function findCsvs(): string[] {
  const args = process.argv.slice(2);
  if (args.length) return args.map((f) => path.resolve(f));
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.csv') && /credit.?note/i.test(dir)) out.push(p);
    }
  };
  walk(dataDir, 0);
  return out;
}

const STATUS_MAP: Record<string, string> = {
  draft: 'draft', sent: 'sent', paid: 'paid', overdue: 'overdue', cancelled: 'credited',
  partially_paid: 'partial', accepted: 'accepted', rejected: 'declined', declined: 'declined', expired: 'expired',
};

function kindFor(number: string): 'credit_note' | 'invoice' | 'quote' {
  if (/^NC/i.test(number)) return 'credit_note';
  if (/^F/i.test(number)) return 'invoice';
  return 'quote';
}

async function importFile(file: string, docToWs: Map<string, string>, wsByRef: Map<string, string>) {
  const rows = readTable(file);
  const counts: Record<string, number> = {};
  let noWs = 0;

  for (const r of rows as TableRow[]) {
    const number = pick(r, 'number');
    if (!number) continue;
    const kind = kindFor(number);
    const key = number.replace(/\s/g, '').toUpperCase();

    let wsId = docToWs.get(key) ? wsByRef.get(docToWs.get(key)!) ?? null : null;
    if (!wsId) {
      const m = (pick(r, 'title') ?? '').match(/\bR-\s?\d+/i) ?? (pick(r, 'description') ?? '').match(/\bR-\s?\d+/i);
      if (m) wsId = wsByRef.get(m[0].replace(/\s/g, '').toUpperCase()) ?? null;
    }
    if (!wsId) noWs++;

    const contactId = await contactFor(pick(r, 'client'), pick(r, 'client_vat_number'));
    const ht = parseAmount(pick(r, 'subtotal')) ?? 0;
    const tax = parseAmount(pick(r, 'total_tax')) ?? 0;
    const ttc = parseAmount(pick(r, 'total')) ?? ht + tax;
    const paid = parseAmount(pick(r, 'total_paid')) ?? 0;
    const originalPdf = copyOriginalPdf(file, number);

    await prisma.document.upsert({
      where: { kind_number: { kind, number } },
      create: {
        kind,
        originalPdf,
        number,
        direction: 'sale',
        status: STATUS_MAP[(pick(r, 'status') ?? '').toLowerCase()] ?? 'draft',
        worksiteId: wsId,
        contactId,
        title: pick(r, 'title'),
        issuedOn: parseLooseDate(pick(r, 'sent_at')),
        dueOn: parseLooseDate(pick(r, 'due_at')),
        lockedAt: parseLooseDate(pick(r, 'sent_at')) ?? new Date(2024, 0, 1),
        totalHt: ht,
        totalVat: tax,
        totalTtc: ttc,
        paidAmount: paid,
        paidOn: paid > 0 ? parseLooseDate(pick(r, 'due_at')) : null,
        trustupId: pick(r, 'id'),
        source: 'trustup',
      },
      update: {
        status: STATUS_MAP[(pick(r, 'status') ?? '').toLowerCase()] ?? 'draft',
        worksiteId: wsId,
        contactId,
        totalHt: ht,
        totalVat: tax,
        totalTtc: ttc,
        paidAmount: paid,
        originalPdf: originalPdf ?? undefined,
      },
    });
    counts[kind] = (counts[kind] ?? 0) + 1;

    if (wsId && contactId) {
      const ws = await prisma.worksite.findUnique({ where: { id: wsId }, select: { clientId: true, buildingId: true } });
      const patch: Record<string, unknown> = {};
      if (!ws?.clientId) patch.clientId = contactId;
      if (!ws?.buildingId) {
        const b = await prisma.building.findFirst({ where: { clientId: contactId } });
        if (b) patch.buildingId = b.id;
      }
      if (Object.keys(patch).length) await prisma.worksite.update({ where: { id: wsId }, data: patch });
    }
  }
  return { counts, noWs, total: rows.length };
}

async function main() {
  const files = findCsvs();
  if (!files.length) {
    console.error('Aucun CSV trouvé. Dépose l\'export dans un dossier data-import/credit-note-… ou passe le chemin en argument.');
    process.exit(1);
  }
  console.log('Import notes de crédit —', files.map((f) => path.basename(f)).join(', '));

  const docToWs = buildDocToWorksite();
  const worksites = await prisma.worksite.findMany({ select: { id: true, ref: true } });
  const wsByRef = new Map(worksites.map((w) => [w.ref.toUpperCase(), w.id]));

  for (const f of files) {
    const r = await importFile(f, docToWs, wsByRef);
    const byKind = Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(', ');
    console.log(`  ${path.basename(f)} : ${byKind} sur ${r.total} lignes (${r.noWs} sans chantier retrouvé)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
