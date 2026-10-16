import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

/**
 * Garde-fou : le filtre « payé / à régler » ne doit JAMAIS embarquer d'identifiants de rapprochements dans la requête SQL.
 * En production (Postgres) ~19 000 identifiants, répétés, ont dépassé la limite de 32 767 paramètres et cassé la page Achats.
 * Ici, 36 000 écritures rapprochées : l'ancienne construction échouait dès que la liste dépassait ce plafond.
 */
let server: Server; let base = ''; let token = '';
const N = 36_000;
const get = async (p: string) => { const r = await fetch(`${base}/api/finance/expenses${p}`, { headers: { authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  const chunk = 3000;
  for (let i = 0; i < N; i += chunk) {
    const n = Math.min(chunk, N - i);
    await prisma.ledgerEntry.createMany({ data: Array.from({ length: n }, (_, k) => ({ id: `scale-l-${i + k}`, direction: 'purchase', docNumber: `SC-${i + k}`, supplierName: 'Fournisseur Scale', ht: 10, ttc: 12.1, year: 2026, source: 'test-scale', date: new Date('2026-01-01') })) });
    await prisma.bankTransaction.createMany({ data: Array.from({ length: n }, (_, k) => ({ id: `scale-b-${i + k}`, externalId: `scale-${i + k}`, amount: -12.1, side: 'out', bookingDate: new Date('2026-01-02') })) });
    await prisma.bankTransactionMatch.createMany({ data: Array.from({ length: n }, (_, k) => ({ id: `scale-m-${i + k}`, bankTransactionId: `scale-b-${i + k}`, ledgerEntryId: `scale-l-${i + k}` })) });
  }
});
after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { id: { startsWith: 'scale-m-' } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { startsWith: 'scale-b-' } } });
  await prisma.ledgerEntry.deleteMany({ where: { source: 'test-scale' } });
  server.close();
});

test('36 000 écritures rapprochées : « payé » et « à régler » répondent toujours (aucune liste d’identifiants dans la requête SQL)', async () => {
  const paid = await get('?paid=1&q=Fournisseur%20Scale&pageSize=50');
  assert.equal(paid.status, 200);
  assert.equal(paid.body.totals.count, N, 'toutes payées par rapprochement');
  assert.equal(paid.body.items.length, 50);
  const due = await get('?paid=0&q=Fournisseur%20Scale&pageSize=50');
  assert.equal(due.status, 200);
  assert.equal(due.body.totals.count, 0);
  const late = await get('?overdue=1&pageSize=50');
  assert.equal(late.status, 200);
});
