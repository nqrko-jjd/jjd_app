import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section, isOuvrierRemuneration, isPaid, isVehicleFinancing } from '../src/lib/consolidated.js';

test('isOuvrierRemuneration : ne matche que "Rémunération - Ouvrier"', () => {
  assert.equal(isOuvrierRemuneration('Rémunération - Ouvrier'), true);
  assert.equal(isOuvrierRemuneration('rémunération - ouvrier'), true);
  assert.equal(isOuvrierRemuneration('Rémunération - Julien'), false);
  assert.equal(isOuvrierRemuneration('Rémunération - Tonton'), false);
  assert.equal(isOuvrierRemuneration('Rémunération - M7'), false);
  assert.equal(isOuvrierRemuneration('Matériel'), false);
  assert.equal(isOuvrierRemuneration(null), false);
});

test('section : "Rémunération - M7" reclassée en sous-traitance (ancien associé prestant comme ouvrier)', () => {
  assert.equal(section('Rémunération - M7'), 'sous_traitance');
  assert.equal(section('Rémunération - Ouvrier'), 'salaires');
  assert.equal(section('Rémunération - Julien'), 'salaires');
  assert.equal(section('Rémunération - Tonton'), 'salaires');
  assert.equal(section('Sous-traitance générale'), 'sous_traitance');
});

test('isPaid : égalité stricte — "Non Payé" contient "Payé" comme sous-chaîne mais n\'est pas payé', () => {
  assert.equal(isPaid('Payé'), true);
  assert.equal(isPaid('payé'), true);
  assert.equal(isPaid('Non Payé'), false);
  assert.equal(isPaid('Non payé'), false);
  assert.equal(isPaid(null), false);
  assert.equal(isPaid(''), false);
});

test('isVehicleFinancing : "Crédit auto" (financement/leasing) n\'est pas une dépense d\'exploitation', () => {
  assert.equal(isVehicleFinancing('Crédit auto'), true);
  assert.equal(isVehicleFinancing('Crédit Auto'), true);
  assert.equal(isVehicleFinancing('Achat véhicule'), false);
  assert.equal(isVehicleFinancing('Charges véhicules'), false);
  assert.equal(isVehicleFinancing(null), false);
});
