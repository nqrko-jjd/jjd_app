import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCard } from './bank-cards-pure.js';

test('Belfius Bancontact', () => {
  assert.deepEqual(detectCard({ bank: 'Belfius', communication: 'BE 18/11/26 07:23 MCC5046 525506XXXXXX6094Sweert Julien' }),
    { network: 'bancontact', last4: '6094', prefix: '525506', holderName: 'Sweert Julien', bank: 'Belfius' });
});
test('ING Bancontact', () => {
  const h = detectCard({ bank: 'ING', communication: 'Betaling Bancontact 18/11/26 - 9.47 uur - BELGIAN MINERALS 1390 - GREZ-DOICEAU - BEL Kaartnummer 5244 35XX XXXX 4361 ' });
  assert.equal(h?.last4, '4361'); assert.equal(h?.prefix, '524435'); assert.equal(h?.network, 'bancontact');
});
test('Visa', () => {
  assert.deepEqual(detectCard({ bank: 'VISA ••7639', communication: '' }), { network: 'visa', last4: '7639', prefix: null, holderName: null, bank: null });
});
test('virement ordinaire', () => { assert.equal(detectCard({ bank: 'Belfius', communication: 'Facture 341' }), null); });
test('Belfius : le libellé après le nom est ignoré', () => {
  assert.equal(detectCard({ bank: 'Belfius', communication: 'BE 18/11/26 MCC5541 525506XXXXXX3734Scott David', description: 'BANCONTACT - ACHAT CARBURANT' })?.holderName, 'Scott David');
  assert.equal(detectCard({ bank: 'Belfius', communication: 'MCC5046 525506XXXXXX6094Sweert Julien BANCONTACT - ACHAT - SANIMAT' })?.holderName, 'Sweert Julien');
});
