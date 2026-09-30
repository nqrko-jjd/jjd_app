import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNominatimHit, mapPhotonHit } from '../src/lib/geocode.js';

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

test('mapNominatimHit : label court "rue, code postal ville" plutôt que le display_name complet (souvent en double FR/NL)', () => {
  const hit = mapNominatimHit({
    lat: '50.85', lon: '4.35',
    display_name: 'Rue de Lombardie, Saint-Gilles - Sint-Gillis, Bruxelles-Capitale - Brussels Hoofdstedelijk Gewest, 1060, België / Belgique / Belgien',
    address: { road: 'Rue de Lombardie', house_number: '20', postcode: '1060', city: 'Saint-Gilles' },
  });
  assert.equal(hit.label, 'Rue de Lombardie 20, 1060 Saint-Gilles');
});

test('mapNominatimHit : sans rue/ville structurées, repli sur display_name pour le label', () => {
  const hit = mapNominatimHit({ lat: '50.1', lon: '4.2', display_name: 'Belgique' });
  assert.equal(hit.label, 'Belgique');
});

test('mapPhotonHit : rue + numéro + code postal + ville extraits du détail Photon', () => {
  const hit = mapPhotonHit({
    properties: { street: 'Avenue Albert-Elisabeth', housenumber: '66', postcode: '1200', city: 'Woluwe-Saint-Lambert' },
    geometry: { coordinates: [4.402417, 50.8406129] },
  });
  assert.equal(hit.street, 'Avenue Albert-Elisabeth 66');
  assert.equal(hit.postalCode, '1200');
  assert.equal(hit.city, 'Woluwe-Saint-Lambert');
  assert.equal(hit.lat, 50.8406129);
  assert.equal(hit.lng, 4.402417);
  assert.equal(hit.label, 'Avenue Albert-Elisabeth 66, 1200 Woluwe-Saint-Lambert');
});

test('mapPhotonHit : town/village en repli quand city absente', () => {
  const hit = mapPhotonHit({ properties: { street: 'Rue Test', village: 'Waterloo', postcode: '1410' }, geometry: { coordinates: [4.5, 50.5] } });
  assert.equal(hit.city, 'Waterloo');
});

test('mapPhotonHit : sans rue, repli sur le nom du lieu', () => {
  const hit = mapPhotonHit({ properties: { name: 'Grand-Place', city: 'Bruxelles' }, geometry: { coordinates: [4.35, 50.85] } });
  assert.equal(hit.street, 'Grand-Place');
});
