import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
const ids: string[] = [];
let inId = '';
let outId = '';
let otherOutId = '';
let sameSignId = '';

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
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

  const mk = async (amount: number, day: string, name: string) => {
    const t = await prisma.bankTransaction.create({ data: { amount, bookingDate: new Date(day), side: amount < 0 ? 'out' : 'in', counterpartyName: name, source: 'test' } });
    ids.push(t.id);
    return t.id;
  };
  inId = await mk(48213.57, '2026-05-19', 'PAIRTEST CLIENT');       // double paiement reçu
  outId = await mk(-48213.57, '2026-05-19', 'PAIRTEST CLIENT');     // remboursement le jour même
  otherOutId = await mk(-48213.56, '2026-05-20', 'PAIRTEST AUTRE'); // 1 centime d'écart : toléré
  sameSignId = await mk(48213.57, '2026-05-21', 'PAIRTEST MEME SENS');
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { entity: 'bank_transaction', entityId: { in: ids } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: ids } } });
  server.close();
});

test('propositions : sens opposé et même montant, jamais une transaction de même sens', async () => {
  const r = await call<{ items: { id: string }[] }>('GET', `/api/finance/bank/${inId}/pair-suggestions`);
  assert.equal(r.status, 200);
  const found = r.body.items.map((i) => i.id);
  assert.ok(found.includes(outId));
  assert.ok(found.includes(otherOutId));
  assert.ok(!found.includes(sameSignId));
  assert.equal(found[0], outId, 'la plus proche en date d’abord');
});

test('refuse deux transactions de même sens', async () => {
  const r = await call<{ error?: string }>('POST', `/api/finance/bank/${inId}/pair`, { otherId: sameSignId });
  assert.equal(r.status, 409);
});

test('lier : les deux transactions sortent de « à rapprocher », dans les deux sens', async () => {
  const r = await call('POST', `/api/finance/bank/${inId}/pair`, { otherId: outId, note: 'Double paiement F2026-105 remboursé' });
  assert.equal(r.status, 201);
  const [a, b] = await Promise.all([
    prisma.bankTransaction.findUnique({ where: { id: inId } }),
    prisma.bankTransaction.findUnique({ where: { id: outId } }),
  ]);
  assert.equal(a?.pairedTxId, outId);
  assert.equal(b?.pairedTxId, inId);
  assert.equal(a?.pairNote, 'Double paiement F2026-105 remboursé');

  const todo = await call<{ items: { id: string }[] }>('GET', '/api/finance/bank?matched=0&q=PAIRTEST&pageSize=100');
  const todoIds = todo.body.items.map((i) => i.id);
  assert.ok(!todoIds.includes(inId) && !todoIds.includes(outId));
  const done = await call<{ items: { id: string; pairedTx: { id: string } | null }[] }>('GET', '/api/finance/bank?matched=1&q=PAIRTEST&pageSize=100');
  const row = done.body.items.find((i) => i.id === inId);
  assert.equal(row?.pairedTx?.id, outId);
});

test('une transaction liée ne peut plus recevoir de facture ni être reliée ailleurs', async () => {
  const again = await call('POST', `/api/finance/bank/${otherOutId}/pair`, { otherId: inId });
  assert.equal(again.status, 409);
  const sugg = await call<{ items: { id: string }[] }>('GET', `/api/finance/bank/${otherOutId}/pair-suggestions`);
  assert.ok(!sugg.body.items.some((i) => i.id === inId));
});

test('délier : les deux repassent « à rapprocher »', async () => {
  const r = await call('DELETE', `/api/finance/bank/${outId}/pair`);
  assert.equal(r.status, 200);
  const [a, b] = await Promise.all([
    prisma.bankTransaction.findUnique({ where: { id: inId } }),
    prisma.bankTransaction.findUnique({ where: { id: outId } }),
  ]);
  assert.equal(a?.pairedTxId, null);
  assert.equal(b?.pairedTxId, null);
  const again = await call('DELETE', `/api/finance/bank/${outId}/pair`);
  assert.equal(again.status, 409);
});

test('écart d’un centime toléré, au-delà refusé', async () => {
  const ok = await call('POST', `/api/finance/bank/${inId}/pair`, { otherId: otherOutId });
  assert.equal(ok.status, 201);
  await call('DELETE', `/api/finance/bank/${inId}/pair`);
  const far = await prisma.bankTransaction.create({ data: { amount: -48000, bookingDate: new Date('2026-05-19'), side: 'out', counterpartyName: 'PAIRTEST LOIN', source: 'test' } });
  ids.push(far.id);
  const ko = await call('POST', `/api/finance/bank/${inId}/pair`, { otherId: far.id });
  assert.equal(ko.status, 409);
});
