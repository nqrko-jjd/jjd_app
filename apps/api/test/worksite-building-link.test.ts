import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let buildingId = '';
let otherBuildingId = '';
let contactId = '';
const worksiteIds: string[] = [];

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await login.json()).token;

  const building = await prisma.building.create({ data: { name: 'ACP Test Bonaventure', normalizedName: 'acp test bonaventure', source: 'test' } });
  buildingId = building.id;
  const other = await prisma.building.create({ data: { name: 'ACP Autre Immeuble', normalizedName: 'acp autre immeuble', source: 'test' } });
  otherBuildingId = other.id;
  const contact = await prisma.contact.create({
    data: { name: 'ACP Test Bonaventure', normalizedName: 'acp test bonaventure', type: 'client', kind: 'acp', buildingId, source: 'test' },
  });
  contactId = contact.id;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { id: { in: worksiteIds } } });
  await prisma.contact.deleteMany({ where: { id: contactId } });
  await prisma.building.deleteMany({ where: { id: { in: [buildingId, otherBuildingId] } } });
  server.close();
});

test('POST /api/worksites : buildingId dérivé du client facturé quand celui-ci est lié à un immeuble', async () => {
  const r = await fetch(`${base}/api/worksites`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ title: 'Etanchéité fondations', clientId: contactId }),
  });
  assert.equal(r.status, 201);
  const { worksite } = await r.json();
  worksiteIds.push(worksite.id);
  assert.equal(worksite.buildingId, buildingId);
});

test('PATCH /api/worksites/:id : buildingId dérivé si absent, jamais écrasé si déjà posé', async () => {
  const noBuilding = await prisma.worksite.create({ data: { ref: 'R-BLTEST-1', title: 'Sans immeuble', source: 'test' } });
  worksiteIds.push(noBuilding.id);
  const patch1 = await fetch(`${base}/api/worksites/${noBuilding.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ clientId: contactId }),
  });
  assert.equal(patch1.status, 200);
  assert.equal((await patch1.json()).worksite.buildingId, buildingId);

  const alreadyLinked = await prisma.worksite.create({ data: { ref: 'R-BLTEST-2', title: 'Déjà lié ailleurs', buildingId: otherBuildingId, source: 'test' } });
  worksiteIds.push(alreadyLinked.id);
  const patch2 = await fetch(`${base}/api/worksites/${alreadyLinked.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ clientId: contactId }),
  });
  assert.equal(patch2.status, 200);
  assert.equal((await patch2.json()).worksite.buildingId, otherBuildingId); // pas écrasé
});
