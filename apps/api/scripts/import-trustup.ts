/**
 * Import des DEVIS et FACTURES depuis l'export TrustUp.
 * (Le reste — contacts, chantiers, pointage… — vient de l'Excel, plus complet.)
 *
 *   npm run import:trustup -- data-import/invoice-.../xxxx.csv data-import/quote-.../yyyy.csv
 *   npm run import:trustup                 (détecte tout seul les CSV dans data-import/)
 *
 * Rattachement au chantier : via la colonne « N° Facture » de l'onglet
 * Data Projets du fichier de rentabilité (numéro F/D -> réf R-).
 * Le client (ACP, syndic, n° TVA) est créé / enrichi au passage.
 * Idempotent : remplace les Document de source "trustup".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { parseLooseDate, parseAmount, normalizeName } from '@jjd/shared';
import { readTable, pick, type TableRow } from './lib/table-read.js';
import { readXlsx } from './lib/xlsx-read.js';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../../data-import');
const pdfOutDir = path.resolve(here, '../uploads/documents');

/**
 * Copie le PDF TrustUp d'origine (dossier « documents/ » à côté du CSV) vers
 * uploads/documents/<numéro>.pdf. Renvoie le nom de fichier, ou null.
 */
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

function findCsvs(): string[] {
  const args = process.argv.slice(2);
  if (args.length) return args.map((f) => path.resolve(f));
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.csv') && /invoice|quote|facture|devis/i.test(p)) out.push(p);
    }
  };
  walk(dataDir, 0);
  return out;
}

const INVOICE_STATUS: Record<string, string> = {
  draft: 'draft', sent: 'sent', paid: 'paid', overdue: 'overdue', cancelled: 'credited',
  partially_paid: 'partial',
};
const QUOTE_STATUS: Record<string, string> = {
  draft: 'draft', sent: 'sent', accepted: 'accepted', rejected: 'declined', declined: 'declined',
  expired: 'expired',
};

