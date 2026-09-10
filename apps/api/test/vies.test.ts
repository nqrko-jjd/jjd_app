import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAddress, lookupBelgianVat } from '../src/lib/vies.js';

test('splitAddress : rue + code postal/ville sur 2 lignes', () => {
  const r = splitAddress('Gieterijstraat 49\n1601 Sint-Pieters-Leeuw');
  assert.equal(r.address, 'Gieterijstraat 49');
  assert.equal(r.postalCode, '1601');
  assert.equal(r.city, 'Sint-Pieters-Leeuw');
});

test('splitAddress : ville composée (plusieurs mots)', () => {
  const r = splitAddress('Chaussée de Louvain 500A\n1300 Wavre');
  assert.equal(r.postalCode, '1300');
  assert.equal(r.city, 'Wavre');
});

test('splitAddress : "---" ou vide -> tout null', () => {
  assert.deepEqual(splitAddress('---'), { address: null, postalCode: null, city: null });
  assert.deepEqual(splitAddress(null), { address: null, postalCode: null, city: null });
});

test('splitAddress : pas de code postal reconnaissable -> ville = la ligne telle quelle', () => {
  const r = splitAddress('Rue Test 1\nBruxelles');
  assert.equal(r.postalCode, null);
  assert.equal(r.city, 'Bruxelles');
});

test('lookupBelgianVat : format invalide -> erreur immédiate, pas d’appel réseau', async () => {
  const r = await lookupBelgianVat('FR12345678901');
  assert.ok('error' in r);
});

test('lookupBelgianVat : chaîne vide -> erreur immédiate', async () => {
  const r = await lookupBelgianVat('');
  assert.ok('error' in r);
});
