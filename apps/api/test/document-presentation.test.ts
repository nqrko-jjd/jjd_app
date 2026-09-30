import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml, type PdfDoc } from '../src/lib/pdf.js';
import { DOCUMENT_TERMS } from '@jjd/shared';
import type { Company } from '../src/lib/documents.js';

const company: Company = { name: 'JJD Consult', address: '', postalCode: '', city: '', vat: '', iban: '', email: '', phone: '', website: '', quoteTerms: 'Devis valable 30 jours', invoiceTerms: 'Conditions par défaut' };
const document: PdfDoc = { kind: 'invoice', number: 'TEST-1', draftRef: null, title: null, intro: null, terms: 'Paiement à 10 jours', issuedOn: null, dueOn: null, validUntil: null, structuredComm: null, billingName: 'Client test', billingAddress: null, billingVat: null, billingEmail: null, customerRef: null, worksite: null, contact: null, lines: [] };
const line = (vatRate: number) => ({ kind: 'item', label: '<b>Intervention</b>', description: '<img src=x onerror=alert(1)><i>Description</i>', qty: 2, unitPriceHt: 100, discountPct: 0, vatRate, unit: 'h' });

test('Invoice includes standalone logo, full conditions and mixed VAT notes exactly once', async () => {
  const html = await buildHtml({ ...document, lines: [line(.06), line(.06), line(0), line(.21)] }, company);
  assert.match(html, /class="document-logo" src="data:image\/png;base64,/);
  assert.equal((html.match(/Taux de TVA :/g) || []).length, 1);
  assert.equal((html.match(/Autoliquidation :/g) || []).length, 1);
  assert.doesNotMatch(html, /TVA 0%/);
  assert.match(html, /Conditions générales JJD Consult SRL/);
  assert.match(html, /9\. Droit applicable et litiges/);
  assert.ok(DOCUMENT_TERMS.length > 20);
  assert.match(html, /Paiement à 10 jours/);
  assert.doesNotMatch(html, /Conditions par défaut/);
  assert.match(html, /<b>Intervention<\/b>/);
  assert.match(html, /<i>Description<\/i>/);
  assert.doesNotMatch(html, /onerror|alert\(1\)/);
});

test('Standard VAT produces neither reduced-rate nor reverse-charge clause; quote has no invoice appendix', async () => {
  const html = await buildHtml({ ...document, kind: 'quote', lines: [line(.21)] }, company);
  assert.doesNotMatch(html, /Taux de TVA :|Autoliquidation :|<section class="sheet general-terms">/);
});