/** number (F2024090040 / D2024...) -> réf chantier (R-xxx), depuis le fichier Excel. */
function buildDocToWorksite(): Map<string, string> {
  const map = new Map<string, string>();
  const xlsx = path.join(dataDir, 'calculs-rentabilite.xlsx');
  if (!existsSync(xlsx)) return map;
  const sheets = readXlsx(xlsx);

  // Data Projets : col A = réf, col J = numéros de facture (multi-lignes)
  const dp = sheets.find((s) => s.name.trim().toLowerCase() === 'data projets');
  for (const row of dp?.rows ?? []) {
    if (row.r < 26) continue;
    const ref = String(row.cells.A ?? '').trim().toUpperCase();
    if (!/^R-\d/.test(ref)) continue;
    for (const m of String(row.cells.J ?? '').matchAll(/[FD]\s?\d[\w-]*/g)) {
      map.set(m[0].replace(/\s/g, '').toUpperCase(), ref);
    }
  }

  // Relance Devis : col C = n° devis, col D = réf chantier
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

  // un ACP avec syndic -> aussi un immeuble rattaché à ce syndic
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

async function importFile(file: string, docToWs: Map<string, string>, wsByRef: Map<string, string>) {
  const rows = readTable(file);
  if (!rows.length) return { kind: '?', ok: 0, noWs: 0 };
  const isInvoice = /invoice|facture/i.test(file) || rows.some((r) => /^F/i.test(pick(r, 'number') ?? ''));
  const kind = isInvoice ? 'invoice' : 'quote';
  const statusMap = isInvoice ? INVOICE_STATUS : QUOTE_STATUS;

  let ok = 0;
  let noWs = 0;
  for (const r of rows as TableRow[]) {
    const number = pick(r, 'number');
    if (!number) continue;
    const key = number.replace(/\s/g, '').toUpperCase();

    let wsId = docToWs.get(key) ? wsByRef.get(docToWs.get(key)!) ?? null : null;
    if (!wsId) {
      // parfois le n° apparaît dans le titre
      const m = (pick(r, 'title') ?? '').match(/\bR-\s?\d+/i);
      if (m) wsId = wsByRef.get(m[0].replace(/\s/g, '').toUpperCase()) ?? null;
    }
    if (!wsId) noWs++;

    const contactId = await contactFor(pick(r, 'client'), pick(r, 'client_vat_number'));
    const ht = parseAmount(pick(r, 'subtotal')) ?? 0;
    const tax = parseAmount(pick(r, 'total_tax')) ?? 0;
    const ttc = parseAmount(pick(r, 'total')) ?? ht + tax;
    const paid = parseAmount(pick(r, 'total_paid')) ?? 0;
    const peppol = pick(r, 'peppol_status');
    const originalPdf = copyOriginalPdf(file, number);

    await prisma.document.upsert({
      where: { kind_number: { kind, number } },
      create: {
        kind,
        originalPdf,
        number,
        direction: 'sale',
        status: statusMap[(pick(r, 'status') ?? '').toLowerCase()] ?? 'draft',
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
        note: peppol && peppol !== '' ? `Peppol: ${peppol}` : null,
        trustupId: pick(r, 'id'),
        source: 'trustup',
      },
      update: {
        status: statusMap[(pick(r, 'status') ?? '').toLowerCase()] ?? 'draft',
        worksiteId: wsId,
        contactId,
        totalHt: ht,
        totalVat: tax,
        totalTtc: ttc,
        paidAmount: paid,
        originalPdf: originalPdf ?? undefined,
      },
    });
    ok++;

    // rattache le chantier à son client / immeuble via le document
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
  return { kind, ok, noWs };
}

async function main() {
  const files = findCsvs();
  if (!files.length) {
    console.error('Aucun CSV trouvé. Dépose les exports TrustUp dans data-import/ ou passe les chemins en argument.');
    process.exit(1);
  }
  console.log('Import TrustUp —', files.map((f) => path.basename(f)).join(', '));

  await prisma.document.deleteMany({ where: { source: 'trustup' } });
  await prisma.building.deleteMany({ where: { source: 'trustup', worksites: { none: {} } } });
  const docToWs = buildDocToWorksite();
  console.log(`  ${docToWs.size} numéros de document reliés à un chantier (via l'Excel)`);
  const worksites = await prisma.worksite.findMany({ select: { id: true, ref: true } });
  const wsByRef = new Map(worksites.map((w) => [w.ref.toUpperCase(), w.id]));

  for (const f of files) {
    const r = await importFile(f, docToWs, wsByRef);
    console.log(`  ${path.basename(f)} : ${r.ok} ${r.kind === 'invoice' ? 'factures' : 'devis'} (${r.noWs} sans chantier)`);
  }

  const byKind = await prisma.document.groupBy({ by: ['kind'], where: { source: 'trustup' }, _count: true });
  const linked = await prisma.document.count({ where: { source: 'trustup', worksiteId: { not: null } } });
  const total = await prisma.document.count({ where: { source: 'trustup' } });
  console.log(`\nTotal : ${byKind.map((c) => `${c._count} ${c.kind}`).join(', ')} — ${linked}/${total} rattachés à un chantier`);

  await seedPortalDemo();
}

/** Comptes de démo du portail client — créés après tous les imports. */
async function seedPortalDemo() {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@portail.demo' } } });
  const pw = await bcrypt.hash('demo', 10);

  const syndic = await prisma.syndic.findFirst({ orderBy: { buildings: { _count: 'desc' } } });
  if (syndic) {
    await prisma.user.create({ data: { email: 'syndic@portail.demo', passwordHash: pw, role: 'client', syndicId: syndic.id } });
    // rend le tableau de bord démo vivant : quelques interventions "en cours" + priorités
    const ws = await prisma.worksite.findMany({
      where: { building: { syndicId: syndic.id } },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true },
    });
    const demo: { status?: string; priority?: string }[] = [
      { status: 'in_progress', priority: 'urgent' },
      { status: 'scheduled', priority: 'high' },
      { status: 'in_progress' },
      { status: 'to_invoice' },
      { status: 'done' },
      { status: 'scheduled' },
    ];
    for (let i = 0; i < ws.length; i++) {
      await prisma.worksite.update({ where: { id: ws[i]!.id }, data: demo[i] ?? {} });
    }
    // accès résident limité (voit suivi/photos/messages d'un seul immeuble)
    const oneBuilding = await prisma.building.findFirst({ where: { syndicId: syndic.id }, orderBy: { worksites: { _count: 'desc' } } });
    if (oneBuilding) {
      await prisma.user.create({
        data: { email: 'resident@portail.demo', passwordHash: pw, role: 'client', buildingId: oneBuilding.id, portalAccess: 'limited' },
      });
    }
  }
  const client = await prisma.contact.findFirst({
    where: { type: { in: ['client', 'both'] }, kind: 'individual', worksites: { some: { documents: { some: {} } } } },
    orderBy: { worksites: { _count: 'desc' } },
  });
  if (client) {
    await prisma.user.create({ data: { email: 'client@portail.demo', passwordHash: pw, role: 'client', contactId: client.id } });
  }
  console.log(`Portail démo : syndic@portail.demo (${syndic?.name ?? '—'}) · client@portail.demo (${client?.name ?? '—'})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
