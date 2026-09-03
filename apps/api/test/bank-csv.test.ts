import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBankCsv } from '../src/lib/bank-csv.js';

test('CSV belge point-virgule, en-têtes FR, montants belges', () => {
  const csv = [
    'Date de comptabilisation;Nom contrepartie;Montant;Communication',
    '15/05/2026;COLRUYT BRUXELLES;-84,20;Achat carte',
    '16/05/2026;"CLIENT SPRL";1.210,00;+++084/2613/66074+++',
  ].join('\n');
  const r = parseBankCsv(csv);
  assert.equal(r.rows.length, 2);
  assert.ok(r.mapped.includes('amount') && r.mapped.includes('bookingDate'));
  assert.equal(r.rows[0]!.amount, -84.2);
  assert.equal(r.rows[0]!.counterpartyName, 'COLRUYT BRUXELLES');
  assert.equal(r.rows[0]!.bookingDate?.toISOString().slice(0, 10), '2026-05-15');
  assert.equal(r.rows[1]!.amount, 1210);
  assert.equal(r.rows[1]!.communication, '+++084/2613/66074+++');
});

test('CSV virgule, en-têtes EN, date ISO', () => {
  const csv = 'Booking date,Merchant,Amount,Currency\n2026-04-01,AWS EMEA,-312.55,EUR\n';
  const r = parseBankCsv(csv);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.amount, -312.55);
  assert.equal(r.rows[0]!.counterpartyName, 'AWS EMEA');
  assert.equal(r.rows[0]!.bookingDate?.getUTCFullYear(), 2026);
});

test('externalId stable = ré-import idempotent', () => {
  const csv = 'Datum;Naam;Bedrag\n10/03/2026;TOTAL ENERGIES;-72,00\n';
  const a = parseBankCsv(csv).rows[0]!;
  const b = parseBankCsv(csv).rows[0]!;
  assert.equal(a.externalId, b.externalId);
  assert.ok(a.externalId.startsWith('csv-'));
});

test('en-têtes non reconnues -> rows vide + diagnostic', () => {
  const r = parseBankCsv('col1;col2;col3\na;b;c\n');
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.headers, ['col1', 'col2', 'col3']);
});
