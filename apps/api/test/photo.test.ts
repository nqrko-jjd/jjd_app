import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let personId = '';

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
  token = (
    await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  const p = await prisma.person.create({ data: { firstName: 'Photo', lastName: 'Test', normalizedName: 'photo test', source: 'test' } });
  personId = p.id;
});

after(async () => {
  await prisma.person.deleteMany({ where: { id: personId } });
  server.close();
});

test('photo : upload sur une fiche personne -> photoUrl + thumb, puis suppression', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const up = await fetch(`${base}/api/people/${personId}/photo`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(up.status, 201);
  const body = await up.json();
  assert.match(body.photoUrl, /^\/uploads\/media\/.+\.webp$/);
  assert.ok(body.photoThumbUrl);

  const person = await prisma.person.findUnique({ where: { id: personId } });
  assert.equal(person?.photoUrl, body.photoUrl);

  const del = await fetch(`${base}/api/people/${personId}/photo`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  assert.equal(del.status, 200);
  const after2 = await prisma.person.findUnique({ where: { id: personId } });
  assert.equal(after2?.photoUrl, null);
});

test('photo : refusée pour un ouvrier', async () => {
  const wt = (
    await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ouvrier@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const r = await fetch(`${base}/api/people/${personId}/photo`, { method: 'POST', headers: { authorization: `Bearer ${wt}` }, body: form });
  assert.equal(r.status, 403);
});
