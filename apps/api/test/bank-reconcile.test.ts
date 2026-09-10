import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';
let farLedgerId = '';
let txId = '';

async function jf<T>(path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
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

  const ws = await prisma.worksite.create({ data: { ref: 'R-BR-TEST', title: 'Rapprochement — test', source: 'test' } });
  worksiteId = ws.id;
  // facture très loin dans le temps (hors fenêtre ±20j des suggestions auto) -> ne doit
  // apparaître que via la recherche manuelle, jamais dans les propositions par défaut
  const l = await prisma.ledgerEntry.create({
    data: {
      direction: 'purchase', ttc: 999.99, ht: 826.44, date: new Date('2020-01-01'),
      docNumber: 'JJDBRTEST-42', supplierName: 'Fournisseur Rapprochement Test', worksiteId, source: 'test',
    },
  });
  farLedgerId = l.id;

  const tx = await prisma.bankTransaction.create({
    data: { amount: -123.45, bookingDate: new Date('2026-06-01'), side: 'out', counterpartyName: 'Test Reconcile', source: 'test' },
  });
  txId = tx.id;
});

after(async () => {
  await prisma.bankTransaction.deleteMany({ where: { id: txId } });
  await prisma.ledgerEntry.deleteMany({ where: { id: farLedgerId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test('GET /api/finance/bank : paginé (page/pageSize/totalPages/totalCount)', async () => {
  const r = await jf<{ items: unknown[]; page: number; pageSize: number; totalPages: number; totalCount: number }>(
    '/api/finance/bank?matched=&page=1&pageSize=20',
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.page, 1);
  assert.equal(r.body.pageSize, 20);
  assert.ok(r.body.items.length <= 20);
  assert.ok(r.body.totalCount >= 1);
  assert.ok(r.body.totalPages >= 1);
});

test('GET /api/finance/bank/:id/suggestions : sans q, hors fenêtre montant/date -> rien ; avec q, trouvée', async () => {
  const auto = await jf<{ items: { kind: string; id: string }[] }>(`/api/finance/bank/${txId}/suggestions`);
  assert.equal(auto.status, 200);
  assert.ok(!auto.body.items.some((i) => i.id === farLedgerId), 'la facture de 2020 ne doit pas apparaître dans les propositions auto (hors fenêtre)');

  const manual = await jf<{ items: { kind: string; id: string; label: string; worksiteRef: string | null }[] }>(
    `/api/finance/bank/${txId}/suggestions?q=JJDBRTEST-42`,
  );
  assert.equal(manual.status, 200);
  const found = manual.body.items.find((i) => i.id === farLedgerId);
  assert.ok(found, 'la recherche manuelle par n° de facture doit la trouver même hors fenêtre');
  assert.equal(found!.kind, 'ledger');
  assert.equal(found!.worksiteRef, 'R-BR-TEST');

  const manualByWorksite = await jf<{ items: { id: string }[] }>(`/api/finance/bank/${txId}/suggestions?q=R-BR-TEST`);
  assert.ok(manualByWorksite.body.items.some((i) => i.id === farLedgerId), 'recherche manuelle par référence chantier');
});
