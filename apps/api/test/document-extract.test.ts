import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentText } from '../src/lib/document-extract.js';

test('parseDocumentText : facture — type, date, TVA et totaux détectés', () => {
  const text = `
    SANIMAT WAVRE
    TVA : BE 0746.980.568

    FACTURE N° 351682
    Date : 09/07/2026

    Client : JJD CONSULT
    TVA : BE1003823997

    Total HTVA        1 498,17
    TVA 21%             314,62
    Total TVAC        1 812,79
  `;
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'invoice');
  assert.equal(r.issuedOn, '2026-07-09');
  assert.equal(r.totalHt, 1498.17);
  assert.equal(r.totalVat, 314.62);
  assert.equal(r.totalTtc, 1812.79);
  assert.equal(r.vatRate, 0.21);
  assert.deepEqual(r.vatNumbersFound.sort(), ['BE0746980568', 'BE1003823997']);
});

test('parseDocumentText : note de crédit détectée avant "facture" même si le mot apparaît ailleurs', () => {
  const text = 'NOTE DE CRÉDIT n° 205112\nSuite à notre facture du 01/09/2025\nTotal TTC 218,56';
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'credit_note');
  assert.equal(r.totalTtc, 218.56);
});

test('parseDocumentText : devis détecté', () => {
  const text = 'DEVIS N° 2026-014\nDate du devis : 03/03/2026\nNet à payer : 4 072,97';
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'quote');
  assert.equal(r.issuedOn, '2026-03-03');
  assert.equal(r.totalTtc, 4072.97);
});

test('parseDocumentText : texte sans repère connu -> tout à null, pas d’erreur', () => {
  const r = parseDocumentText('Bonjour,\nVeuillez trouver ci-joint le document demandé.\nCordialement.');
  assert.equal(r.kind, null);
  assert.equal(r.issuedOn, null);
  assert.equal(r.totalTtc, null);
  assert.deepEqual(r.vatNumbersFound, []);
});
