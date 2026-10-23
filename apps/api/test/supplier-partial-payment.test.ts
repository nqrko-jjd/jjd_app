import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server; let base = ''; let token = '';
const ids: { c?: string; ws?: string; e?: string; tx?: string } = {};
const get = async (p: string) => (await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.c = (await prisma.contact.create({ data: { name: 'Fournisseur Partiel Test', normalizedName: 'fournisseur partiel test', type: 'supplier' } })).id;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-PARTIEL', title: 'Chantier paiement partiel', source: 'test' } })).id;
  ids.e = (await prisma.ledgerEntry.create({ data: { source: 'test-partiel', year: 2026, direction: 'purchase', docNumber: 'F-020', contactId: ids.c, supplierName: 'Fournisseur Partiel Test', worksiteId: ids.ws, ht: 826.45, ttc: 1000, paymentStatus: 'Non payé', date: new Date('2026-06-12') } as never })).id;
  ids.tx = (await prisma.bankTransaction.create({ data: { amount: -400, bookingDate: new Date('2026-06-20'), side: 'out', counterpartyName: 'Fournisseur Partiel Test', source: 'test' } })).id;
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: ids.tx, ledgerEntryId: ids.e, amount: 400 } });
});
after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: ids.tx } });
  await prisma.bankTransaction.deleteMany({ where: { id: ids.tx } });
  await prisma.ledgerEntry.deleteMany({ where: { id: ids.e } });
  await prisma.contact.deleteMany({ where: { id: ids.c } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});

test('paiement partiel d’une facture d’achat : montant payé et reste à payer exposés (fiche fournisseur et achats du chantier)', async () => {
  const fiche = await get(`/api/contacts/${ids.c}`);
  const p = (fiche.contact.purchases as { docNumber: string; paid: boolean; paidAmount: number; remainingAmount: number }[]).find((x) => x.docNumber === 'F-020')!;
  assert.equal(p.paid, false);
  assert.equal(p.paidAmount, 400, 'payé en partie');
  assert.equal(p.remainingAmount, 600, 'reste à payer');

  const chantier = await get(`/api/finance/expenses?worksiteId=${ids.ws}`);
  const e = (chantier.items as { docNumber: string; paid: boolean; paidAmount: number; remainingAmount: number }[]).find((x) => x.docNumber === 'F-020')!;
  assert.equal(e.paid, false);
  assert.equal(e.paidAmount, 400);
  assert.equal(e.remainingAmount, 600);
});
