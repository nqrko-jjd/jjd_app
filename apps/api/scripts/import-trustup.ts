/**
 * Import des DEVIS et FACTURES depuis un export TrustUp.
 * (Le reste — contacts, chantiers, pointage… — vient de l'Excel, plus complet.)
 *
 *   npm run import:trustup -- data-import/trustup-devis.xlsx
 *   npm run import:trustup -- data-import/trustup-factures.csv
 *
 * Accepte .xlsx / .csv / .tsv. Détecte devis vs factures d'après les colonnes.
 * Idempotent : remplace les Document de source "trustup".
 * Rattache au chantier par le numéro R- ; crée/enrichit le Contact client.
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { parseLooseDate, parseAmount, normalizeName } from '@jjd/shared';
import { readTable, pick, type TableRow } from './lib/table-read.js';

const prisma = new PrismaClient();
const files = process.argv.slice(2).map((f) => path.resolve(f));
if (files.length === 0) {
  console.error('Usage : npm run import:trustup -- <fichier.xlsx|csv> [autre.csv ...]');
  process.exit(1);
}

const R_RE = /\bR-\s?\d+/i;

function detectKind(rows: TableRow[]): 'quote' | 'invoice' {
  const sample = rows.slice(0, 20);
  const hasQuoteNo = sample.some((r) => /^D\d|^D-/.test(pick(r, 'numero', 'numero devis', 'numero du devis') ?? ''));
  const hasInvoiceNo = sample.some((r) => /^F\d|^F-/.test(pick(r, 'numero', 'numero facture', 'numero de facture') ?? ''));
  if (hasInvoiceNo && !hasQuoteNo) return 'invoice';
  if (hasQuoteNo && !hasInvoiceNo) return 'quote';
  // repli : présence d'une colonne d'échéance de paiement => facture
  return sample.some((r) => pick(r, 'date d echeance', 'echeance', 'date de paiement')) ? 'invoice' : 'quote';
}

const QUOTE_STATUS: Record<string, string> = {
  brouillon: 'draft', envoye: 'sent', accepte: 'accepted',
  decline: 'declined', refuse: 'declined', expire: 'expired',
};
const INVOICE_STATUS: Record<string, string> = {
  brouillon: 'draft', envoye: 'sent', paye: 'paid', 'partiellement paye': 'partial',
  'en retard': 'overdue', 'note de credit': 'credited',
};

async function contactFor(name: string | null, vat: string | null): Promise<string | null> {
  if (!name) return null;
  const nn = normalizeName(name);
  let c = await prisma.contact.findFirst({ where: { normalizedName: nn } });
  if (!c) {
    c = await prisma.contact.create({
      data: { name: name.trim(), normalizedName: nn, type: 'client', vat: vat ?? undefined, source: 'trustup' },
    });
  } else if (vat && !c.vat) {
    await prisma.contact.update({ where: { id: c.id }, data: { vat } });
  }
  return c.id;
}

async function importFile(file: string) {
  const rows = readTable(file);
  if (rows.length === 0) {
    console.log(`  ${path.basename(file)} : vide ou illisible`);
    return;
  }
  const kind = detectKind(rows);
  console.log(`  ${path.basename(file)} : ${rows.length} lignes -> ${kind === 'quote' ? 'devis' : 'factures'}`);
  console.log(`    colonnes : ${Object.keys(rows[0]!).join(', ')}`);

  const worksites = await prisma.worksite.findMany({ select: { id: true, ref: true } });
  const wsByRef = new Map(worksites.map((w) => [w.ref.toUpperCase().replace(/\s/g, ''), w.id]));

  let ok = 0;
  let noWs = 0;
  for (const r of rows) {
    const number = pick(r, 'numero', 'numero devis', 'numero facture', 'n devis', 'n facture', 'reference');
    if (!number) continue;

    const titleCol = pick(r, 'titre chantier', 'titre', 'objet', 'chantier', 'description') ?? '';
    const refMatch = (`${titleCol} ${pick(r, 'chantier', 'projet') ?? ''}`).match(R_RE);
    const wsId = refMatch ? wsByRef.get(refMatch[0].toUpperCase().replace(/\s/g, '')) ?? null : null;
    if (!wsId) noWs++;

    const clientName = pick(r, 'contact', 'client', 'nom du client', 'nom client');
    const vat = pick(r, 'numero de tva', 'tva', 'numero tva', 'vat');
    const contactId = await contactFor(clientName, vat);

    const statusRaw = normalizeName(pick(r, 'statut', 'status', 'etat') ?? '');
    const status = (kind === 'quote' ? QUOTE_STATUS : INVOICE_STATUS)[statusRaw] ?? 'draft';

    const ht = parseAmount(pick(r, 'montant htva', 'total htva', 'montant ht', 'total ht', 'htva'));
    const ttc = parseAmount(pick(r, 'montant ttc', 'total ttc', 'total', 'montant', 'ttc'));
    const vatAmt = parseAmount(pick(r, 'tva', 'montant tva'));

    await prisma.document.upsert({
      where: { kind_number: { kind, number } },
      create: {
        kind, number, direction: 'sale', status,
        worksiteId: wsId, contactId,
        title: titleCol || null,
        issuedOn: parseLooseDate(pick(r, 'date', 'date du devis', 'date de la facture', 'date facture')),
        dueOn: parseLooseDate(pick(r, 'echeance', 'date d echeance', 'date de paiement')),
        totalHt: ht ?? (ttc ? ttc / 1.21 : 0),
        totalVat: vatAmt ?? 0,
        totalTtc: ttc ?? (ht ? ht * 1.21 : 0),
        paidAmount: status === 'paid' ? ttc ?? ht ?? 0 : parseAmount(pick(r, 'montant paye', 'paye')) ?? 0,
        source: 'trustup',
      },
      update: {
        status, worksiteId: wsId, contactId, title: titleCol || null,
        totalHt: ht ?? undefined, totalTtc: ttc ?? undefined,
      },
    });
    ok++;
  }
  console.log(`    -> ${ok} documents (${noWs} sans chantier rattaché)`);
}

async function main() {
  console.log('Import TrustUp (devis + factures)');
  await prisma.document.deleteMany({ where: { source: 'trustup' } });
  for (const f of files) await importFile(f);
  const counts = await prisma.document.groupBy({ by: ['kind'], where: { source: 'trustup' }, _count: true });
  console.log('\nTotal :', counts.map((c) => `${c._count} ${c.kind}`).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
