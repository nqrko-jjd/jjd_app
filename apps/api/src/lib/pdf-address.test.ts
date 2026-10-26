import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressLines } from './pdf.js';

test('adresse sur le PDF : la rue, puis code postal et ville à la ligne', () => {
  assert.deepEqual(addressLines('Rue de la Loi 12 bte 3, 1000 Bruxelles'), ['Rue de la Loi 12 bte 3', '1000 Bruxelles']);
  assert.deepEqual(addressLines('Avenue Louise 5 1050 Ixelles'), ['Avenue Louise 5', '1050 Ixelles']);
  assert.deepEqual(addressLines('c/o Baltimo, Rue X 1, 1060 Saint-Gilles'), ['c/o Baltimo, Rue X 1', '1060 Saint-Gilles']);
  assert.deepEqual(addressLines('Rue A 1\n1000 Bruxelles'), ['Rue A 1', '1000 Bruxelles']);
  assert.deepEqual(addressLines('c/o Baltimo, Bruxelles'), ['c/o Baltimo, Bruxelles'], 'sans code postal : inchangé');
  assert.deepEqual(addressLines('1000 Bruxelles'), ['1000 Bruxelles']);
  assert.deepEqual(addressLines(null), []);
});
