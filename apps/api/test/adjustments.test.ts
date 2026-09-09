import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { teamMonthlyStatement } from '../src/lib/statement.js';

let server: Server;
let base = '';
let token = '';
let personId = '';
let worksiteId = '';
const adjIds: string[] = [];

async function jf<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await login.json()).token;

  const p = await prisma.person.create({
    data: { firstName: 'Test', lastName: 'Avances', normalizedName: 'test avances', hourlyRate: 25, dailyHours: 8, source: 'test' },
  });
  personId = p.id;
  const ws = await prisma.worksite.create({ data: { ref: 'R-ADJ-TEST', title: 'Avances — test', source: 'test' } });
  worksiteId = ws.id;
});

after(async () => {
  await prisma.personAdjustment.deleteMany({ where: { id: { in: adjIds } } });
  await prisma.timeEntry.deleteMany({ where: { personId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await prisma.person.deleteMany({ where: { id: personId } });
  server.close();
});

test('avance + dette : créables, comptent dans le solde à retenir sur la fiche', async () => {
  const advance = await jf<{ adjustment: { id: string; type: string; amount: number } }>(
    `/api/people/${personId}/adjustments`,
    { method: 'POST', body: JSON.stringify({ type: 'advance', amount: 200, date: '2026-09-01', note: 'Acompte demandé' }) },
  );
  assert.equal(advance.status, 201);
  assert.equal(advance.body.adjustment.type, 'advance');
  adjIds.push(advance.body.adjustment.id);

  const debt = await jf<{ adjustment: { id: string; type: string } }>(
    `/api/people/${personId}/adjustments`,
    { method: 'POST', body: JSON.stringify({ type: 'debt', amount: 50, date: '2026-09-02', note: 'PV stationnement' }) },
  );
  assert.equal(debt.status, 201);
  adjIds.push(debt.body.adjustment.id);

  const detail = await jf<{ adjustmentBalance: number; person: { adjustments: unknown[] } }>(`/api/people/${personId}`);
  assert.equal(detail.body.adjustmentBalance, 250);
  assert.equal(detail.body.person.adjustments.length, 2);

  // régler l'avance -> sort du solde à retenir
  const settled = await jf<{ adjustment: { settled: boolean; settledOn: string | null } }>(
    `/api/people/${personId}/adjustments/${advance.body.adjustment.id}/settle`,
    { method: 'POST', body: JSON.stringify({ settled: true }) },
  );
  assert.equal(settled.body.adjustment.settled, true);
  assert.ok(settled.body.adjustment.settledOn);

  const after1 = await jf<{ adjustmentBalance: number }>(`/api/people/${personId}`);
  assert.equal(after1.body.adjustmentBalance, 50);

  // suppression
  const del = await jf<{ ok: boolean }>(`/api/people/${personId}/adjustments/${debt.body.adjustment.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  adjIds.splice(adjIds.indexOf(debt.body.adjustment.id), 1);

  const after2 = await jf<{ adjustmentBalance: number }>(`/api/people/${personId}`);
  assert.equal(after2.body.adjustmentBalance, 0);
});

test('teamMonthlyStatement : le solde non réglé réduit le montant net à payer', async () => {
  await prisma.timeEntry.create({
    data: {
      personId, worksiteId, date: new Date('2026-09-10'), hours: 8, amount: 200, rateUsed: 25,
      status: 'approved', source: 'test',
    },
  });
  const adj = await prisma.personAdjustment.create({
    data: { personId, type: 'debt', amount: 30, date: new Date('2026-09-11'), note: 'test', settled: false },
  });
  adjIds.push(adj.id);

  const team = await teamMonthlyStatement(2026, 9);
  const row = team.rows.find((r) => r.personId === personId);
  assert.ok(row, 'la personne doit apparaître dans le décompte du mois');
  assert.equal(row!.amount, 200);
  assert.equal(row!.toWithhold, 30);
  assert.equal(row!.netAmount, 170);
});
