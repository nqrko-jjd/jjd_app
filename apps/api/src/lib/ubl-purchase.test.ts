import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPurchaseUbl, purchaseAmounts } from './ubl-purchase.js';

test('facture d’achat en UBL avec PDF joint', () => {
  const x = buildPurchaseUbl({
    kind: 'invoice', number: '194-164521', issueDate: new Date('2026-10-09'), dueDate: new Date('2026-11-30'),
    supplier: { name: 'B+M Baustoff+Metall Belgium SA', vat: 'BE 0820.878.732', city: 'Ans', postalCode: '4430' },
    customer: { name: 'JJD Consult SRL', vat: 'BE1003823997' },
    ht: 358.42, vatRate: 0.21, vat: 75.27, description: 'Facture 194-164521', pdf: { filename: 'f.pdf', bytes: new TextEncoder().encode('%PDF-1.4') },
  });
  assert.match(x, /<cbc:ID>194-164521<\/cbc:ID>/);
  assert.match(x, /<cbc:CompanyID>BE0820878732<\/cbc:CompanyID>/);
  assert.match(x, /<cbc:PayableAmount currencyID="EUR">433.69<\/cbc:PayableAmount>/);
  assert.match(x, /<cbc:Percent>21<\/cbc:Percent>/);
  assert.match(x, /mimeCode="application\/pdf"/);
  assert.match(x, /<cbc:InvoiceTypeCode>380/);
});
test('note de crédit', () => {
  const x = buildPurchaseUbl({ kind: 'credit_note', number: 'NC1', issueDate: new Date('2026-09-11'), dueDate: null, supplier: { name: 'X', vat: null }, customer: { name: 'JJD', vat: 'BE1003823997' }, ht: 100, vatRate: 0.06, vat: 6, description: 'NC', pdf: null });
  assert.match(x, /^<\?xml[\s\S]*<CreditNote /);
  assert.match(x, /CreditNoteTypeCode>381/);
  assert.match(x, /<cbc:Percent>6<\/cbc:Percent>/);
});
test('montants', () => {
  assert.deepEqual(purchaseAmounts({ ht: 30, ttc: 36.3, vatRate: null }), { ht: 30, vat: 6.3, rate: 0.21 });
  assert.deepEqual(purchaseAmounts({ ht: -3798.52, ttc: -4596.21, vatRate: 0.21 }), { ht: 3798.52, vat: 797.69, rate: 0.21 });
  assert.deepEqual(purchaseAmounts({ ht: 100, ttc: 106, vatRate: null }), { ht: 100, vat: 6, rate: 0.06 });
});
