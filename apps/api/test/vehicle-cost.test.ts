import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { worksiteTransport, getDepot } from '../src/lib/vehicle-cost.js';
import { worksiteMargin } from '../src/lib/worksite-margin.js';
import { distanceMeters } from '@jjd/shared';

let worksiteId = '';
let vehicleId = '';
let prevDepot: unknown = null;

const DEPOT = { lat: 50.85, lng: 4.35 };
const WS = { lat: 50.90, lng: 4.42 };

before(async () => {
  const existing = await prisma.setting.findUnique({ where: { key: 'depot' } });
  prevDepot = existing?.value ?? null;
  await prisma.setting.upsert({
    where: { key: 'depot' },
    create: { key: 'depot', value: { label: 'Test', address: '', postalCode: '', city: '', ...DEPOT, roadFactor: 1.4 } },
    update: { value: { label: 'Test', address: '', postalCode: '', city: '', ...DEPOT, roadFactor: 1.4 } },
  });

  const ws = await prisma.worksite.create({
    data: { ref: 'R-VC-TEST', title: 'Transport test', source: 'test', lat: WS.lat, lng: WS.lng },
  });
  worksiteId = ws.id;
  const v = await prisma.vehicle.create({
    data: { brand: 'Test', model: 'Van', plate: 'TEST-1', source: 'test', fuelConsoL100: 8, fuelPricePerL: 1.75 },
  });
  vehicleId = v.id;

  const day = (d: string, h: number) => new Date(`${d}T0${h}:00:00.000Z`);
  await prisma.planningEvent.createMany({
    data: [
      { worksiteId, vehicleId, startAt: day('2026-03-02', 8), endAt: day('2026-03-02', 9) },
      // même jour, même véhicule -> ne compte pas un 2e aller-retour
      { worksiteId, vehicleId, startAt: day('2026-03-02', 9), endAt: day('2026-03-02', 9) },
      { worksiteId, vehicleId, startAt: day('2026-03-03', 8), endAt: day('2026-03-03', 9) },
    ],
  });
});

after(async () => {
  await prisma.planningEvent.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  if (prevDepot === null) await prisma.setting.deleteMany({ where: { key: 'depot' } });
  else await prisma.setting.update({ where: { key: 'depot' }, data: { value: prevDepot as object } });
});

test('worksiteTransport : un aller-retour par jour, coût = km A/R × €/km', async () => {
  const t = await worksiteTransport(worksiteId);
  assert.equal(t.trips.length, 2, '2 jours distincts -> 2 trajets');
  assert.equal(t.note, null);

  const oneWayKm = Math.round((distanceMeters(DEPOT.lat, DEPOT.lng, WS.lat, WS.lng) / 1000) * 1.4 * 100) / 100;
  const perKm = (8 / 100) * 1.75; // 0.14
  const expectedPerTrip = Math.round(oneWayKm * 2 * perKm * 100) / 100;
  assert.equal(t.trips[0]!.roundTripKm, Math.round(oneWayKm * 2 * 100) / 100);
  assert.equal(t.trips[0]!.costPerKm, 0.14);
  assert.equal(t.cost, Math.round(expectedPerTrip * 2 * 100) / 100);
});

test('worksiteTransport : pas de point GPS chantier -> coût 0 + note', async () => {
  await prisma.worksite.update({ where: { id: worksiteId }, data: { lat: null, lng: null } });
  const t = await worksiteTransport(worksiteId);
  assert.equal(t.cost, 0);
  assert.match(t.note ?? '', /géolocalis/i);
  await prisma.worksite.update({ where: { id: worksiteId }, data: { lat: WS.lat, lng: WS.lng } });
});

test('la marge chantier intègre le coût transport', async () => {
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.ok(m!.vehicleCost > 0);
  assert.equal(m!.transport.trips.length, 2);
});

test('getDepot renvoie le facteur routier par défaut si absent', async () => {
  const d = await getDepot();
  assert.ok(d.roadFactor >= 1);
});
