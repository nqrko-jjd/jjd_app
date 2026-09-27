import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { NON_INVOICE_ATTACHMENT_RE, findExistingMatch } from '../src/lib/invoice-mailbox.js';

test('NON_INVOICE_ATTACHMENT_RE : reconnaît les conditions générales, pas une vraie facture', () => {
  assert.ok(NON_INVOICE_ATTACHMENT_RE.test('Algemene voorwaarden - Conditions générales.pdf'));
  assert.ok(NON_INVOICE_ATTACHMENT_RE.test('CGV.pdf'));
  assert.ok(NON_INVOICE_ATTACHMENT_RE.test('Terms and Conditions.pdf'));
  assert.equal(NON_INVOICE_ATTACHMENT_RE.test('202608297.pdf'), false);
  assert.equal(NON_INVOICE_ATTACHMENT_RE.test('facture_262946.pdf'), false);
});

let entryId = '';

before(async () => {
  const e = await prisma.ledgerEntry.create({
    data: {
      direction: 'purchase', docType: "Facture d'achat", docNumber: 'MBX-TEST-1',
      date: new Date('2026-09-20'), ht: 100, ttc: 121, source: 'email', paymentStatus: 'Non payé',
      supplierName: 'Vanlaethem Containers',
    },
  });
  entryId = e.id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { id: entryId } });
});

test('findExistingMatch : retrouve une facture déjà importée par n° de document (relecture après échec d’une autre pièce jointe du même mail)', async () => {
  const byDoc = await findExistingMatch({
    kind: 'invoice', issuedOn: null, dueOn: null, docNumber: 'MBX-TEST-1', totalHt: null, totalVat: null, totalTtc: null,
    vatRate: null, vatNumbersFound: [], contactId: null, contactName: null, contactConfidence: null,
    worksiteId: null, worksiteRef: null, otherWorksiteRefs: [], textExtracted: true,
  });
  assert.equal(byDoc, entryId);

  const byAmount = await findExistingMatch({
    kind: 'invoice', issuedOn: '2026-09-21', dueOn: null, docNumber: null, totalHt: null, totalVat: null, totalTtc: 121,
    vatRate: null, vatNumbersFound: [], contactId: null, contactName: null, contactConfidence: null,
    worksiteId: null, worksiteRef: null, otherWorksiteRefs: [], textExtracted: true,
  });
  assert.equal(byAmount, entryId, 'montant proche (±2c) et date proche (±5j), sans n° de document');

  const noMatch = await findExistingMatch({
    kind: 'invoice', issuedOn: null, dueOn: null, docNumber: 'AUTRE-REF', totalHt: null, totalVat: null, totalTtc: 999,
    vatRate: null, vatNumbersFound: [], contactId: null, contactName: null, contactConfidence: null,
    worksiteId: null, worksiteRef: null, otherWorksiteRefs: [], textExtracted: true,
  });
  assert.equal(noMatch, null);
});
