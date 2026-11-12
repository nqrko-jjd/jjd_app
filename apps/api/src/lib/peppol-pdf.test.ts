import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmbeddedPdf } from './peppol-pdf.js';

const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n` + 'x'.repeat(200)).toString('base64');
const ubl = (atts: string) => `<?xml version="1.0"?><Invoice xmlns:cac="urn:cac" xmlns:cbc="urn:cbc"><cbc:ID>F1</cbc:ID>${atts}</Invoice>`;
const att = (b64: string, mime = 'application/pdf', name = 'facture.pdf') =>
  `<cac:AdditionalDocumentReference><cbc:ID>1</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="${mime}" filename="${name}">\n${b64.replace(/(.{76})/g, '$1\n')}\n</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;

test('Peppol : PDF d\'origine du fournisseur extrait du XML', () => {
  const out = extractEmbeddedPdf(ubl(att(pdf('FACTURE'))));
  assert.ok(out && out.toString().includes('FACTURE'));
});
test('Peppol : pas de PDF joint → null (on garde la mise en page générée)', () => {
  assert.equal(extractEmbeddedPdf(ubl('')), null);
  assert.equal(extractEmbeddedPdf(ubl(att(Buffer.from('pas un pdf'.repeat(30)).toString('base64')))), null);
  assert.equal(extractEmbeddedPdf(ubl(att(pdf('IMG'), 'image/png', 'logo.png'))), null);
});
test('Peppol : facture préférée aux conditions générales jointes', () => {
  const out = extractEmbeddedPdf(ubl(att(pdf('CGV'), 'application/pdf', 'CGV.pdf') + att(pdf('FACTURE'), 'application/pdf', 'F2026-12.pdf')));
  assert.ok(out && out.toString().includes('FACTURE'));
});
