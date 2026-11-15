import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountDisplayName, bankNameFromIban } from './bank-names.js';
test('banque reconnue par l’IBAN', () => {
  assert.equal(bankNameFromIban('BE68 0689 0000 0000'), 'Belfius');
  assert.equal(bankNameFromIban('BE71 3630 0000 0069'), 'ING');
  assert.equal(bankNameFromIban('BE12 0011 2222 3333'), 'BNP Paribas Fortis');
  assert.equal(bankNameFromIban('BE12 7340 2222 3333'), 'CBC');
  assert.equal(bankNameFromIban('FR76 3000 1007 9412 3456 7890 185'), null);
  assert.equal(accountDisplayName({ iban: 'BE71363000004521', label: 'Compte à vue' }), 'ING ••4521');
  assert.equal(accountDisplayName({ iban: 'NL91ABNA0417164300', label: 'Compte' }), 'Compte ••4300');
});
