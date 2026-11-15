import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectDebit } from './bank-direct-debit-parse.js';

test('Belfius', () => {
  const r = parseDirectDebit({ counterpartyName: 'AXA', description: 'VOTRE DOMICILIATION EUROPEENNE 010624813439001 POUR   AXA COMMUNICATION :   0106248134391042026', communication: null });
  assert.deepEqual(r, { mandate: '010624813439001', creditor: 'AXA' });
  const k = parseDirectDebit({ counterpartyName: null, description: 'VOTRE DOMICILIATION EUROPEENNE L10180013191 POUR KBC  BANK NV COMMUNICATION : 0001', communication: null });
  assert.deepEqual(k, { mandate: 'L10180013191', creditor: 'KBC BANK NV' });
});
test('ING', () => {
  const r = parseDirectDebit({ counterpartyName: 'VAN BREDA CAR FINANCE', description: 'European Direct Debit', communication: 'DEBET VOOR EEN DOMICILIERING IN EURO (SEPA)\r\nMandaat: 2189293/003\r\nType: x' });
  assert.deepEqual(r, { mandate: '2189293/003', creditor: 'VAN BREDA CAR FINANCE' });
  const s = parseDirectDebit({ counterpartyName: 'Domiciliëring in euro (SEPA) I', description: 'x', communication: 'DOMICILIERING\r\nVandaag, debiteren wij uw rekening voor:\r\nING Equipment Lease Belgium\r\nMandaat: ABC123' });
  assert.deepEqual(s, { mandate: 'ABC123', creditor: 'ING Equipment Lease Belgium' });
});
test('virement ordinaire : rien', () => {
  assert.equal(parseDirectDebit({ counterpartyName: 'X', description: 'VIREMENT INSTANTANE', communication: null }), null);
});
