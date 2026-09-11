import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
const createdIds: string[] = [];

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
});

after(async () => {
  await prisma.vehicle.deleteMany({ where: { id: { in: createdIds } } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

test('POST /api/vehicles : crée un véhicule (statut par défaut "active", source "manual")', async () => {
  const r = await fetch(`${base}/api/vehicles`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ brand: 'Renault', model: 'Master', plate: '1-TEST-001' }),
  });
  assert.equal(r.status, 201);
  const { vehicle } = await r.json();
  createdIds.push(vehicle.id);
  assert.equal(vehicle.brand, 'Renault');
  assert.equal(vehicle.status, 'active');

  const stored = await prisma.vehicle.findUnique({ where: { id: vehicle.id } });
  assert.equal(stored?.source, 'manual');
});

test('POST /api/vehicles : refuse un code interne déjà utilisé', async () => {
  const first = await fetch(`${base}/api/vehicles`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ code: 'V-TEST-DUP', brand: 'A' }),
  });
  const { vehicle } = await first.json();
  createdIds.push(vehicle.id);

  const dup = await fetch(`${base}/api/vehicles`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ code: 'V-TEST-DUP', brand: 'B' }),
  });
  assert.equal(dup.status, 409);
});
