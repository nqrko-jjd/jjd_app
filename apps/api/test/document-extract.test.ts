import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentText, findWorksiteRefCandidates } from '../src/lib/document-extract.js';

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
  assert.equal(r.docNumber, '351682');
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
  assert.equal(r.docNumber, '205112');
  assert.equal(r.totalTtc, 218.56);
});

test('parseDocumentText : devis détecté', () => {
  const text = 'DEVIS N° 2026-014\nDate du devis : 03/03/2026\nNet à payer : 4 072,97';
  const r = parseDocumentText(text);
  assert.equal(r.kind, 'quote');
  assert.equal(r.issuedOn, '2026-03-03');
  assert.equal(r.docNumber, '2026-014');
  assert.equal(r.totalTtc, 4072.97);
});

test('parseDocumentText : facture en tableau (en-têtes de colonnes puis valeurs sur la ligne suivante)', () => {
  // reproduit un vrai cas remonté : facture "No-Doc." style ERP, date sur 2 chiffres,
  // aucun montant/n° adjacent à un libellé sur la même ligne (mise en page en colonnes)
  const text = [
    ' BV JJD CONSULT',
    ' GIETERIJSTRAAT 49',
    ' B-1601 RUISBROEK (BT.)',
    'Tél: 0470/69.37.65',
    ' Date No-Tva No-Cl. No-Doc. FACTURE',
    ' 09/09/26 BE 1003.823.997 3958 20/358741',
    ' Article Libellé Qté UV PV-Brut %-Rem PV-Net Montant C',
    ' 197224 RAD. HENRAD 8 TROUS 600X1800 T22 3118W 1. PC 647.12 -65. % 226.49 226.49 3',
    ' Votre référence:: R069',
    ' De 09/09/26 ONTVANGEN MC/BC/C.CARD 395.05 EUR',
    'C Tot-Marchandise Base Taxable %-TVA Total Tva Total A PAYER',
    '3 326.49 326.49 21. 68.56 395.05 EUR',
    'DATE D\'ECHEANCE: 09/09/26 ACOMPTE: 395.05 EUR',
  ].join('\n');

  const r = parseDocumentText(text);
  // le tout premier motif "chiffre/chiffre/chiffre" du texte est un n° de tél (0470/69.37 ->
  // 69 invalide comme mois) : ne doit pas faire échouer toute la détection de date
  assert.equal(r.issuedOn, '2026-09-09');
  assert.equal(r.docNumber, '20/358741');
  assert.equal(r.totalTtc, 395.05);

  const refs = findWorksiteRefCandidates(text);
  assert.deepEqual(refs, ['R-69']);
});

test('findWorksiteRefCandidates : plusieurs chantiers cités (facture qui couvre plusieurs chantiers)', () => {
  const refs = findWorksiteRefCandidates('Livraison pour R-69 et complément pour R123 (bon E07 joint)');
  assert.deepEqual(refs, ['R-69', 'R-123', 'E-7']);
});

test('parseDocumentText : texte sans repère connu -> tout à null, pas d’erreur', () => {
  const r = parseDocumentText('Bonjour,\nVeuillez trouver ci-joint le document demandé.\nCordialement.');
  assert.equal(r.kind, null);
  assert.equal(r.issuedOn, null);
  assert.equal(r.totalTtc, null);
  assert.deepEqual(r.vatNumbersFound, []);
});
