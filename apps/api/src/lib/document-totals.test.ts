import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTotals } from './document-totals.js';

test('Clicpublic : montants précédés de « € », libellés bilingues', () => {
  const text = [
    'Lot d\'outils de maçon 21 % € 30,00 1 € 30,00 € 6,30',
    'Commission de Clicpublic incluse (17.00%)',
    'Total HT - Totaal excl. BTW: € 30,00',
    'Total TVA - Tot. BTW 21 %: € 6,30',
    'Total - Totaal: € 36,30',
    'Acquittée - Vrijgesproken',
  ].join('\n');
  assert.deepEqual(findTotals(text), { ht: 30, vat: 6.3, ttc: 36.3, vatRate: 0.21 });
});
test('Clicpublic, gros montant', () => {
  const text = 'Total HT - Totaal excl. BTW: € 1.250,00\nTotal TVA - Tot. BTW 21 %: € 262,50\nTotal - Totaal: € 1.512,50\n';
  assert.deepEqual(findTotals(text), { ht: 1250, vat: 262.5, ttc: 1512.5, vatRate: 0.21 });
});
test('libellés classiques inchangés', () => {
  const t = findTotals('Total HTVA 100,00\nTVA 21% 21,00\nTotal TVAC 121,00\n');
  assert.equal(t.ht, 100); assert.equal(t.ttc, 121); assert.equal(t.vat, 21);
});
test('conditions générales en annexe ignorées', () => {
  const head = 'x'.repeat(300) + '\nTotal HT - Totaal excl. BTW: € 30,00\nTotal TVA - Tot. BTW 21 %: € 6,30\n';
  const t = findTotals(head + 'CONDITIONS GENERALES\nindemnité égale à 15% du montant de la facture avec un minimum de 100,00 Eur\n');
  assert.equal(t.ttc, 36.3);
});
