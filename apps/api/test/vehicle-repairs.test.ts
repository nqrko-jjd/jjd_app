import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let vehicleId = '';

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
  const veh = await prisma.vehicle.create({ data: { brand: 'Test', model: 'Réparation', source: 'test' } });
  vehicleId = veh.id;
});

after(async () => {
  await prisma.vehicleRepair.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('réparations véhicule : créer, modifier, supprimer', async () => {
  const create = await fetch(`${base}/api/vehicles/${vehicleId}/repairs`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-09-10', description: 'Plaquettes de frein', garage: 'Garage Dupont', amount: 240.5, km: '128000' }),
  });
  assert.equal(create.status, 201);
  const { repair } = await create.json();
  assert.equal(repair.description, 'Plaquettes de frein');
  assert.equal(repair.garage, 'Garage Dupont');
  assert.equal(repair.amount, 240.5);

  const patch = await fetch(`${base}/api/vehicles/${vehicleId}/repairs/${repair.id}`, {
    method: 'PATCH',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 260 }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).repair.amount, 260);

  const del = await fetch(`${base}/api/vehicles/${vehicleId}/repairs/${repair.id}`, { method: 'DELETE', headers: auth() });
  assert.equal(del.status, 204);
  const remaining = await prisma.vehicleRepair.findUnique({ where: { id: repair.id } });
  assert.equal(remaining, null);
});

test('réparations véhicule : le détail du véhicule les renvoie, triées récentes d’abord', async () => {
  await prisma.vehicleRepair.create({ data: { vehicleId, date: new Date('2026-01-05'), description: 'Ancienne', amount: 50 } });
  await prisma.vehicleRepair.create({ data: { vehicleId, date: new Date('2026-08-20'), description: 'Récente', amount: 90 } });
  const r = await fetch(`${base}/api/vehicles/${vehicleId}`, { headers: auth() });
  assert.equal(r.status, 200);
  const { vehicle } = await r.json();
  assert.equal(vehicle.repairs.length, 2);
  assert.equal(vehicle.repairs[0].description, 'Récente');
});
