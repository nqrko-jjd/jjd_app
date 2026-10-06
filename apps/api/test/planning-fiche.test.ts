import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';
let eventId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  worksiteId = (await prisma.worksite.create({ data: { ref: 'R-FICHE-T', title: 'Chantier fiche test', source: 'test' } })).id;
  await prisma.worksiteTask.create({ data: { worksiteId, title: 'Tâche ouverte du chantier', status: 'todo', position: 1 } as never });
  eventId = (await prisma.planningEvent.create({
    data: {
      worksiteId, title: 'Intervention test', startAt: new Date('2026-10-08T07:00:00Z'), endAt: new Date('2026-10-08T15:00:00Z'),
      departureAt: new Date('2026-10-08T06:30:00Z'), departureFrom: 'Dépôt',
      tasksNote: '- Démolir le mur\n2) Évacuer les gravats\n\nProtéger les sols', accessNote: 'Code 1234, livraison côté cour', materialsNote: '10 sacs de ciment',
    },
  })).id;
});
after(async () => {
  await prisma.planningEvent.deleteMany({ where: { id: eventId } });
  await prisma.worksiteTask.deleteMany({ where: { worksiteId } });
  await prisma.worksite.delete({ where: { id: worksiteId } });
  server.close();
});

test('fiche imprimable d\'un créneau : travaux du créneau, accès, matériel, départ et tâches du chantier sont fournis', async () => {
  const r = await fetch(`${base}/api/planning/${eventId}/fiche`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const { fiche } = (await r.json()) as { fiche: { tasksNote: string; accessNote: string; materialsNote: string; departure: { from: string } | null; tasks: { title: string }[] } };
  assert.equal(fiche.tasksNote, '- Démolir le mur\n2) Évacuer les gravats\n\nProtéger les sols');
  assert.equal(fiche.accessNote, 'Code 1234, livraison côté cour');
  assert.equal(fiche.materialsNote, '10 sacs de ciment');
  assert.equal(fiche.departure?.from, 'Dépôt');
  assert.deepEqual(fiche.tasks.map((t) => t.title), ['Tâche ouverte du chantier']);
});
