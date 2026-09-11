import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNominatimHit } from '../src/lib/geocode.js';

test('mapNominatimHit : rue + numéro + code postal + ville extraits du détail Nominatim', () => {
  const hit = mapNominatimHit({
    lat: '50.8503',
    lon: '4.3517',
    display_name: 'Rue du Chantier 5, 1050 Ixelles, Belgique',
    address: { road: 'Rue du Chantier', house_number: '5', postcode: '1050', city: 'Ixelles' },
  });
  assert.equal(hit.street, 'Rue du Chantier 5');
  assert.equal(hit.postalCode, '1050');
  assert.equal(hit.city, 'Ixelles');
  assert.equal(hit.lat, 50.8503);
  assert.equal(hit.lng, 4.3517);
});

test('mapNominatimHit : sans détail address -> repli sur le premier segment du display_name', () => {
  const hit = mapNominatimHit({ lat: '50.1', lon: '4.2', display_name: 'Avenue Test 12, 1000 Bruxelles' });
  assert.equal(hit.street, 'Avenue Test 12');
  assert.equal(hit.postalCode, '');
  assert.equal(hit.city, '');
});

test('mapNominatimHit : ville via town/village/municipality quand city absente', () => {
  const hit = mapNominatimHit({
    lat: '50.5', lon: '4.5', display_name: 'Chaussée 1, Waterloo',
    address: { road: 'Chaussée', house_number: '1', postcode: '1410', village: 'Waterloo' },
  });
  assert.equal(hit.city, 'Waterloo');
});
