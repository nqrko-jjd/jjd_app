import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { autoMatchAll } from '../src/lib/bank-match.js';
import { normalizeName } from '@jjd/shared';

let server: Server;
let base = '';
let token = '';
let contactId = '';
const docIds: string[] = [];
const txIds: string[] = [];

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}
const mkDoc = async (number: string, total: number) => {
  const d = await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', status: 'overdue', number, contactId, issuedOn: new Date('2026-05-05'), dueOn: new Date('2026-05-15'), lockedAt: new Date('2026-05-05'), totalHt: total, totalVat: 0, totalTtc: total, source: 'legacy' } });
  docIds.push(d.id);
  // facture historique (Excel) de même numéro, NON liée au document
  const twin = await prisma.ledgerEntry.create({ data: { direction: 'sale', docNumber: number, ttc: total, ht: total, date: new Date('2026-05-05'), supplierName: 'Client Jumeau Paiement', source: 'xlsx', paymentStatus: 'Non payé' } });
  return { d, twin };
};
const mkTx = async (amount: number, date: string) => {
  const t = await prisma.bankTransaction.create({ data: { amount, bookingDate: new Date(date), side: 'in', bank: 'ING', counterpartyName: 'CLIENT JUMEAU PAIEMENT', source: 'test' } });
  txIds.push(t.id);
  return t;
};
const status = async (id: string) => prisma.document.findUniqueOrThrow({ where: { id }, select: { status: true, paidAmount: true } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  contactId = (await prisma.contact.create({ data: { name: 'Client Jumeau Paiement', normalizedName: normalizeName('Client Jumeau Paiement'), type: 'client' } })).id;
});
after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: { in: txIds } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ documentId: { in: docIds } }, { supplierName: 'Client Jumeau Paiement' }] } });
  await prisma.document.deleteMany({ where: { id: { in: docIds } } });
  await prisma.contact.delete({ where: { id: contactId } });
  server.close();
});

test('paiement rapproché à l\'écriture historique (Excel) d\'une facture : la FACTURE passe « payée » (F2026-166)', async () => {
  const { d, twin } = await mkDoc('FTWP-001', 3315.68);
  const t = await mkTx(3315.68, '2026-10-02');
  const r = await api('POST', `/api/finance/bank/${t.id}/matches`, { ledgerId: twin.id });
  assert.equal(r.status, 201);
  const s = await status(d.id);
  assert.equal(s.status, 'paid');
  assert.equal(s.paidAmount, 3315.68);
});

test('retirer ce paiement : la facture redevient non payée', async () => {
  const { d, twin } = await mkDoc('FTWP-002', 500);
  const t = await mkTx(500, '2026-10-02');
  await api('POST', `/api/finance/bank/${t.id}/matches`, { ledgerId: twin.id });
  assert.equal((await status(d.id)).status, 'paid');
  const m = await prisma.bankTransactionMatch.findFirstOrThrow({ where: { bankTransactionId: t.id } });
  const del = await api('DELETE', `/api/finance/bank/${t.id}/matches/${m.id}`);
  assert.equal(del.status, 200);
  const s = await status(d.id);
  assert.notEqual(s.status, 'paid');
  assert.equal(s.paidAmount, 0);
});

test('paiements partiels sur l\'écriture historique : partielle puis payée', async () => {
  const { d, twin } = await mkDoc('FTWP-003', 1000);
  const t1 = await mkTx(400, '2026-09-01'); const t2 = await mkTx(600, '2026-10-01');
  await api('POST', `/api/finance/bank/${t1.id}/matches`, { ledgerId: twin.id });
  assert.equal((await status(d.id)).status, 'partial');
  await api('POST', `/api/finance/bank/${t2.id}/matches`, { ledgerId: twin.id });
  const s = await status(d.id);
  assert.equal(s.status, 'paid');
  assert.equal(s.paidAmount, 1000);
});

test('rapprochement automatique : un paiement trouvé pour l\'écriture historique répercute aussi sur la facture', async () => {
  const { d } = await mkDoc('FTWP-004', 777.77);
  await mkTx(777.77, '2026-10-03');
  await autoMatchAll();
  const s = await status(d.id);
  assert.equal(s.status, 'paid');
  assert.equal(s.paidAmount, 777.77);
});
