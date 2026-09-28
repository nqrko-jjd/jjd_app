import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLineCandidates, collapseByCode } from '../src/lib/purchase-candidates.js';

// texte réel (pdftotext -raw) d'une facture Sani Mat Wavre
const SANIMAT_TEXT = `
 BV JJD CONSULT
 GIETERIJSTRAAT 49
 B−1601 RUISBROEK (BT.)
Tél: 0470/69.37.65
 Date No−Tva No−Cl. No−Doc. FACTURE
 25/09/26 BE 1003.823.997 3958 20/360937
 Article Libellé Qté UV PV−Brut %−Rem PV−Net Montant C
 Référence interne => 392935
 Votre référence:: R069
 198356 PLAQUETTE FIXATION PANN.ISOLANT 5*70 ZN 2. PC 22.89 −30. % 16.02 32.04 3
 POUR ACCORD SIGNATURE: ....................................
C Tot−Marchandise Base Taxable %−TVA Total Tva Total A PAYER
3 32.04 32.04 21. 6.73 38.77 38.77 EUR
DATE D'ECHEANCE: 25/09/26
`;

test('findLineCandidates : lit une ligne d’article réelle (Sani Mat Wavre)', () => {
  const found = findLineCandidates(SANIMAT_TEXT);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.code, '198356');
  assert.equal(found[0]!.description, 'PLAQUETTE FIXATION PANN.ISOLANT 5*70 ZN');
  assert.equal(found[0]!.qty, 2);
});

test('findLineCandidates : n’extrait rien de l’en-tête (date, n° TVA, n° client) ni du pied de page (totaux, TVA)', () => {
  const found = findLineCandidates(SANIMAT_TEXT);
  assert.ok(!found.some((f) => f.code === '25')); // "25/09/26" n'est pas un code pur
  assert.ok(!found.some((f) => f.code === '392935')); // "Référence interne" ne commence pas par un chiffre
  assert.ok(!found.some((f) => f.code === '3')); // ligne de totaux, code trop court
});

test('findLineCandidates : texte sans motif reconnaissable -> aucune ligne (repli silencieux, pas de faux positif)', () => {
  const found = findLineCandidates('Facture Vector 3\nTotal TTC : 120,00 EUR\nMerci de votre confiance');
  assert.equal(found.length, 0);
});

test('collapseByCode : un même code sur plusieurs lignes de la même facture -> une seule entrée, quantités additionnées', () => {
  const collapsed = collapseByCode([
    { code: '206', description: 'BETON C35/45', qty: 9 },
    { code: '206', description: 'BETON C35/45', qty: 10 },
  ]);
  assert.equal(collapsed.size, 1);
  assert.equal(collapsed.get('206')!.qty, 19);
});

test('findLineCandidates : plusieurs lignes d’article sur la même facture', () => {
  const text = `
 198356 PLAQUETTE FIXATION PANN.ISOLANT 5*70 ZN 2. PC 22.89 −30. % 16.02 32.04 3
 445210 VIS BOIS TF 5X60 ZN 10. PC 3.50 0. % 3.50 35.00 3
`;
  const found = findLineCandidates(text);
  assert.equal(found.length, 2);
  assert.equal(found[1]!.code, '445210');
  assert.equal(found[1]!.qty, 10);
});
