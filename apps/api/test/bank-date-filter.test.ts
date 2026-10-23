import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
const ids: string[] = [];

const list = async (qs: string) => {
  const r = await fetch(`${base}/api/finance/bank?matched=&pageSize=500&q=DATEFILTER&${qs}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  return (j.items as { counterpartyName: string }[]).map((t) => t.counterpartyName).sort();
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
  for (const [day, name] of [['2026-03-31', 'DATEFILTER A'], ['2026-04-01', 'DATEFILTER B'], ['2026-04-15', 'DATEFILTER C'], ['2026-04-30', 'DATEFILTER D'], ['2026-05-01', 'DATEFILTER E']]) {
    ids.push((await prisma.bankTransaction.create({ data: { amount: -10, bookingDate: new Date(`${day}T00:00:00.000Z`), side: 'out', counterpartyName: name, source: 'test' } })).id);
  }
});

after(async () => {
  await prisma.bankTransaction.deleteMany({ where: { id: { in: ids } } });
  server.close();
});

test('relevé bancaire : filtre par date précise, par période (bornes incluses), ou seulement début / fin', async () => {
  assert.deepEqual(await list(''), ['DATEFILTER A', 'DATEFILTER B', 'DATEFILTER C', 'DATEFILTER D', 'DATEFILTER E'], 'sans filtre : tout');
  assert.deepEqual(await list('from=2026-04-15&to=2026-04-15'), ['DATEFILTER C'], 'date précise');
  assert.deepEqual(await list('from=2026-04-01&to=2026-04-30'), ['DATEFILTER B', 'DATEFILTER C', 'DATEFILTER D'], 'période : bornes incluses');
  assert.deepEqual(await list('from=2026-04-16'), ['DATEFILTER D', 'DATEFILTER E'], 'à partir du');
  assert.deepEqual(await list('to=2026-04-01'), ['DATEFILTER A', 'DATEFILTER B'], 'jusqu’au');
  assert.deepEqual(await list('from=pas-une-date&to=2026-13-45'), ['DATEFILTER A', 'DATEFILTER B', 'DATEFILTER C', 'DATEFILTER D', 'DATEFILTER E'], 'dates invalides ignorées, pas d’erreur');
});
