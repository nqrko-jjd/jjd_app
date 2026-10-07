import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeoQueries, labelFitsPostal } from './geo-query.js';

const base = { address: null, postalCode: null, city: null };

test('adresse tout sur une ligne (ancienne saisie) : utilisée telle quelle, sans doublon de commune', () => {
  const r = buildGeoQueries({ ...base, address: 'Rue de Menin 53, 1080 Molenbeek-Saint-Jean' })!;
  assert.deepEqual(r.queries, ['Rue de Menin 53, 1080 Molenbeek-Saint-Jean, Belgique']);
  assert.equal(r.postal, '1080');
});

test('adresse déjà complète + champs ville/code postal remplis : pas de répétition', () => {
  const r = buildGeoQueries({ address: 'Rue de Menin 53, 1080 Molenbeek-Saint-Jean', postalCode: '1080', city: 'Molenbeek-Saint-Jean' })!;
  assert.equal(r.queries[0], 'Rue de Menin 53, 1080 Molenbeek-Saint-Jean, Belgique');
});

test('formulaire actuel : rue + code postal + ville', () => {
  const r = buildGeoQueries({ address: 'Lanceloetlaan 9', postalCode: '3090', city: 'Overijse' })!;
  assert.equal(r.queries[0], 'Lanceloetlaan 9, 3090 Overijse, Belgique');
  assert.equal(r.queries[1], 'Lanceloetlaan 9, Overijse, Belgique');
});

test('« bte », « app », « étage » retirés avant la recherche', () => {
  assert.equal(buildGeoQueries({ address: 'Avenue de la Sapinière 50A bte 3, 1180 Uccle', postalCode: null, city: null })!.queries[0], 'Avenue de la Sapinière 50A, 1180 Uccle, Belgique');
  assert.equal(buildGeoQueries({ address: 'Rue des Alliés 46 étage 2', postalCode: '1190', city: 'Forest' })!.queries[0], 'Rue des Alliés 46, 1190 Forest, Belgique');
});

test('rue seule sans commune ni code postal : refusée (trop ambigu)', () => {
  assert.equal(buildGeoQueries({ ...base, address: 'Rue de Menin 53' }), null);
  assert.equal(buildGeoQueries({ ...base, address: null }), null);
  assert.ok(buildGeoQueries({ ...base, address: 'Rue de Menin 53, Molenbeek' }));
});

test('à défaut, l’adresse de l’immeuble', () => {
  const r = buildGeoQueries({ ...base, acp: { address: 'Rue Haute 1', postalCode: '1000', city: 'Bruxelles' } })!;
  assert.equal(r.queries[0], 'Rue Haute 1, 1000 Bruxelles, Belgique');
});

test('résultat dans un autre code postal : écarté', () => {
  assert.equal(labelFitsPostal('53, Rue de Menin, Molenbeek-Saint-Jean, 1080, Belgique', '1080'), true);
  assert.equal(labelFitsPostal('53, Rue de Menin, Gand, 9000, Belgique', '1080'), false);
  assert.equal(labelFitsPostal('Rue de Menin, Belgique', '1080'), true);
  assert.equal(labelFitsPostal('X, 9000, Belgique', null), true);
});
