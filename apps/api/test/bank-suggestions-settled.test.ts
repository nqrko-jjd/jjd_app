import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
const ids: { ws?: string; paidDoc?: string; openDoc?: string; txPaid?: string; txNew?: string; txOther?: string } = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-SETTLED', title: 'Déjà soldée', source: 'test' } })).id;
  const issued = new Date('2026-05-26');
  // facture 1 : déjà payée par un virement rapproché ; facture 2 : encore ouverte, même montant
  ids.paidDoc = (await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', number: 'FSETTLED-1', status: 'paid', worksiteId: ids.ws, totalHt: 29167, totalVat: 6124.92, totalTtc: 35291.92, paidAmount: 35291.92, issuedOn: issued, lockedAt: issued, source: 'test' } })).id;
  ids.openDoc = (await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', number: 'FSETTLED-2', status: 'sent', worksiteId: ids.ws, totalHt: 29167, totalVat: 6124.92, totalTtc: 35291.92, issuedOn: issued, lockedAt: issued, source: 'test' } })).id;
  ids.txPaid = (await prisma.bankTransaction.create({ data: { amount: 35291.92, bookingDate: new Date('2026-06-09'), side: 'in', counterpartyName: 'Client test', source: 'test' } })).id;
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: ids.txPaid, documentId: ids.paidDoc } });
  ids.txNew = (await prisma.bankTransaction.create({ data: { amount: 35291.92, bookingDate: new Date('2026-05-19'), side: 'in', counterpartyName: 'Client test', source: 'test' } })).id;
});
after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: { in: [ids.txPaid!, ids.txNew!] } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: [ids.txPaid!, ids.txNew!] } } });
  await prisma.document.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});
const get = async (p: string) => (await (await fetch(base + p, { headers: { authorization: `Bearer ${token}` } })).json()) as { items: { label: string }[] };

test('suggestions de rapprochement : une facture déjà soldée par un autre paiement n’est plus proposée (la facture encore ouverte, si)', async () => {
  const r = await get(`/api/finance/bank/${ids.txNew}/suggestions`);
  const labels = r.items.map((i) => i.label).join(' | ');
  assert.doesNotMatch(labels, /FSETTLED-1/, 'facture payée : plus proposée');
  assert.match(labels, /FSETTLED-2/, 'facture ouverte du même montant : toujours proposée');
});

test('facture marquée « payée » : masquée dans les suggestions et la recherche manuelle', async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: ids.txPaid } }); // plus aucun virement rapproché, mais statut payé
  const auto = await get(`/api/finance/bank/${ids.txNew}/suggestions`);
  assert.doesNotMatch(auto.items.map((i) => i.label).join(' | '), /FSETTLED-1/);
  const manual = await get(`/api/finance/bank/${ids.txNew}/suggestions?q=FSETTLED-1`);
  assert.doesNotMatch(manual.items.map((i) => i.label).join(' | '), /FSETTLED-1/, 'la recherche manuelle exclut les factures soldées');
});
