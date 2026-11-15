import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountDisplayName, bankNameFromIban, normalizeBankLabel } from './bank-names.js';
test('banque reconnue par l’IBAN', () => {
  assert.equal(bankNameFromIban('BE68 0689 0000 0000'), 'Belfius');
  assert.equal(bankNameFromIban('BE71 3630 0000 0069'), 'ING');
  assert.equal(bankNameFromIban('BE12 0011 2222 3333'), 'BNP Paribas Fortis');
  assert.equal(bankNameFromIban('BE12 7340 2222 3333'), 'CBC');
  assert.equal(bankNameFromIban('FR76 3000 1007 9412 3456 7890 185'), null);
  assert.equal(accountDisplayName({ iban: 'BE71363000004521', label: 'JJD CONSULT SRL' }), 'ING');
  const accs = [{ iban: 'BE31068949400055' }, { iban: 'BE31068900001111' }, { iban: 'BE64363254694152' }];
  assert.equal(accountDisplayName({ iban: 'BE31068949400055', label: 'JJD CONSULT' }, accs), 'Belfius ••0055');
  assert.equal(accountDisplayName({ iban: 'BE64363254694152', label: 'JJD CONSULT SRL' }, accs), 'ING');
  assert.equal(accountDisplayName({ iban: 'NL91ABNA0417164300', label: 'Compte' }), 'Compte ••4300');
});
test('libellés de carte unifiés', () => {
  assert.equal(normalizeBankLabel('VISA **8307'), 'VISA ••8307');
  assert.equal(normalizeBankLabel('VISA **4960/**7449'), 'VISA ••4960/••7449');
});
