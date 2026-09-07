import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { worksiteMargin } from '../src/lib/worksite-margin.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';
let txId = '';

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

  const ws = await prisma.worksite.create({ data: { ref: 'R-EXP-TEST', title: 'Dépenses — test', source: 'test' } });
  worksiteId = ws.id;
  const tx = await prisma.bankTransaction.create({
    data: { externalId: 'exp-test-tx', bookingDate: new Date('2026-09-05'), amount: -121, side: 'out', source: 'test' },
  });
  txId = tx.id;
});

after(async () => {
  await prisma.bankTransaction.deleteMany({ where: { OR: [{ id: txId }, { source: 'test' }] } });
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test("création d'une dépense -> alimente le coût matériaux du chantier", async () => {
  const { status, body } = await jf<{ expense: { id: string; source: string; direction: string } }>(
    '/api/finance/expenses',
    { method: 'POST', body: JSON.stringify({ date: '2026-09-05', supplierName: 'Test Fournisseur', worksiteId, ht: 100, ttc: 121, paymentStatus: 'Non payé' }) },
  );
  assert.equal(status, 201);
  assert.equal(body.expense.source, 'manual');
  assert.equal(body.expense.direction, 'purchase');

  const m = await worksiteMargin(worksiteId);
  assert.equal(m!.materialCost, 100);
});

test('bascule payé / non payé', async () => {
  const list = await jf<{ items: { id: string }[] }>(`/api/finance/expenses?worksiteId=${worksiteId}`);
  const id = list.body.items[0]!.id;

  const paid = await jf<{ expense: { paymentStatus: string; paidOn: string | null } }>(`/api/finance/expenses/${id}/paid`, {
    method: 'POST', body: JSON.stringify({ paid: true }),
  });
  assert.equal(paid.body.expense.paymentStatus, 'Payé');
  assert.ok(paid.body.expense.paidOn);

  const back = await jf<{ expense: { paymentStatus: string; paidOn: string | null } }>(`/api/finance/expenses/${id}/paid`, {
    method: 'POST', body: JSON.stringify({ paid: false }),
  });
  assert.equal(back.body.expense.paymentStatus, 'Non payé');
  assert.equal(back.body.expense.paidOn, null);
});

test('modification puis suppression (manuel uniquement)', async () => {
  const list = await jf<{ items: { id: string }[] }>(`/api/finance/expenses?worksiteId=${worksiteId}`);
  const id = list.body.items[0]!.id;

  const patched = await jf<{ expense: { ht: number } }>(`/api/finance/expenses/${id}`, {
    method: 'PATCH', body: JSON.stringify({ ht: 150 }),
  });
  assert.equal(patched.body.expense.ht, 150);

  const del = await jf<{ ok: boolean }>(`/api/finance/expenses/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('suppression refusée sur une écriture importée', async () => {
  const imported = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', worksiteId, ht: 50, date: new Date('2026-08-01'), source: 'xlsx' },
  });
  const del = await jf(`/api/finance/expenses/${imported.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});

test('rapprochement bancaire -> facture d\'achat passe « payé », défaire la repasse « non payé »', async () => {
  const exp = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', worksiteId, ht: 100, ttc: 121, date: new Date('2026-09-04'), source: 'manual', paymentStatus: 'Non payé' },
  });

  const m = await jf<{ transaction: { matchedLedgerId: string | null } }>(`/api/finance/bank/${txId}/match`, {
    method: 'POST', body: JSON.stringify({ ledgerId: exp.id }),
  });
  assert.equal(m.body.transaction.matchedLedgerId, exp.id);
  const afterMatch = await prisma.ledgerEntry.findUnique({ where: { id: exp.id } });
  assert.equal(afterMatch!.paymentStatus, 'Payé');
  assert.ok(afterMatch!.paidOn);

  await jf(`/api/finance/bank/${txId}/match`, { method: 'POST', body: JSON.stringify({ ledgerId: null }) });
  const afterUnmatch = await prisma.ledgerEntry.findUnique({ where: { id: exp.id } });
  assert.equal(afterUnmatch!.paymentStatus, 'Non payé');
  assert.equal(afterUnmatch!.paidOn, null);
});
