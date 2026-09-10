import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, readTableBuffer } from '../src/lib/table-io.js';

test('toCsv : BOM UTF-8 + délimiteur ";" + échappement', () => {
  const csv = toCsv(
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
    [{ a: 'contient ; un point-virgule', b: 'simple' }, { a: 12.5, b: null }],
  );
  assert.equal(csv[0], '﻿');
  const body = csv.slice(1);
  const lines = body.trim().split('\r\n');
  assert.equal(lines[0], 'A;B');
  assert.equal(lines[1], '"contient ; un point-virgule";simple');
  assert.equal(lines[2], '12,5;');
});

test('readTableBuffer : CSV avec délimiteur "," (défaut) et en-têtes normalisés', () => {
  const buf = Buffer.from('Prénom,Nom\nJean,Dupont\nÉlise,Martin\n', 'utf8');
  const rows = readTableBuffer(buf, 'export.csv');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!['prenom'], 'Jean');
  assert.equal(rows[0]!['nom'], 'Dupont');
});

test('readTableBuffer : CSV avec délimiteur ";" (Excel FR/BE) auto-détecté', () => {
  const buf = Buffer.from('Prénom;Nom\r\nJean;Dupont\r\n', 'utf8');
  const rows = readTableBuffer(buf, 'export.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!['prenom'], 'Jean');
  assert.equal(rows[0]!['nom'], 'Dupont');
});

test('round-trip : toCsv -> readTableBuffer retrouve les mêmes valeurs', () => {
  const columns = [{ key: 'id', label: 'id' }, { key: 'nom', label: 'Nom' }, { key: 'montant', label: 'Montant' }];
  const csv = toCsv(columns, [{ id: 'abc123', nom: 'Fournisseur Test', montant: 12.5 }]);
  const rows = readTableBuffer(Buffer.from(csv, 'utf8'), 'export.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!['id'], 'abc123');
  assert.equal(rows[0]!['nom'], 'Fournisseur Test');
  assert.equal(rows[0]!['montant'], '12,5');
});

test('readTableBuffer : lignes vides ignorées', () => {
  const buf = Buffer.from('id;nom\r\n1;A\r\n\r\n2;B\r\n', 'utf8');
  const rows = readTableBuffer(buf, 'x.csv');
  assert.equal(rows.length, 2);
});
