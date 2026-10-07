import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairTwins, twinScore, type TwinTx } from './bank-twins.js';

const tx = (id: string, amount: number, date: string, name = '', account = ''): TwinTx => ({ id, amount, bookingDate: new Date(`${date}T00:00:00Z`), counterpartyName: name, counterpartyAccount: account });

test('même montant signé, date à ±2 jours : jumeaux ; autre signe ou autre montant : non', () => {
  assert.notEqual(twinScore(tx('p', -47, '2026-10-05'), tx('c', -47, '2026-10-06')), null);
  assert.equal(twinScore(tx('p', -47, '2026-10-05'), tx('c', 47, '2026-10-05')), null);
  assert.equal(twinScore(tx('p', -47, '2026-10-05'), tx('c', -47.01, '2026-10-05')), null);
  assert.equal(twinScore(tx('p', -47, '2026-10-05'), tx('c', -47, '2026-10-09')), null);
});

test('deux comptes contrepartie différents : pas jumeaux', () => {
  assert.equal(twinScore(tx('p', 100, '2026-10-05', 'A', 'BE11 1111'), tx('c', 100, '2026-10-05', 'A', 'BE22 2222')), null);
  assert.notEqual(twinScore(tx('p', 100, '2026-10-05', 'A', 'BE11 1111'), tx('c', 100, '2026-10-06', 'A', '')), null);
});

test('quatre paiements identiques le même jour : appariement un-pour-un, contrepartie respectée', () => {
  const ponto = [tx('p1', -47, '2026-10-05', 'Stad Brussel'), tx('p2', -47, '2026-10-05', 'Stad Brussel'), tx('p3', -47, '2026-10-05', 'Ville De Bruxelles'), tx('p4', -47, '2026-10-05', 'Ville De Bruxelles')];
  const csv = [tx('c1', -47, '2026-10-06', 'Ville De Bruxelles'), tx('c2', -47, '2026-10-06', 'Stad Brussel'), tx('c3', -47, '2026-10-06', 'Stad Brussel'), tx('c4', -47, '2026-10-06', 'Ville De Bruxelles')];
  const { pairs, unpaired } = pairTwins(ponto, csv);
  assert.equal(pairs.length, 4);
  assert.equal(unpaired.length, 0);
  assert.equal(new Set(pairs.map(([, r]) => r.id)).size, 4, 'chaque ligne CSV sert une seule fois');
  for (const [l, r] of pairs) assert.equal(l.counterpartyName, r.counterpartyName);
});

test('une vraie nouveauté (sans jumeau) reste non appariée ; un jumeau ne sert qu’une fois', () => {
  const { pairs, unpaired } = pairTwins([tx('p1', 500, '2026-10-05', 'X'), tx('p2', 500, '2026-10-05', 'X'), tx('p3', 12, '2026-10-05')], [tx('c1', 500, '2026-10-06', 'X')]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(unpaired.map((u) => u.id).sort(), ['p2', 'p3']);
});
