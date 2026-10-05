import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let entryId = '';
const txIds: string[] = [];

async function sug(params = '') {
  const r = await fetch(`${base}/api/finance/expenses/${entryId}/bank-suggestions${params ? `?${params}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as { items: { id: string; amount: number; matchedTo: string[]; description: string | null }[]; manual: boolean };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  entryId = (await prisma.ledgerEntry.create({ data: { direction: 'purchase', ttc: 120.5, ht: 99.59, date: new Date('2026-03-10'), supplierName: 'Fournisseur Recherche Test', docNumber: 'FRT-001', source: 'test' } })).id;
  const mk = async (amount: number, date: string, desc: string, name: string) => {
    const t = await prisma.bankTransaction.create({ data: { amount, bookingDate: new Date(date), side: amount < 0 ? 'out' : 'in', bank: 'Belfius', counterpartyName: name, description: desc, source: 'test' } });
    txIds.push(t.id);
    return t;
  };
  await mk(-120.5, '2026-03-12', 'VIREMENT vers Fournisseur Recherche Test REF 111', 'FOURNISSEUR RECHERCHE TEST');
  await mk(-60, '2026-01-02', 'PAIEMENT PARTIEL zzuniqueword acompte', 'AUTRE NOM');
  const matched = await mk(-45, '2026-02-02', 'AUTRE zzuniqueword dejalie', 'AUTRE NOM');
  const other = await prisma.ledgerEntry.create({ data: { direction: 'purchase', ttc: 45, ht: 37, docNumber: 'AUTRE-9', source: 'test', supplierName: 'Autre' } });
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: matched.id, ledgerEntryId: other.id } });
});

after(async () => {
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: { in: txIds } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ id: entryId }, { docNumber: 'AUTRE-9' }] } });
  server.close();
});

test('sans critère : propositions automatiques (même montant ± 1 €, ± 2 mois), comportement inchangé', async () => {
  const r = await sug();
  assert.equal(r.manual, false);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0]!.amount, -120.5);
});

test('recherche libre par texte : trouve un paiement de montant différent (acompte), un mot du libellé suffit', async () => {
  const r = await sug('q=zzuniqueword');
  assert.equal(r.manual, true);
  assert.deepEqual(r.items.map((i) => i.amount), [-60], 'le paiement déjà rapproché (45 €) est exclu par défaut');
});

test('« inclure les paiements déjà rapprochés » : ils ressortent avec la facture à laquelle ils sont liés', async () => {
  const r = await sug('q=zzuniqueword&all=1');
  assert.equal(r.items.length, 2);
  const linked = r.items.find((i) => i.amount === -45)!;
  assert.deepEqual(linked.matchedTo, ['AUTRE-9']);
});

test('recherche par montant (± 0,50 €, sens indifférent) et par période', async () => {
  const byAmt = await sug('amount=60');
  assert.deepEqual(byAmt.items.map((i) => i.amount), [-60]);
  const byDate = await sug('from=2026-03-01&to=2026-03-31');
  assert.deepEqual(byDate.items.map((i) => i.amount), [-120.5]);
});

test('plusieurs mots : tous doivent figurer (libellé, contrepartie ou communication)', async () => {
  const both = await sug('q=virement%20REF%20111');
  assert.equal(both.items.length, 1);
  const none = await sug('q=virement%20zzuniqueword');
  assert.equal(none.items.length, 0);
});
