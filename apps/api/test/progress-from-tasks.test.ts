import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server; let base = ''; let token = ''; const ids: { ws?: string; q?: string } = {};
const call = async (p: string) => (await fetch(`${base}/api/progress${p}`, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-PFT', title: 'Avancement par tâches', source: 'test' } })).id;
  const q = await prisma.document.create({ data: { kind: 'quote', direction: 'sale', number: 'D9999-PFT', status: 'accepted', worksiteId: ids.ws, lockedAt: new Date(), totalHt: 300, totalVat: 0, totalTtc: 300, source: 'test-pft',
    lines: { create: [
      { kind: 'item', position: 0, label: 'Grenier', qty: 1, unitPriceHt: 200, totalHt: 200 },
      { kind: 'item', position: 1, label: 'Terrasse', qty: 1, unitPriceHt: 50, totalHt: 50 },
      { kind: 'item', position: 2, label: 'Hall', qty: 1, unitPriceHt: 50, totalHt: 50 },
    ] } } });
  ids.q = q.id;
  await prisma.worksiteTask.create({ data: { worksiteId: ids.ws, title: 'Grenier', source: 'quote', status: 'doing', checklist: [{ label: 'a', done: true }, { label: 'b', done: true }, { label: 'c', done: false }, { label: 'd', done: false }] } });
  await prisma.worksiteTask.create({ data: { worksiteId: ids.ws, title: ' terrasse ', source: 'quote', status: 'done' } }); // sans liste, faite ; casse et espaces ignorés
});
after(async () => {
  await prisma.worksiteTask.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.document.deleteMany({ where: { id: ids.q } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});

test('avancement proposé d’après les tâches : % de cases cochées, 100 % si la tâche est faite, rien si pas de tâche', async () => {
  const r = await call(`/quote/${ids.q}/from-tasks`);
  const by = Object.fromEntries((r.suggestions as { quoteLineId: string; pct: number | null; done: number; total: number }[]).map((s) => [s.quoteLineId, s]));
  const lines = await prisma.documentLine.findMany({ where: { documentId: ids.q! }, orderBy: { position: 'asc' } });
  assert.deepEqual([by[lines[0]!.id]!.pct, by[lines[0]!.id]!.done, by[lines[0]!.id]!.total], [50, 2, 4], 'Grenier : 2 cases sur 4');
  assert.equal(by[lines[1]!.id]!.pct, 100, 'Terrasse : tâche faite');
  assert.equal(by[lines[2]!.id]!.pct, null, 'Hall : pas de tâche, aucune proposition');
  assert.equal(r.matched, 2);
  // rien n'est enregistré par la proposition
  assert.equal(await prisma.progressStatement.count({ where: { quoteId: ids.q! } }), 0);
  assert.equal((await fetch(`${base}/api/progress/quote/inconnu/from-tasks`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
});
