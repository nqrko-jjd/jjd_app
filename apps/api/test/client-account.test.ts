import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { txRemaining } from '../src/lib/client-account.js';

let server: Server;
let base = '';
let token = '';
let contactId = '';
let otherId = '';
const txIds: string[] = [];
const ledgerIds: string[] = [];

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
  contactId = (await prisma.contact.create({ data: { name: 'Client compte test', normalizedName: 'client compte test', type: 'client' } })).id;
  otherId = (await prisma.contact.create({ data: { name: 'Autre payeur test', normalizedName: 'autre payeur test', type: 'client' } })).id;
});

after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: { in: txIds } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: ledgerIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: [contactId, otherId] } } });
  server.close();
});

const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const j = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { ...init, headers: H() }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const mkTx = async (amount: number, extra: Record<string, unknown> = {}) => { const t = await prisma.bankTransaction.create({ data: { bookingDate: new Date('2026-06-09'), amount, description: `test ${amount}`, side: 'in', bank: 'Belfius', source: 'test', ...extra } }); txIds.push(t.id); return t; };
const mkLedger = async (data: Record<string, unknown>) => { const e = await prisma.ledgerEntry.create({ data: { direction: 'sale', date: new Date('2026-05-01'), source: 'test', contactId, ht: 0, ...data } as never }); ledgerIds.push(e.id); return e; };

test('txRemaining : rien rattaché = tout, parts = le reste, un lien sans part = tout est affecté, sortie = 0', () => {
  assert.equal(txRemaining({ amount: 1000, matches: [] }), 1000);
  assert.equal(txRemaining({ amount: 1000, matches: [{ amount: 400 }, { amount: 100 }] }), 500);
  assert.equal(txRemaining({ amount: 1000, matches: [{ amount: null }] }), 0);
  assert.equal(txRemaining({ amount: 1000, matches: [{ amount: 1000 }] }), 0);
  assert.equal(txRemaining({ amount: -50, matches: [] }), 0);
});

test('compte client : facturé, reste à encaisser, argent reçu sans facture attribué au client, solde négatif = crédit du client', async () => {
  const open = await mkLedger({ ht: 1000, ttc: 1060, paymentStatus: 'Non payé', docNumber: 'F-CA-1' });
  await mkLedger({ ht: 500, ttc: 530, paymentStatus: 'Payé', docNumber: 'F-CA-2' });
  await mkLedger({ direction: 'credit_note', categoryRaw: 'Note de crédit vente', ht: -100, ttc: -106, paymentStatus: 'Payé', docNumber: 'NC-CA-1' });
  await mkTx(1000, { contactId }); // rien rattaché : 1 000 € sans facture
  const t2 = await mkTx(2000, { contactId }); // 1 200 € répartis sur une facture, 800 € restent
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: t2.id, ledgerEntryId: open.id, amount: 1200 } });
  await mkTx(700); // non attribué à ce client : ne compte pas dans son compte
  const r = await j(`/api/contacts/${contactId}`);
  assert.equal(r.status, 200);
  const a = r.body.contact.clientAccount;
  assert.equal(a.invoicedTtc, 1060 + 530 - 106);
  assert.equal(a.openTtc, 1060);
  assert.equal(a.unallocatedTotal, 1800);
  assert.equal(a.unallocated.length, 2);
  assert.equal(a.balance, 1060 - 1800, 'négatif : le client a versé plus qu’il n’a de factures ouvertes');
});

test('virement attribué à la main à un client, puis retiré ; client inconnu refusé', async () => {
  const t = await mkTx(250);
  assert.equal((await j(`/api/finance/bank/${t.id}`, { method: 'PATCH', body: JSON.stringify({ contactId: otherId }) })).status, 200);
  let a = (await j(`/api/contacts/${otherId}`)).body.contact.clientAccount;
  assert.equal(a.unallocatedTotal, 250);
  assert.equal((await j(`/api/finance/bank/${t.id}`, { method: 'PATCH', body: JSON.stringify({ contactId: null }) })).status, 200);
  a = (await j(`/api/contacts/${otherId}`)).body.contact.clientAccount;
  assert.equal(a.unallocatedTotal, 0);
  assert.equal((await j(`/api/finance/bank/${t.id}`, { method: 'PATCH', body: JSON.stringify({ contactId: 'inconnu' }) })).status, 422);
});

test('rapprochement d’un virement entrant à la facture d’un client : le virement lui est attribué automatiquement', async () => {
  const inv = await mkLedger({ ht: 300, ttc: 300, paymentStatus: 'Non payé', docNumber: 'F-CA-3' });
  const t = await mkTx(300);
  assert.equal((await j(`/api/finance/bank/${t.id}/matches`, { method: 'POST', body: JSON.stringify({ ledgerId: inv.id }) })).status, 201);
  assert.equal((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: t.id } })).contactId, contactId);
});
