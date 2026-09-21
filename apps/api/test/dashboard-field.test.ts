import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';
let workerA = '';
let workerB = '';
let eventId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await r.json()).token;

  // noms sans aucun recouvrement avec les fixtures des autres fichiers de test
  const ws = await prisma.worksite.create({ data: { ref: 'R-DASHFIELD', title: 'Chantier terrain-du-jour', source: 'test' } });
  worksiteId = ws.id;
  const a = await prisma.person.create({ data: { firstName: 'Quirinus', displayName: 'Quirinus Terrain', normalizedName: 'quirinus terrain', role: 'worker', source: 'test' } });
  const b = await prisma.person.create({ data: { firstName: 'Balthazar', displayName: 'Balthazar Terrain', normalizedName: 'balthazar terrain', role: 'worker', source: 'test' } });
  workerA = a.id;
  workerB = b.id;
  const start = new Date(); start.setHours(8, 0, 0, 0);
  const end = new Date(); end.setHours(17, 0, 0, 0);
  const ev = await prisma.planningEvent.create({
    data: { worksiteId, startAt: start, endAt: end, assignments: { create: [{ personId: workerA }, { personId: workerB }] } },
  });
  eventId = ev.id;
  // A a un compteur en cours, B n'a encore rien pointé
  await prisma.timeEntry.create({ data: { personId: workerA, worksiteId, status: 'running', date: new Date(), startedAt: new Date(), source: 'test' } });
});

after(async () => {
  await prisma.timeEntry.deleteMany({ where: { personId: { in: [workerA, workerB] } } });
  await prisma.planningEvent.deleteMany({ where: { id: eventId } });
  await prisma.person.deleteMany({ where: { id: { in: [workerA, workerB] } } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await new Promise((r) => server.close(r));
});

test('dashboard : « sur le terrain aujourd’hui » expose l’état de pointage de chaque ouvrier affecté', async () => {
  const res = await fetch(`${base}/api/dashboard`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const ev = (body.fieldToday as { id: string; worksite: { ref: string }; people: { id: string; state: string }[] }[]).find((e) => e.id === eventId);
  assert.ok(ev, 'l’affectation du jour doit être listée');
  assert.equal(ev.worksite.ref, 'R-DASHFIELD');
  assert.equal(ev.people.find((p) => p.id === workerA)?.state, 'running');
  assert.equal(ev.people.find((p) => p.id === workerB)?.state, 'none');
});
