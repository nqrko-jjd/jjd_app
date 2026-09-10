import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let staffToken = '';
let portalToken = '';
let wsId = '';
let contactId = '';
let userId = '';

// PNG 1×1 rouge
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
  staffToken = (await login.json()).token;

  const contact = await prisma.contact.create({ data: { name: 'Client Test Thread', normalizedName: 'client test thread', type: 'client', source: 'test' } });
  contactId = contact.id;
  const ws = await prisma.worksite.create({ data: { ref: 'R-THREADCLIENT', title: 'Thread client test', clientId: contact.id, source: 'test' } });
  wsId = ws.id;
  const user = await prisma.user.create({ data: { email: 'test-client-thread@portal.test', passwordHash: 'x', role: 'client', contactId: contact.id } });
  userId = user.id;

  const link = await (
    await fetch(`${base}/api/portal/request-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'test-client-thread@portal.test' }),
    })
  ).json();
  const verify = await (
    await fetch(`${base}/api/portal/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: link.devToken }),
    })
  ).json();
  portalToken = verify.token;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
  await prisma.message.deleteMany({ where: { thread: { worksiteId: wsId } } });
  await prisma.thread.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.loginToken.deleteMany({ where: { email: 'test-client-thread@portal.test' } });
  await prisma.contact.deleteMany({ where: { id: contactId } });
  server.close();
});

const staffAuth = () => ({ authorization: `Bearer ${staffToken}` });
const portalAuth = () => ({ authorization: `Bearer ${portalToken}` });

test('un message interne (staff) n’apparaît pas dans le fil vu par le client', async () => {
  const post = await fetch(`${base}/api/worksites/${wsId}/thread/messages`, {
    method: 'POST',
    headers: { ...staffAuth(), 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Discussion interne — pas pour le client' }),
  });
  assert.equal(post.status, 201);

  const portalView = await (await fetch(`${base}/api/portal/worksites/${wsId}`, { headers: portalAuth() })).json();
  assert.ok(!portalView.messages.some((m: { body: string }) => m.body === 'Discussion interne — pas pour le client'));
});

test('un message du client n’apparaît pas dans le fil interne mais dans l’onglet Client du bureau', async () => {
  const post = await fetch(`${base}/api/portal/worksites/${wsId}/messages`, {
    method: 'POST',
    headers: { ...portalAuth(), 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Bonjour, une question sur les travaux' }),
  });
  assert.equal(post.status, 201);

  const internal = await (await fetch(`${base}/api/worksites/${wsId}/thread`, { headers: staffAuth() })).json();
  assert.ok(!internal.messages.some((m: { body: string }) => m.body === 'Bonjour, une question sur les travaux'));

  const clientView = await (await fetch(`${base}/api/worksites/${wsId}/thread/client`, { headers: staffAuth() })).json();
  assert.ok(clientView.messages.some((m: { body: string }) => m.body === 'Bonjour, une question sur les travaux'));
});

test('le bureau répond au client depuis l’app -> visible côté portail', async () => {
  const post = await fetch(`${base}/api/worksites/${wsId}/thread/client/messages`, {
    method: 'POST',
    headers: { ...staffAuth(), 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Bonjour, on regarde ça cette semaine' }),
  });
  assert.equal(post.status, 201);

  const portalView = await (await fetch(`${base}/api/portal/worksites/${wsId}`, { headers: portalAuth() })).json();
  const msg = portalView.messages.find((m: { body: string }) => m.body === 'Bonjour, on regarde ça cette semaine');
  assert.ok(msg);
  assert.equal(msg.fromClient, false);
});

test('une photo interne reste privée tant qu’elle n’est pas partagée', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const up = await fetch(`${base}/api/worksites/${wsId}/thread/photos`, { method: 'POST', headers: staffAuth(), body: form });
  assert.equal(up.status, 201);
  const msgId = (await up.json()).message.id as string;

  const before1 = await (await fetch(`${base}/api/portal/worksites/${wsId}`, { headers: portalAuth() })).json();
  assert.equal(before1.photos.length, 0);

  const share = await fetch(`${base}/api/worksites/${wsId}/thread/messages/${msgId}/share`, {
    method: 'PATCH',
    headers: { ...staffAuth(), 'content-type': 'application/json' },
    body: JSON.stringify({ shared: true }),
  });
  assert.equal(share.status, 200);

  const after1 = await (await fetch(`${base}/api/portal/worksites/${wsId}`, { headers: portalAuth() })).json();
  assert.equal(after1.photos.length, 1);
});

test('POST /invoice : crée une dépense brouillon "chat" liée au chantier', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'facture.png');
  const up = await fetch(`${base}/api/worksites/${wsId}/thread/invoice`, { method: 'POST', headers: staffAuth(), body: form });
  assert.equal(up.status, 201);
  const body = await up.json();
  assert.ok(body.expenseId);

  const expense = await prisma.ledgerEntry.findUnique({ where: { id: body.expenseId } });
  assert.equal(expense?.source, 'chat');
  assert.equal(expense?.worksiteId, wsId);
  assert.equal(expense?.direction, 'purchase');
  assert.equal(expense?.paymentStatus, 'Non payé');

  const list = await (await fetch(`${base}/api/finance/expenses?worksiteId=${wsId}`, { headers: staffAuth() })).json();
  assert.ok(list.items.some((e: { id: string }) => e.id === body.expenseId));
});

test('rattrapage : bascule les messages historiques du portail (sans authorId/source, kind text) en audience client', async () => {
  const thread = await prisma.thread.findUnique({ where: { worksiteId: wsId } });
  const historic = await prisma.message.create({
    data: { threadId: thread!.id, authorName: 'Ancien client', kind: 'text', body: 'Message historique du portail', audience: 'internal' },
  });
  const internalOne = await prisma.message.create({
    data: { threadId: thread!.id, authorId: userId, authorName: 'Staff', kind: 'text', body: 'Message interne avec auteur', audience: 'internal' },
  });

  const r = await prisma.message.updateMany({
    where: { audience: 'internal', authorId: null, source: null, kind: 'text' },
    data: { audience: 'client' },
  });
  assert.ok(r.count >= 1);

  const h = await prisma.message.findUnique({ where: { id: historic.id } });
  assert.equal(h?.audience, 'client');
  const i = await prisma.message.findUnique({ where: { id: internalOne.id } });
  assert.equal(i?.audience, 'internal');
});
