import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let txId = '';
const entryIds: string[] = [];

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
});

after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { ledgerEntryId: { in: entryIds } } });
  await prisma.bankTransaction.deleteMany({ where: { id: txId } });
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: entryIds } } });
  server.close();
});

test('export des dépenses : statut, montants et date du paiement viennent du rapprochement bancaire', async () => {
  const mk = (docNumber: string, ttc: number) => prisma.ledgerEntry.create({ data: { date: new Date('2026-05-01T00:00:00.000Z'), direction: 'purchase', docType: "Facture d'achat", docNumber, supplierName: 'EXPORTBANK SA', ht: ttc / 1.21, ttc, paymentStatus: 'Non payé', source: 'test', year: 2026, month: '5', quarter: 'T2' } });
  const paid = await mk('EXPBANK-1', 121);
  const open = await mk('EXPBANK-2', 242);
  entryIds.push(paid.id, open.id);
  const tx = await prisma.bankTransaction.create({ data: { amount: -121, bookingDate: new Date('2026-05-20T00:00:00.000Z'), side: 'out', counterpartyName: 'EXPORTBANK SA', communication: 'FACTURE 2026/777', source: 'test' } });
  txId = tx.id;
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, ledgerEntryId: paid.id } });

  const r = await fetch(`${base}/api/finance/expenses/export.csv?q=EXPBANK`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const lines = (await r.text()).split(/\r?\n/);
  const header = lines[0]!;
  assert.match(header, /Rapprochement bancaire/);
  assert.match(header, /Date du paiement \(banque\)/);
  const l1 = lines.find((l) => l.includes('EXPBANK-1'));
  const l2 = lines.find((l) => l.includes('EXPBANK-2'));
  assert.ok(l1 && l2, 'les deux lignes sont exportées');
  assert.match(l1!, /Payé/);
  assert.match(l1!, /2026-05-20/);
  assert.match(header, /Communication/);
  assert.match(l1!, /FACTURE 2026\/777/);
  assert.match(l2!, /Non payé/);
});
