import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { normalizePhone, resolveLoginEmail, loginLabel } from '@jjd/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';

let server: Server;
let base = '';
const GSM = '+32 499 00 11 22';
const email = '32499001122@gsm.invalid';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  await prisma.user.deleteMany({ where: { email } });
  await prisma.user.create({ data: { email, passwordHash: await hashPassword('123456'), role: 'worker' } });
});
after(async () => { await prisma.user.deleteMany({ where: { email } }); server.close(); });

const login = (identifier: string, password: string) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identifier, password }),
});

test('normalisation des numéros de GSM', () => {
  for (const v of ['0499 00 11 22', '+32 499 00 11 22', '0032499001122', '0499/00.11.22']) assert.equal(normalizePhone(v), '32499001122', v);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('123'), null);
  assert.equal(resolveLoginEmail('Jean@X.be'), 'jean@x.be');
  assert.equal(loginLabel(email), GSM.replace('+32 499', '+32 499'));
});

test('connexion par GSM + code (différents formats), refus du mauvais code', async () => {
  for (const id of [GSM, '0499001122', '0499 00 11 22']) {
    const r = await login(id, '123456');
    assert.equal(r.status, 200, id);
    assert.ok((await r.json()).token);
  }
  assert.equal((await login('0499001122', '000000')).status, 401);
  assert.equal((await login('0499999999', '123456')).status, 401);
});

test('verrouillage après trop d’essais ratés', async () => {
  const id = '0499 55 66 77';
  for (let i = 0; i < 8; i++) assert.equal((await login(id, 'x')).status, 401);
  assert.equal((await login(id, 'x')).status, 429);
});
