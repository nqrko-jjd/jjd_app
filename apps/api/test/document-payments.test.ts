import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { normalizeName } from '@jjd/shared';

let server: Server;
let base = '';
let token = '';
let contactId = '';
let docId = '';
const txIds: string[] = [];

async function jf<T>(path: string): Promise<T> {
  const r = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as T;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  contactId = (await prisma.contact.create({ data: { name: 'Client Paiements Test', normalizedName: normalizeName('Client Paiements Test'), type: 'client' } })).id;
  docId = (await prisma.document.create({
    data: { kind: 'invoice', direction: 'sale', status: 'paid', number: 'FPAY-001', contactId, issuedOn: new Date('2025-03-01'), lockedAt: new Date('2025-03-01'), totalHt: 9418.74, totalVat: 0, totalTtc: 9418.74, paidAmount: 9418.74, source: 'legacy' },
  })).id;
  // écriture historique (Excel) de même n°, non liée au document : 3 paiements dessus
  const led = await prisma.ledgerEntry.create({ data: { direction: 'sale', docNumber: 'FPAY-001', ttc: 9418.74, ht: 9418.74, source: 'xlsx', paymentStatus: 'Payé' } });
  for (const [d, a] of [['2025-03-06', 3000], ['2025-03-11', 418.74], ['2025-03-14', 6000]] as const) {
    const t = await prisma.bankTransaction.create({ data: { amount: a, bookingDate: new Date(d), side: 'in', bank: 'Belfius', counterpartyName: 'CLIENT TEST', source: 'test' } });
    txIds.push(t.id);
    await prisma.bankTransactionMatch.create({ data: { bankTransactionId: t.id, ledgerEntryId: led.id } });
  }
});

after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: { in: txIds } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { docNumber: 'FPAY-001' } });
  await prisma.document.deleteMany({ where: { id: docId } });
  await prisma.contact.delete({ where: { id: contactId } });
  server.close();
});

test('facture payée en plusieurs fois (paiements sur l\'écriture Excel de même n°) : le détail les liste tous, dans l\'ordre', async () => {
  const r = await jf<{ document: { hasBankMatch: boolean; payments: { amount: number; date: string }[] } }>(`/api/documents/${docId}`);
  assert.equal(r.document.hasBankMatch, true);
  assert.equal(r.document.payments.length, 3);
  assert.deepEqual(r.document.payments.map((p) => p.amount), [3000, 418.74, 6000]);
  assert.ok(r.document.payments[0]!.date < r.document.payments[2]!.date, 'du plus ancien au plus récent');
});

test('rapprochement bancaire filtré par facture : les 3 virements ressortent (pas un seul)', async () => {
  const r = await jf<{ items: { id: string }[] }>(`/api/finance/bank?documentId=${docId}&matched=&pageSize=100`);
  assert.equal(r.items.filter((i) => txIds.includes(i.id)).length, 3);
});
