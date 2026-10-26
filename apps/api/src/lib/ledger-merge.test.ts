import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceBaseNumber } from './ledger-merge.js';

test('n° de facture sans le suffixe de bordereau', () => {
  assert.equal(invoiceBaseNumber('23/252741 - 113679'), '23/252741');
  assert.equal(invoiceBaseNumber('23/252788 - 113811'), '23/252788');
  assert.equal(invoiceBaseNumber('  23/252741  -  113600 '), '23/252741');
  assert.equal(invoiceBaseNumber('23/252741'), '23/252741', 'sans suffixe : inchangé');
  assert.equal(invoiceBaseNumber(null), '');
});

test('seul un suffixe de 4 à 8 chiffres est retiré : un relevé de carte, un n° composé ou un tiret dans un n° restent intacts', () => {
  assert.equal(invoiceBaseNumber('526548 - Carte 707881005600348902'), '526548 - Carte 707881005600348902');
  assert.equal(invoiceBaseNumber('INV-2026-00018'), 'INV-2026-00018');
  assert.equal(invoiceBaseNumber('20/542778'), '20/542778');
  assert.equal(invoiceBaseNumber('Loyer Mars - 2025'), 'Loyer Mars - 2025', 'une année n’est pas un n° de bordereau');
  assert.equal(invoiceBaseNumber('Facture - 123456'), 'Facture - 123456', 'le début doit être un vrai n° (au moins 4 chiffres)');
});
