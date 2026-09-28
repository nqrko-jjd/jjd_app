import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRefMatches } from '../src/lib/purchase-ref-scan.js';

// texte réel (pdftotext -raw) d'une facture Sani Mat Wavre — l'article commandé (« 198356 ») est
// la réf. fournisseur enregistrée sur l'article de stock correspondant (PLAQUETTE FIXATION…)
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
C Tot−Marchandise Base Taxable %−TVA Total Tva Total A PAYER
3 32.04 32.04 21. 6.73 38.77 38.77 EUR
DATE D'ECHEANCE: 25/09/26
`;

test('findRefMatches : retrouve la réf. article dans une vraie facture Sani Mat Wavre', () => {
  const matches = findRefMatches(SANIMAT_TEXT, [
    { stockItemId: 'plaquette-id', supplierRef: '198356' },
    { stockItemId: 'autre-id', supplierRef: 'MP75' },
  ]);
  assert.deepEqual(matches, [{ stockItemId: 'plaquette-id', supplierRef: '198356' }]);
});

test('findRefMatches : insensible à la casse et aux espaces autour de la réf', () => {
  const matches = findRefMatches('Voir article  MP-75  en stock', [{ stockItemId: 'x', supplierRef: 'mp-75' }]);
  assert.equal(matches.length, 1);
});

test('findRefMatches : ignore les réf. trop courtes (faux positifs quasi garantis)', () => {
  const matches = findRefMatches('Page 1 sur 3 — total 3.00 EUR', [{ stockItemId: 'x', supplierRef: '3' }]);
  assert.equal(matches.length, 0);
});

test('findRefMatches : aucune correspondance si la réf n’apparaît pas', () => {
  const matches = findRefMatches(SANIMAT_TEXT, [{ stockItemId: 'x', supplierRef: 'ART-9999' }]);
  assert.equal(matches.length, 0);
});
