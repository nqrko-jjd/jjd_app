import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { worksiteTransport, getDepot, vehicleCostBreakdown } from '../src/lib/vehicle-cost.js';
import { worksiteMargin } from '../src/lib/worksite-margin.js';
import { distanceMeters } from '@jjd/shared';

let worksiteId = '';
let vehicleId = '';
let prevDepot: unknown = null;

const DEPOT = { lat: 50.85, lng: 4.35 };
const WS = { lat: 50.90, lng: 4.42 };
const WORK_DAYS = 220;

before(async () => {
  const existing = await prisma.setting.findUnique({ where: { key: 'depot' } });
  prevDepot = existing?.value ?? null;
  const value = { label: 'Test', address: '', postalCode: '', city: '', ...DEPOT, roadFactor: 1.4, workDaysPerYear: WORK_DAYS };
  await prisma.setting.upsert({ where: { key: 'depot' }, create: { key: 'depot', value }, update: { value } });

  const ws = await prisma.worksite.create({
    data: { ref: 'R-VC-TEST', title: 'Transport test', source: 'test', lat: WS.lat, lng: WS.lng },
  });
  worksiteId = ws.id;
  const v = await prisma.vehicle.create({
    data: {
      brand: 'Test', model: 'Van', plate: 'TEST-1', source: 'test',
      fuelConsoL100: 8, fuelPricePerL: 1.75,
      monthlyPayment: 300, circulationTax: 120, parkingMonthly: 80,
      insurances: { create: { monthlyAmount: 40 } },
    },
  });
  vehicleId = v.id;

  const day = (d: string, h: number) => new Date(`${d}T0${h}:00:00.000Z`);
  await prisma.planningEvent.createMany({
    data: [
      { worksiteId, vehicleId, startAt: day('2026-03-02', 8), endAt: day('2026-03-02', 9) },
      // même jour, même véhicule -> pas de 2e aller-retour
      { worksiteId, vehicleId, startAt: day('2026-03-02', 9), endAt: day('2026-03-02', 9) },
      { worksiteId, vehicleId, startAt: day('2026-03-03', 8), endAt: day('2026-03-03', 9) },
    ],
  });
});

after(async () => {
  await prisma.planningEvent.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await prisma.insurance.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  if (prevDepot === null) await prisma.setting.deleteMany({ where: { key: 'depot' } });
  else await prisma.setting.update({ where: { key: 'depot' }, data: { value: prevDepot as object } });
});

test('vehicleCostBreakdown : coût fixe mensuel = assur + financement + taxe + parking', async () => {
  const b = await vehicleCostBreakdown(vehicleId);
  assert.ok(b);
  assert.equal(b!.fixed.insurance, 40);
  assert.equal(b!.fixed.financing, 300);
  assert.equal(b!.fixed.tax, 10); // 120 / 12
  assert.equal(b!.fixed.parking, 80);
  assert.equal(b!.fixed.monthly, 430);
  assert.equal(b!.fixed.perDay, Math.round((430 * 12 / WORK_DAYS) * 100) / 100); // 23.45
});

test('worksiteTransport : un jour = 1 A/R carburant + 1 quote-part fixe', async () => {
  const t = await worksiteTransport(worksiteId);
  assert.equal(t.trips.length, 2, '2 jours distincts');
  assert.equal(t.note, null);

  const oneWayKm = Math.round((distanceMeters(DEPOT.lat, DEPOT.lng, WS.lat, WS.lng) / 1000) * 1.4 * 100) / 100;
  const fuelPerTrip = Math.round(oneWayKm * 2 * 0.14 * 100) / 100;
  const fixedPerDay = Math.round((430 * 12 / WORK_DAYS) * 100) / 100;
  assert.equal(t.trips[0]!.roundTripKm, Math.round(oneWayKm * 2 * 100) / 100);
  assert.equal(t.trips[0]!.fuelCost, fuelPerTrip);
  assert.equal(t.trips[0]!.fixedCost, fixedPerDay);
  assert.equal(t.fuelCost, Math.round(fuelPerTrip * 2 * 100) / 100);
  assert.equal(t.fixedCost, Math.round(fixedPerDay * 2 * 100) / 100);
  assert.equal(t.cost, Math.round((t.fuelCost + t.fixedCost) * 100) / 100);
});

test('worksiteTransport : pas de GPS -> coûts fixes seulement + note', async () => {
  await prisma.worksite.update({ where: { id: worksiteId }, data: { lat: null, lng: null } });
  const t = await worksiteTransport(worksiteId);
  assert.equal(t.fuelCost, 0);
  assert.ok(t.fixedCost > 0, 'les coûts fixes restent imputés sans géoloc');
  assert.match(t.note ?? '', /géolocalis/i);
  await prisma.worksite.update({ where: { id: worksiteId }, data: { lat: WS.lat, lng: WS.lng } });
});

test('la marge chantier intègre le coût véhicule', async () => {
  const m = await worksiteMargin(worksiteId);
  assert.ok(m);
  assert.ok(m!.vehicleCost > 0);
  assert.equal(m!.transport.trips.length, 2);
});

test('getDepot : valeurs par défaut si réglage absent', async () => {
  const d = await getDepot();
  assert.ok(d.roadFactor >= 1);
  assert.ok(d.workDaysPerYear >= 120);
});
