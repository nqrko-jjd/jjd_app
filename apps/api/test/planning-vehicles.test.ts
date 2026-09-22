import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';
let p1 = '';
let p2 = '';
let v1 = '';
let v2 = '';
let eventId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (
    await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  const ws = await prisma.worksite.create({ data: { ref: 'R-PLANVEH-TEST', title: 'Planning multi-véhicules — test', source: 'test' } });
  wsId = ws.id;
  const a = await prisma.person.create({ data: { firstName: 'Driver1', displayName: 'Driver1 Test', normalizedName: 'driver1 test', role: 'worker', source: 'test' } });
  const b = await prisma.person.create({ data: { firstName: 'Driver2', displayName: 'Driver2 Test', normalizedName: 'driver2 test', role: 'worker', source: 'test' } });
  p1 = a.id; p2 = b.id;
  const va = await prisma.vehicle.create({ data: { brand: 'Test', model: 'Van1', source: 'test' } });
  const vb = await prisma.vehicle.create({ data: { brand: 'Test', model: 'Van2', source: 'test' } });
  v1 = va.id; v2 = vb.id;
});

after(async () => {
  if (eventId) await prisma.planningEvent.deleteMany({ where: { id: eventId } });
  await prisma.vehicle.deleteMany({ where: { id: { in: [v1, v2] } } });
  await prisma.person.deleteMany({ where: { id: { in: [p1, p2] } } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('planning : plusieurs véhicules, un conducteur différent par véhicule', async () => {
  const create = await fetch(`${base}/api/planning`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({
      worksiteId: wsId,
      startAt: '2026-09-22T08:30:00.000Z',
      endAt: '2026-09-22T17:00:00.000Z',
      personIds: [p1, p2],
      vehicles: [{ vehicleId: v1, driverPersonId: p1 }, { vehicleId: v2, driverPersonId: p2 }],
    }),
  });
  assert.equal(create.status, 201);
  const { event } = await create.json();
  eventId = event.id;
  assert.equal(event.vehicles.length, 2);
  const byVehicle = Object.fromEntries(event.vehicles.map((v: { vehicle: { id: string }; driver: { id: string } | null }) => [v.vehicle.id, v.driver?.id]));
  assert.equal(byVehicle[v1], p1);
  assert.equal(byVehicle[v2], p2);

  // PATCH : ne garder qu'un véhicule remplace bien la liste (deleteMany + create)
  const patch = await fetch(`${base}/api/planning/${event.id}`, {
    method: 'PATCH',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ vehicles: [{ vehicleId: v2, driverPersonId: null }] }),
  });
  assert.equal(patch.status, 200);
  const after1 = await patch.json();
  assert.equal(after1.event.vehicles.length, 1);
  assert.equal(after1.event.vehicles[0].vehicle.id, v2);
  assert.equal(after1.event.vehicles[0].driver, null);
});
