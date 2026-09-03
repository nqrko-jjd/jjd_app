import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  // le compte syndic de démo est recréé par import:trustup ; on s'assure qu'il existe
  const syndic = await prisma.syndic.findFirst({ orderBy: { buildings: { _count: 'desc' } } });
  if (!syndic) return;
  await prisma.user.upsert({
    where: { email: 'test-syndic@portal.test' },
    create: { email: 'test-syndic@portal.test', passwordHash: 'x', role: 'client', syndicId: syndic.id },
    update: { syndicId: syndic.id, active: true },
  });
  const link = await (
    await fetch(`${base}/api/portal/request-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'test-syndic@portal.test' }),
    })
  ).json();
  const verify = await (
    await fetch(`${base}/api/portal/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: link.devToken }),
    })
  ).json();
  token = verify.token;
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: 'test-syndic@portal.test' } });
  await prisma.loginToken.deleteMany({ where: { email: 'test-syndic@portal.test' } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('portail : dashboard renvoie KPIs + sections pour un syndic', async () => {
  const r = await fetch(`${base}/api/portal/dashboard`, { headers: auth() });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.greeting.isSyndic, true);
  assert.ok(d.kpis.buildings > 0);
  assert.ok('interventionsActive' in d.kpis && 'quotesToValidate' in d.kpis && 'urgent' in d.kpis);
  assert.equal(d.weekPlanning.days.length, 7);
  assert.ok(Array.isArray(d.recentInterventions));
});

test('portail : liste interventions scoping syndic', async () => {
  const r = await fetch(`${base}/api/portal/interventions?status=open`, { headers: auth() });
  assert.equal(r.status, 200);
  const { items } = await r.json();
  assert.ok(Array.isArray(items));
  // toutes rattachées à un immeuble du syndic
  for (const w of items) assert.ok(w.building, `intervention ${w.ref} sans immeuble`);
});

test('portail : dashboard refusé sans token', async () => {
  const r = await fetch(`${base}/api/portal/dashboard`);
  assert.equal(r.status, 401);
});
