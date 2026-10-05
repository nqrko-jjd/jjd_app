import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { syncLedgerEntryForDocument } from '../src/lib/documents.js';
import { normalizeName } from '@jjd/shared';

const contacts: string[] = [];
const docs: string[] = [];
const numbers: string[] = [];
const mkDoc = async (number: string, total: number, extra: Record<string, unknown> = {}) => {
  const c = await prisma.contact.create({ data: { name: `Client ${number}`, normalizedName: normalizeName(`Client ${number}`), type: 'client' } });
  contacts.push(c.id);
  numbers.push(number);
  const d = await prisma.document.create({
    data: { kind: 'invoice', direction: 'sale', status: 'sent', number, contactId: c.id, issuedOn: new Date('2024-07-24'), lockedAt: new Date('2024-07-24'), totalHt: total / 1.06, totalVat: total - total / 1.06, totalTtc: total, source: 'legacy', ...extra },
  });
  docs.push(d.id);
  return d;
};
const mkXlsx = (docNumber: string, ttc: number, extra: Record<string, unknown> = {}) =>
  prisma.ledgerEntry.create({ data: { direction: 'sale', docNumber, ttc, ht: ttc / 1.06, source: 'xlsx', paymentStatus: 'Payé', ...extra } });

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ documentId: { in: docs } }, { docNumber: { in: numbers } }] } });
  await prisma.document.deleteMany({ where: { id: { in: docs } } });
  await prisma.contact.deleteMany({ where: { id: { in: contacts } } });
});

test('facture déjà au grand livre (Excel) et de même montant : l\'écriture est adoptée, jamais dupliquée', async () => {
  const wk = await prisma.worksite.create({ data: { ref: 'TW-TEST-1', title: 'Chantier twin 1' } });
  const x = await mkXlsx('FTWIN-001', 2522.8, { worksiteId: wk.id, worksiteRef: 'TW-TEST-1' });
  const d = await mkDoc('FTWIN-001', 2522.8);
  await syncLedgerEntryForDocument(d.id);
  const rows = await prisma.ledgerEntry.findMany({ where: { docNumber: 'FTWIN-001' } });
  assert.equal(rows.length, 1, 'une seule écriture pour cette facture');
  assert.equal(rows[0]!.id, x.id);
  assert.equal(rows[0]!.documentId, d.id);
  assert.equal(rows[0]!.worksiteId, wk.id, 'le chantier de l\'écriture reprise est conservé (le document n\'en a pas)');
  await prisma.ledgerEntry.deleteMany({ where: { docNumber: 'FTWIN-001' } });
  await prisma.worksite.delete({ where: { id: wk.id } });
});

test('facture déjà au grand livre mais montant différent : aucune 2e écriture, l\'historique fait foi', async () => {
  const x = await mkXlsx('FTWIN-002', 1165.74);
  const d = await mkDoc('FTWIN-002', 0);
  await syncLedgerEntryForDocument(d.id);
  const rows = await prisma.ledgerEntry.findMany({ where: { docNumber: 'FTWIN-002' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, x.id);
  assert.equal(rows[0]!.documentId, null);
  assert.equal(rows[0]!.ttc, 1165.74);
});

test('facture nouvelle (aucune écriture historique) : l\'écriture synchronisée est créée normalement', async () => {
  const d = await mkDoc('FTWIN-003', 500, { source: 'app' });
  await syncLedgerEntryForDocument(d.id);
  const rows = await prisma.ledgerEntry.findMany({ where: { docNumber: 'FTWIN-003' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.source, 'document-sync');
  assert.equal(rows[0]!.documentId, d.id);
});

test('deux écritures historiques portent ce numéro (chantiers différents) : on n\'en crée pas une troisième', async () => {
  await mkXlsx('FTWIN-004', 295);
  await mkXlsx('FTWIN-004', 375);
  const d = await mkDoc('FTWIN-004', 670);
  await syncLedgerEntryForDocument(d.id);
  assert.equal(await prisma.ledgerEntry.count({ where: { docNumber: 'FTWIN-004' } }), 2);
});
