import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFleetHit, type FleetIndex } from './bank-fleet.js';

const v = (o: Partial<FleetIndex['vehicles'][number]>): FleetIndex['vehicles'][number] => ({ id: 'v', code: 'V003', plate: '1-ABC-123', brand: 'Renault', model: 'Master', acquisitionMode: 'Crédit', financeCompany: 'Belfius', financeContract: null, monthlyPayment: null, financeEndOn: null, payments: [], ...o });
const tx = (o: Partial<Parameters<typeof findFleetHit>[0]>) => ({ amount: -327.12, bookingDate: new Date('2026-11-02'), counterpartyName: null, description: null, communication: null, counterpartyAccount: null, ...o });

test('n° de crédit retrouvé malgré les séparateurs', () => {
  const idx: FleetIndex = { vehicles: [v({ id: 'a', financeContract: '071 9542735 33' }), v({ id: 'b', financeContract: '071-0000000-11' })], insurances: [], fines: [] };
  const h = findFleetHit(tx({ description: 'CHARGES ECHUES DU 01-11-2026 CREDIT PROFESSIONNEL NUMERO 071-9542735-33' }), idx);
  assert.equal(h?.kind, 'financing'); assert.equal(h?.vehicleId, 'a'); assert.equal(h?.postRef, 'E-12');
});
test('organisme + mensualité', () => {
  const idx: FleetIndex = { vehicles: [v({ id: 'a', financeCompany: 'Beobank NV', monthlyPayment: 512.4, acquisitionMode: 'Renting financier' })], insurances: [], fines: [] };
  assert.equal(findFleetHit(tx({ amount: -512.4, counterpartyName: 'BEOBANK', description: 'DOMICILIATION' }), idx)?.vehicleId, 'a');
  assert.equal(findFleetHit(tx({ amount: -500, counterpartyName: 'BEOBANK' }), idx), null);
  assert.equal(findFleetHit(tx({ amount: -512.4, counterpartyName: 'AXA' }), idx), null);
});
test('assurance par n° de police, PV par référence + montant', () => {
  const idx: FleetIndex = { vehicles: [], insurances: [{ vehicleId: 'x', provider: 'AXA', contractNumber: '0123456789', monthlyAmount: 88, annualAmount: null }], fines: [{ id: 'f', vehicleId: 'x', reference: '+++123/4567/89012+++', amount: 58, payTo: 'SPF Justice' }] };
  assert.equal(findFleetHit(tx({ amount: -88.5, description: 'DOMICILIATION AXA BELGIUM POLICE 0123456789' }), idx)?.kind, 'insurance');
  const f = findFleetHit(tx({ amount: -58, communication: '+++123/4567/89012+++' }), idx);
  assert.equal(f?.kind, 'fine'); assert.equal(f?.fineId, 'f');
  assert.equal(findFleetHit(tx({ amount: -60, communication: '+++123/4567/89012+++' }), idx), null);
});
test('rentrée ou montant nul : rien', () => {
  const idx: FleetIndex = { vehicles: [v({ financeContract: '071954273533' })], insurances: [], fines: [] };
  assert.equal(findFleetHit(tx({ amount: 327.12, description: '071-9542735-33' }), idx), null);
});
