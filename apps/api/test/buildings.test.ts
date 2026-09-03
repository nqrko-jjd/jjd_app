import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let buildingId = '';

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
        body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  const b = await prisma.building.create({ data: { name: 'Test Algarve', normalizedName: 'test algarve', source: 'test' } });
  buildingId = b.id;
});

after(async () => {
  await prisma.building.deleteMany({ where: { source: 'test' } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

test('immeuble : contacts clés + lots/occupants', async () => {
  const c = await fetch(`${base}/api/buildings/${buildingId}/contacts`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ role: 'concierge', name: 'M. Da Silva', phone: '0470 11 22 33' }),
  });
  assert.equal(c.status, 201);

  const u = await fetch(`${base}/api/buildings/${buildingId}/units`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ label: 'C1', floor: '1er étage', door: 'App C', occupantName: 'Mme Pinto', occupantKind: 'owner' }),
  });
  assert.equal(u.status, 201);
  const unitId = (await u.json()).unit.id;

  const detail = await (await fetch(`${base}/api/buildings/${buildingId}`, { headers: auth() })).json();
  assert.equal(detail.building.contacts.length, 1);
  assert.equal(detail.building.contacts[0].role, 'concierge');
  assert.equal(detail.building.units[0].occupantName, 'Mme Pinto');

  const patch = await fetch(`${base}/api/buildings/${buildingId}/units/${unitId}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ occupantPhone: '0475 99 88 77' }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).unit.occupantPhone, '0475 99 88 77');

  const del = await fetch(`${base}/api/buildings/${buildingId}/units/${unitId}`, { method: 'DELETE', headers: auth() });
  assert.equal(del.status, 200);
});

test('immeuble : champs ACP éditables', async () => {
  const r = await fetch(`${base}/api/buildings/${buildingId}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ reference: 'ACP-2024-17', lotCount: 24, digicode: 'A1234' }),
  });
  assert.equal(r.status, 200);
  const b = (await r.json()).building;
  assert.equal(b.reference, 'ACP-2024-17');
  assert.equal(b.lotCount, 24);
});
