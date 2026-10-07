import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml, type PdfDoc } from '../src/lib/pdf.js';
import { DOCUMENT_TERMS, VAT_RATE_NOTE } from '@jjd/shared';
import type { Company } from '../src/lib/documents.js';

const company: Company = { name: 'JJD Consult', address: '', postalCode: '', city: '', vat: '', iban: '', email: '', phone: '', website: '', quoteTerms: 'Devis valable 30 jours', invoiceTerms: 'Conditions par défaut', vatNote6: VAT_RATE_NOTE['0.06']!, vatNote0: VAT_RATE_NOTE['0']! };
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

test('Standard VAT produces neither reduced-rate nor reverse-charge clause; a quote carries the signature block and the general conditions (one page)', async () => {
  const html = await buildHtml({ ...document, kind: 'quote', lines: [line(.21)] }, company);
  assert.doesNotMatch(html, /Taux de TVA :|Autoliquidation :/);
  assert.match(html, /Bon pour accord/);
  assert.match(html, /Date et signature/);
  assert.match(html, /<section class="sheet general-terms">/);
  assert.match(html, /class="cg-cols"/);
  assert.equal((html.match(/<section class="sheet general-terms">/g) || []).length, 1);
});

test('VAT mentions come from the company settings; empty = hidden; imported document without lines falls back on its stored rate', async () => {
  const custom = await buildHtml({ ...document, kind: 'quote', lines: [line(.06)] }, { ...company, vatNote6: 'Mon texte TVA perso', vatNote0: '' });
  assert.match(custom, /Mon texte TVA perso/);
  assert.doesNotMatch(custom, /Taux de TVA :/);
  const hidden = await buildHtml({ ...document, kind: 'quote', lines: [line(.06)] }, { ...company, vatNote6: '', vatNote0: '' });
  assert.doesNotMatch(hidden, /vat-note">/);
  const bare = await buildHtml({ ...document, kind: 'quote', vatRate: 0.06, lines: [] }, { ...company, vatNote6: 'Mention par défaut', vatNote0: '' });
  assert.match(bare, /Mention par défaut/);
});
