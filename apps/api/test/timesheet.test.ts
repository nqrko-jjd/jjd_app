import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let davidToken = '';
let workerToken = '';
let worksiteId = '';
let testPersonId = '';
let originalWorkerPersonId: string | null = null;

async function login(email: string) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'jjd' }),
  });
  return (await r.json()).token as string;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  davidToken = await login('david@jjd-consult.be');

  // lie un compte ouvrier à une fiche personne avec un taux (lien d'origine restauré après)
  const originalUser = await prisma.user.findUnique({ where: { email: 'ouvrier@jjd-consult.be' } });
  originalWorkerPersonId = originalUser?.personId ?? null;
  const person = await prisma.person.create({
    data: { firstName: 'Test', displayName: 'Test Ouvrier', normalizedName: 'test ouvrier', role: 'worker', hourlyRate: 20, source: 'test' },
  });
  testPersonId = person.id;
  await prisma.user.update({ where: { email: 'ouvrier@jjd-consult.be' }, data: { personId: person.id } });
  workerToken = await login('ouvrier@jjd-consult.be');

  const ws = await prisma.worksite.findFirst({ where: { source: 'xlsx' } });
  worksiteId = ws?.id ?? (await prisma.worksite.create({ data: { ref: 'R-TEST', title: 'Test', source: 'test' } })).id;
});

after(async () => {
  await prisma.timeEntry.deleteMany({ where: { source: { in: ['timer', 'test', 'manual'] } } });
  await prisma.user.updateMany({ where: { email: 'ouvrier@jjd-consult.be' }, data: { personId: originalWorkerPersonId } });
  if (testPersonId) await prisma.person.deleteMany({ where: { id: testPersonId } });
  await prisma.worksite.deleteMany({ where: { ref: 'R-TEST', source: 'test' } });
  server.close();
});

test('compteur : start -> stop calcule les heures et le montant', async () => {
  const started = new Date(Date.now() - 2 * 3600_000).toISOString(); // il y a 2 h
  const s = await fetch(`${base}/api/timesheet/timer/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({ worksiteId, startedAt: started }),
  });
  assert.equal(s.status, 201);

  const stop = await fetch(`${base}/api/timesheet/timer/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({}),
  });
  assert.equal(stop.status, 200);
  const { entry } = await stop.json();
  assert.ok(Math.abs(entry.hours - 2) < 0.05);
  assert.ok(Math.abs(entry.amount - 40) < 1);
  assert.equal(entry.status, 'submitted');
});

test('un 2e start pendant qu\'un compteur tourne -> 409', async () => {
  await fetch(`${base}/api/timesheet/timer/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({ worksiteId }),
  });
  const dup = await fetch(`${base}/api/timesheet/timer/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({ worksiteId }),
  });
  assert.equal(dup.status, 409);
  await fetch(`${base}/api/timesheet/timer/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({}),
  });
});

test('géoloc pointage (mode souple) : 1er point fixé, puis hors zone signalé', async () => {
  const geoWs = await prisma.worksite.create({ data: { ref: 'R-GEOTEST', title: 'Geo', source: 'test' } });
  const H = (b: unknown) => ({ method: 'POST' as const, headers: { 'content-type': 'application/json', authorization: `Bearer ${workerToken}` }, body: JSON.stringify(b) });
  const stop = () => fetch(`${base}/api/timesheet/timer/stop`, H({}));

  // 1er pointage sur place -> fixe le point de référence
  const r1 = await fetch(`${base}/api/timesheet/timer/start`, H({ worksiteId: geoWs.id, lat: 50.8467, lng: 4.3525 }));
  assert.equal(r1.status, 201);
  assert.equal((await r1.json()).geoFlag, false);
  await stop();
  const w = await prisma.worksite.findUnique({ where: { id: geoWs.id } });
  assert.ok(w?.lat && w?.lng);

  // pointage à ~5 km -> accepté mais signalé
  const r2 = await fetch(`${base}/api/timesheet/timer/start`, H({ worksiteId: geoWs.id, lat: 50.8949, lng: 4.3416 }));
  assert.equal(r2.status, 201);
  const j2 = await r2.json();
  assert.equal(j2.geoFlag, true);
  assert.ok(j2.geoDistance > 4000);
  await stop();

  await prisma.timeEntry.deleteMany({ where: { worksiteId: geoWs.id } });
  await prisma.worksite.delete({ where: { id: geoWs.id } });
});

test('validation : submitted -> approved par le bureau', async () => {
  const pending = await fetch(`${base}/api/timesheet/pending`, { headers: { authorization: `Bearer ${davidToken}` } });
  const { items } = await pending.json();
  assert.ok(items.length >= 1);
  const ap = await fetch(`${base}/api/timesheet/entries/${items[0].id}/approve`, {
    method: 'POST',
    headers: { authorization: `Bearer ${davidToken}` },
  });
  assert.equal(ap.status, 200);
  assert.equal((await ap.json()).entry.status, 'approved');
});

test('planning : création sans clé Google (dégradation OK)', async () => {
  const r = await fetch(`${base}/api/planning`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${davidToken}` },
    body: JSON.stringify({
      worksiteId,
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  assert.equal(r.status, 201);
  const { event } = await r.json();
  assert.equal(event.worksite.id, worksiteId);
  await prisma.planningEvent.delete({ where: { id: event.id } });
});
