import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let contactId = '';
let otherAcpId = '';
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

  // "immeuble" = Contact de kind 'acp' (fusion Contact/Immeuble) — un chantier facturé
  // directement à ce contact dérive son `acpId` sur ce même contact.
  const contact = await prisma.contact.create({
    data: { name: 'ACP Test Bonaventure', normalizedName: 'acp test bonaventure', type: 'client', kind: 'acp', source: 'test' },
  });
  contactId = contact.id;
  const other = await prisma.contact.create({
    data: { name: 'ACP Autre Immeuble', normalizedName: 'acp autre immeuble', type: 'client', kind: 'acp', source: 'test' },
  });
  otherAcpId = other.id;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { id: { in: worksiteIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: [contactId, otherAcpId] } } });
  server.close();
});

test('POST /api/worksites : acpId dérivé du client facturé quand celui-ci est une ACP', async () => {
  const r = await fetch(`${base}/api/worksites`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ title: 'Etanchéité fondations', clientId: contactId }),
  });
  assert.equal(r.status, 201);
  const { worksite } = await r.json();
  worksiteIds.push(worksite.id);
  assert.equal(worksite.acpId, contactId);
});

test('PATCH /api/worksites/:id : acpId dérivé si absent, jamais écrasé si déjà posé', async () => {
  const noBuilding = await prisma.worksite.create({ data: { ref: 'R-BLTEST-1', title: 'Sans immeuble', source: 'test' } });
  worksiteIds.push(noBuilding.id);
  const patch1 = await fetch(`${base}/api/worksites/${noBuilding.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ clientId: contactId }),
  });
  assert.equal(patch1.status, 200);
  assert.equal((await patch1.json()).worksite.acpId, contactId);

  const alreadyLinked = await prisma.worksite.create({ data: { ref: 'R-BLTEST-2', title: 'Déjà lié ailleurs', acpId: otherAcpId, source: 'test' } });
  worksiteIds.push(alreadyLinked.id);
  const patch2 = await fetch(`${base}/api/worksites/${alreadyLinked.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ clientId: contactId }),
  });
  assert.equal(patch2.status, 200);
  assert.equal((await patch2.json()).worksite.acpId, otherAcpId); // pas écrasé
});
