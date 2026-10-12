import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml, type PdfDoc } from '../src/lib/pdf.js';
import { resolveCompany } from '../src/lib/documents.js';

const doc = (kind: string): PdfDoc => ({
  kind, number: kind === 'quote' ? 'D-TEST' : 'F-TEST', draftRef: null,
  title: 'Travaux de contrôle', intro: null, terms: null,
  issuedOn: '2026-10-12', dueOn: kind === 'quote' ? null : '2026-10-22',
  validUntil: null, structuredComm: null, billingName: 'Client de test',
  billingAddress: null, billingVat: null, billingEmail: null, customerRef: null,
  worksite: null, contact: null,
  lines: [{ kind: 'item', label: 'Travaux', description: null, unit: 'ff', qty: 1, unitPriceHt: 500, vatRate: 0.21, discountPct: 0 }],
});

test('quotes and invoices expose both supplied bank accounts and payment terms', async () => {
  const company = resolveCompany({ iban: '', quoteTerms: '', invoiceTerms: '' });
  for (const kind of ['quote', 'invoice', 'deposit_invoice']) {
    const html = await buildHtml(doc(kind), company);
    assert.ok(html.includes('Belfius BE31 0689 4940 0055'));
    assert.ok(html.includes('ING BE64 3632 5469 4152'));
    assert.ok(html.includes('Conditions de paiement'));
    if (kind === 'quote') {
      assert.ok(html.includes('50 % d’acompte'));
      assert.ok(html.includes('40 % à l’avancement'));
      assert.ok(html.includes('10 % à la réception'));
      assert.ok(!html.includes('pay-qr"><img'));
    } else {
      assert.ok(html.includes('10 jours date facture.'));
      assert.ok(html.includes('Communication : <strong>F-TEST'));
      assert.ok(html.includes('pay-qr"><img'));
    }
  }
});

test('explicit conditions and a custom deposit plan take precedence', async () => {
  const company = resolveCompany({ invoiceTerms: 'Paiement à 45 jours.', bankDetails: 'Compte personnalisé' });
  assert.equal(company.invoiceTerms, 'Paiement à 45 jours.');
  assert.equal(company.bankDetails, 'Compte personnalisé');
  let html = await buildHtml({ ...doc('invoice'), terms: 'Conditions convenues <client>' }, company);
  assert.ok(html.includes('Conditions convenues &lt;client&gt;'));
  assert.ok(!html.includes('Paiement à 45 jours.'));
  html = await buildHtml({ ...doc('quote'), depositPlan: [{kind:'percent',value:20,trigger:'signature'}] }, resolveCompany({}));
  assert.ok(html.includes('Selon l’échéancier d’acomptes ci-dessus.'));
  assert.ok(!html.includes('50 % d’acompte'));
});

test('render representative payment documents in CI', { skip: !process.env.CI }, async () => {
  process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/google-chrome';
  const { renderDocumentPdf } = await import('../src/lib/pdf.js');
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir('tmp/payment-preview', { recursive: true });
  for (const kind of ['quote', 'invoice']) {
    await writeFile('tmp/payment-preview/' + kind + '.pdf', await renderDocumentPdf(doc(kind), resolveCompany({})));
  }
});
