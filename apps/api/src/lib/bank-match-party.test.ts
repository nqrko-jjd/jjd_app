import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMatch, partyWords, type LedgerLite, type TxLite } from './bank-match-pure.js';

const L = (o: Partial<LedgerLite>): LedgerLite => ({ id: 'l', ttc: 10.33, ht: 8.54, date: new Date('2025-08-08'), direction: 'purchase', bankComm: null, supplierName: 'Baustoff + Metall', contactName: 'Baustoff + Metall (SA B+M)', documentId: null, ...o });
const T = (o: Partial<TxLite>): TxLite => ({ id: 't', amount: -10.35, bookingDate: new Date('2025-08-10'), structuredComm: null, counterpartyName: 'Tesla Inc. AARTSELAAR', side: 'out', description: null, ...o });

test('montant proche mais autre commerçant : refusé', () => {
  assert.equal(pickMatch(T({}), [L({})]), null);
});
test('même nom, alias connu ou libellé sans nom : accepté', () => {
  assert.equal(pickMatch(T({ counterpartyName: 'B+M BAUSTOFF+METALL BE' }), [L({})])?.ledgerId, 'l');
  assert.equal(pickMatch(T({ counterpartyName: 'Ilonato SRL' }), [L({ supplierName: 'BigMat', contactName: null })], () => true)?.ledgerId, 'l');
  assert.equal(pickMatch(T({ counterpartyName: 'SANIMAT OVERIJSE' }), [L({ supplierName: 'Sani Mat Wavre', contactName: null })])?.ledgerId, 'l');
  assert.equal(pickMatch(T({ counterpartyName: null, description: 'BANCONTACT - ACHAT 4430' }), [L({})])?.ledgerId, 'l');
});
test('vente : pas de filtre sur le nom', () => {
  assert.equal(pickMatch(T({ amount: 53000, side: 'in', counterpartyName: 'CREFIUS S.A.' }), [L({ direction: 'sale', ttc: 53000, supplierName: null, contactName: 'Sweert' })])?.ledgerId, 'l');
});
test('mots du libellé', () => {
  assert.deepEqual(partyWords({ counterpartyName: 'Tesla Inc. AARTSELAAR', description: null }), ['tesla', 'aartselaar']);
});
