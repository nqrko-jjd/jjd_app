import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let officeToken = '';
let workerToken = '';
let worksiteId = '';

async function login(email: string, password = 'jjd'): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).token;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  officeToken = await login('melvina@jjd-consult.be');
  workerToken = await login('ouvrier@jjd-consult.be');

  const ws = await prisma.worksite.create({ data: { ref: 'R-WA-TEST', title: 'Accès ouvrier — test', source: 'test' } });
  worksiteId = ws.id;
  await prisma.document.create({
    data: { worksiteId, kind: 'invoice', direction: 'sale', status: 'sent', totalHt: 1234, source: 'test' },
  });
});

after(async () => {
  await prisma.document.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test('GET /api/worksites/:id : un ouvrier ne voit ni les devis/factures ni la rentabilité', async () => {
  const r = await fetch(`${base}/api/worksites/${worksiteId}`, { headers: { authorization: `Bearer ${workerToken}` } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.worksite.documents, []);
  assert.equal(body.margin, null);
});

test('GET /api/worksites/:id : le bureau voit bien les devis/factures et la rentabilité', async () => {
  const r = await fetch(`${base}/api/worksites/${worksiteId}`, { headers: { authorization: `Bearer ${officeToken}` } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.worksite.documents.length, 1);
  assert.ok(body.margin);
});

test('PATCH /api/worksites/:id : propriétaire/locataire (contacts propres à l’intervention) persistés', async () => {
  const patch = await fetch(`${base}/api/worksites/${worksiteId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${officeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ownerName: 'M. Dupont', ownerPhone: '0470 11 22 33',
      tenantName: 'Mme Martin', tenantPhone: '0470 44 55 66', tenantPhone2: '0470 77 88 99',
    }),
  });
  assert.equal(patch.status, 200);

  const r = await fetch(`${base}/api/worksites/${worksiteId}`, { headers: { authorization: `Bearer ${officeToken}` } });
  const body = await r.json();
  assert.equal(body.worksite.ownerName, 'M. Dupont');
  assert.equal(body.worksite.tenantPhone2, '0470 77 88 99');

  const field = await (await fetch(`${base}/api/worksites/${worksiteId}/field`, { headers: { authorization: `Bearer ${workerToken}` } })).json();
  assert.deepEqual(field.owner, { name: 'M. Dupont', phone: '0470 11 22 33', email: null });
  assert.equal(field.tenant.phone2, '0470 77 88 99');
});

test('PATCH /api/worksites/:id : portée/facturation (informatif, modifiable à tout moment) persistés', async () => {
  const patch = await fetch(`${base}/api/worksites/${worksiteId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${officeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'intervention', billingMode: 'regie' }),
  });
  assert.equal(patch.status, 200);
  let body = await patch.json();
  assert.equal(body.worksite.scope, 'intervention');
  assert.equal(body.worksite.billingMode, 'regie');

  // une intervention peut grandir en cours de route et basculer en devis — jamais figé
  const grown = await fetch(`${base}/api/worksites/${worksiteId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${officeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'long_term', billingMode: 'devis' }),
  });
  body = await grown.json();
  assert.equal(body.worksite.scope, 'long_term');
  assert.equal(body.worksite.billingMode, 'devis');
});


test('linked worksite contacts follow directory edits while legacy coordinates survive', async () => {
  const person = await prisma.contact.create({ data: { name: 'Resident link test', normalizedName: 'resident link test', phone: '010000000', source: 'test' } });
  const headers = { authorization: `Bearer ${officeToken}`, 'content-type': 'application/json' };
  const patch = await fetch(`${base}/api/worksites/${worksiteId}`, { method: 'PATCH', headers, body: JSON.stringify({ contacts: [{ contactId: person.id, name: 'Outdated', role: 'locataire', unitLabel: 'D02', contactFor: 'rdv_acces' }] }) });
  assert.equal(patch.status, 200);
  await prisma.contact.update({ where: { id: person.id }, data: { phone: '020000000' } });
  const detail = await (await fetch(`${base}/api/worksites/${worksiteId}`, { headers })).json();
  assert.equal(detail.worksite.contacts[0].phone, '020000000');
  assert.equal(detail.worksite.contacts[0].name, person.name);
  assert.equal(detail.worksite.contacts[0].unitLabel, 'D02');
  const field = await (await fetch(`${base}/api/worksites/${worksiteId}/field`, { headers: { authorization: `Bearer ${workerToken}` } })).json();
  assert.equal(field.contacts[0].phone, '020000000');
  const bad = await fetch(`${base}/api/worksites/${worksiteId}`, { method: 'PATCH', headers, body: JSON.stringify({ contacts: [{ contactId: 'missing-person', name: 'Unknown', role: 'locataire' }] }) });
  assert.equal(bad.status, 400);
  assert.equal(await prisma.worksiteContact.count({ where: { worksiteId, contactId: person.id } }), 1);
  const removal = await fetch(`${base}/api/contacts/${person.id}`, { method: 'DELETE', headers });
  assert.equal(removal.status, 409);
  await prisma.contact.delete({ where: { id: person.id } });
  const retained = await prisma.worksiteContact.findFirstOrThrow({ where: { worksiteId } });
  assert.equal(retained.contactId, null);
  assert.equal(retained.name, person.name);
});
