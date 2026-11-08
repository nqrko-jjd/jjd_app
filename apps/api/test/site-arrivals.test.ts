import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalStatus } from '../src/lib/site-arrival-status.js';

const start = new Date('2026-11-09T08:00:00+01:00');
test('arrivée à l’heure : sur place, sans retard', () => {
  assert.deepEqual(arrivalStatus(start, { arrivedAt: '2026-11-09T06:55:00.000Z', leftAt: null }, new Date('2026-11-09T09:00:00+01:00')), { statut: 'sur_place', retardMinutes: null });
});
test('arrivée 40 min après le début prévu : retard signalé', () => {
  assert.deepEqual(arrivalStatus(start, { arrivedAt: '2026-11-09T07:40:00.000Z', leftAt: '2026-11-09T11:00:00.000Z' }, new Date('2026-11-09T13:00:00+01:00')), { statut: 'reparti', retardMinutes: 40 });
});
test('pas arrivé 45 min après : en retard', () => {
  assert.deepEqual(arrivalStatus(start, { arrivedAt: null, leftAt: null }, new Date('2026-11-09T08:45:00+01:00')), { statut: 'en_retard', retardMinutes: 45 });
});
test('pas encore l’heure : prévu ; sans traceur : sans_gps', () => {
  assert.equal(arrivalStatus(start, { arrivedAt: null, leftAt: null }, new Date('2026-11-09T08:10:00+01:00')).statut, 'prevu');
  assert.equal(arrivalStatus(start, null, new Date('2026-11-09T09:00:00+01:00')).statut, 'sans_gps');
});
