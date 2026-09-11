import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let adminToken = '';
let officeToken = '';
let adminUserId = '';
let targetUserId = '';

async function login(email: string): Promise<{ token: string; userId: string }> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'jjd' }),
  });
  const body = await r.json();
  return { token: body.token, userId: body.user.id };
}

const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const admin = await login('david@jjd-consult.be');
  adminToken = admin.token;
  adminUserId = admin.userId;
  officeToken = (await login('melvina@jjd-consult.be')).token;

  await prisma.user.deleteMany({ where: { email: 'users-test-target@jjd-consult.be' } });
  const target = await prisma.user.create({
    data: { email: 'users-test-target@jjd-consult.be', passwordHash: 'x', role: 'worker' },
  });
  targetUserId = target.id;
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: targetUserId } });
  server.close();
});

test('GET /api/users : réservé aux admins', async () => {
  const r = await fetch(`${base}/api/users`, { headers: auth(officeToken) });
  assert.equal(r.status, 403);
});

test('GET /api/users : un admin voit la liste, avec le libellé du compte de test', async () => {
  const r = await fetch(`${base}/api/users`, { headers: auth(adminToken) });
  assert.equal(r.status, 200);
  const body = await r.json();
  const row = body.items.find((u: { id: string }) => u.id === targetUserId);
  assert.ok(row);
  assert.equal(row.role, 'worker');
});

test('PATCH /api/users/:id : change le rôle', async () => {
  const r = await fetch(`${base}/api/users/${targetUserId}`, { method: 'PATCH', headers: auth(adminToken), body: JSON.stringify({ role: 'foreman' }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.role, 'foreman');
});

test('PATCH /api/users/:id : refuse de désactiver/changer son propre rôle', async () => {
  const r = await fetch(`${base}/api/users/${adminUserId}`, { method: 'PATCH', headers: auth(adminToken), body: JSON.stringify({ active: false }) });
  assert.equal(r.status, 409);
});

test('POST /api/users/:id/reset-password : renvoie un nouveau mot de passe utilisable pour se connecter', async () => {
  const r = await fetch(`${base}/api/users/${targetUserId}/reset-password`, { method: 'POST', headers: auth(adminToken) });
  assert.equal(r.status, 200);
  const { email, password } = await r.json();
  const loginCheck = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginCheck.status, 200);
});

test('DELETE /api/users/:id : refuse de se supprimer soi-même, mais supprime un autre compte', async () => {
  const self = await fetch(`${base}/api/users/${adminUserId}`, { method: 'DELETE', headers: auth(adminToken) });
  assert.equal(self.status, 409);

  const other = await fetch(`${base}/api/users/${targetUserId}`, { method: 'DELETE', headers: auth(adminToken) });
  assert.equal(other.status, 204);
  assert.equal(await prisma.user.findUnique({ where: { id: targetUserId } }), null);
});
