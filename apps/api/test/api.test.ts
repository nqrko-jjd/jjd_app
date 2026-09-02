import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';

let server: Server;
let base = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});
after(() => server.close());

test('health', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('login david + dashboard', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  assert.equal(login.status, 200);
  const { token, user } = await login.json();
  assert.ok(token);
  assert.equal(user.isPartner, true);

  const dash = await fetch(`${base}/api/dashboard`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(dash.status, 200);
  const body = await dash.json();
  assert.ok('kpis' in body && 'alerts' in body);
});

test('dashboard refusé sans token', async () => {
  const r = await fetch(`${base}/api/dashboard`);
  assert.equal(r.status, 401);
});

test('mauvais mot de passe -> 401', async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'nope' }),
  });
  assert.equal(r.status, 401);
});
