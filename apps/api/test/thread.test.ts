import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';

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
  const ws = await prisma.worksite.create({ data: { ref: 'R-THREADTEST', title: 'Thread test', source: 'test' } });
  wsId = ws.id;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { source: 'test' } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('fil : créé à la demande, message posté, clôture -> statut done', async () => {
  const g = await fetch(`${base}/api/worksites/${wsId}/thread`, { headers: auth() });
  assert.equal(g.status, 200);
  const first = await g.json();
  assert.equal(first.messages.length, 0);

  const post = await fetch(`${base}/api/worksites/${wsId}/thread/messages`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'On démarre demain' }),
  });
  assert.equal(post.status, 201);
  assert.equal((await post.json()).message.authorName, 'David');

  const close = await fetch(`${base}/api/worksites/${wsId}/thread/close`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(close.status, 200);

  const ws = await prisma.worksite.findUnique({ where: { id: wsId } });
  assert.equal(ws?.status, 'done');
  const after2 = await (await fetch(`${base}/api/worksites/${wsId}/thread`, { headers: auth() })).json();
  assert.equal(after2.thread.closedAt !== null, true);
  assert.ok(after2.messages.some((m: { kind: string }) => m.kind === 'status'));
});

test('message vide -> 422', async () => {
  const r = await fetch(`${base}/api/worksites/${wsId}/thread/messages`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ body: '  ' }),
  });
  assert.equal(r.status, 422);
});
