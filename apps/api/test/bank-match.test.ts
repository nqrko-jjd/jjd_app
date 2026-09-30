import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { pickMatch, autoMatchAll, type LedgerLite } from '../src/lib/bank-match.js';
import { normalizeStructuredComm, normalizePontoTx } from '../src/lib/ponto.js';
import { syncLedgerEntryForDocument } from '../src/lib/documents.js';

const L = (o: Partial<LedgerLite>): LedgerLite => ({
  id: 'x', ttc: null, ht: 0, date: null, direction: 'sale', bankComm: null,
  supplierName: null, contactName: null, ...o,
});

test('normalizeStructuredComm : +++/format et 12 chiffres', () => {
  assert.equal(normalizeStructuredComm('+++084/2613/66074+++', 'structured'), '084261366074');
  assert.equal(normalizeStructuredComm('084/2613/66074'), '084261366074');
  assert.equal(normalizeStructuredComm('Facture 123'), null);
  assert.equal(normalizeStructuredComm(null), null);
});

test('normalizePontoTx : signe -> side, dates, comm', () => {
  const n = normalizePontoTx({
    id: 't1',
    attributes: {
      amount: -152.4, currency: 'EUR', counterpartName: 'BricoPro',
      remittanceInformation: '+++084/2613/66074+++', remittanceInformationType: 'structured',
      executionDate: '2026-05-10T00:00:00Z',
    },
  });
  assert.equal(n.side, 'out');
  assert.equal(n.amount, -152.4);
  assert.equal(n.structuredComm, '084261366074');
  assert.equal(n.bookingDate?.toISOString().slice(0, 10), '2026-05-10');
});

test('pickMatch : communication structurée unique -> strong', () => {
  const tx = { id: 'b1', amount: 500, bookingDate: new Date('2026-05-10'), structuredComm: '084261366074', counterpartyName: null, side: 'in' };
  const m = pickMatch(tx, [
    L({ id: 'good', bankComm: '+++084/2613/66074+++', ttc: 500 }),
    L({ id: 'other', bankComm: '+++111/2222/33344+++', ttc: 500 }),
  ]);
  assert.deepEqual(m, { ledgerId: 'good', confidence: 'strong' });
});

test('pickMatch : montant+date+sens, candidat unique -> good', () => {
  const tx = { id: 'b2', amount: -240.5, bookingDate: new Date('2026-05-10'), structuredComm: null, counterpartyName: 'Menuiserie Sud', side: 'out' };
  const m = pickMatch(tx, [
    L({ id: 'buy', direction: 'purchase', ttc: 240.5, date: new Date('2026-05-08') }),
    L({ id: 'sale', direction: 'sale', ttc: 240.5, date: new Date('2026-05-09') }), // mauvais sens
  ]);
  assert.deepEqual(m, { ledgerId: 'buy', confidence: 'good' });
});

test('pickMatch : délai de paiement normal (13 j) -> trouvé (régression Cedrimo, facture 13/08 payée 26/08)', () => {
  const tx = { id: 'b4', amount: 6776.37, bookingDate: new Date('2026-08-26'), structuredComm: null, counterpartyName: null, side: 'in' as const };
  const m = pickMatch(tx, [L({ id: 'inv', direction: 'sale', ttc: 6776.37, date: new Date('2026-08-13') })]);
  assert.deepEqual(m, { ledgerId: 'inv', confidence: 'good' });
});

test('pickMatch : retard extrême (> 45 j), pas de nom de contrepartie -> pas de correspondance automatique', () => {
  const tx = { id: 'b5', amount: 524.7, bookingDate: new Date('2026-08-26'), structuredComm: null, counterpartyName: null, side: 'in' as const };
  const m = pickMatch(tx, [L({ id: 'old-inv', direction: 'sale', ttc: 524.7, date: new Date('2026-04-30') })]);
  assert.equal(m, null);
});

test('pickMatch : retard extrême (102 j) mais montant unique + nom cohérent -> trouvé (régression ACP Stade 11)', () => {
  const tx = { id: 'b6', amount: 8469.4, bookingDate: new Date('2026-07-10'), structuredComm: null, counterpartyName: 'ACP STADE 11', side: 'in' as const };
  const m = pickMatch(tx, [L({ id: 'stade11', direction: 'sale', ttc: 8469.4, date: new Date('2026-03-30'), contactName: 'ACP Stade 11' })]);
  assert.deepEqual(m, { ledgerId: 'stade11', confidence: 'good' });
});

test('pickMatch : retard extrême + montant unique mais nom différent -> pas de correspondance (coïncidence de montant)', () => {
  const tx = { id: 'b7', amount: 8469.4, bookingDate: new Date('2026-07-10'), structuredComm: null, counterpartyName: 'Un Tiers Sans Rapport', side: 'in' as const };
  const m = pickMatch(tx, [L({ id: 'other', direction: 'sale', ttc: 8469.4, date: new Date('2026-03-30'), contactName: 'ACP Stade 11' })]);
  assert.equal(m, null);
});

test('pickMatch : retard extrême + montant non unique (plusieurs candidats) -> pas de correspondance', () => {
  const tx = { id: 'b8', amount: 8469.4, bookingDate: new Date('2026-07-10'), structuredComm: null, counterpartyName: 'ACP STADE 11', side: 'in' as const };
  const m = pickMatch(tx, [
    L({ id: 'stade11-a', direction: 'sale', ttc: 8469.4, date: new Date('2026-03-30'), contactName: 'ACP Stade 11' }),
    L({ id: 'stade11-b', direction: 'sale', ttc: 8469.4, date: new Date('2026-01-15'), contactName: 'ACP Stade 11' }),
  ]);
  assert.equal(m, null);
});

test('pickMatch : sens de transaction inconnu (side manquant à l\'import) -> jamais de correspondance (régression : paiement client 110€ faussement matché à un achat Apok sans rapport, même montant)', () => {
  const tx = { id: 'b9', amount: 110, bookingDate: new Date('2026-03-30'), structuredComm: null, counterpartyName: 'M Bernard Bassem', side: null };
  const m = pickMatch(tx, [L({ id: 'apok', direction: 'purchase', ttc: 110, date: new Date('2026-03-04'), supplierName: 'Apok' })]);
  assert.equal(m, null);
});

test('pickMatch : plusieurs candidats -> départage par nom, sinon null', () => {
  const base = { id: 'b3', amount: 1000, bookingDate: new Date('2026-05-10'), structuredComm: null, side: 'in' as const };
  const cands = [
    L({ id: 'a', direction: 'sale', ttc: 1000, date: new Date('2026-05-10'), contactName: 'ACP Algarve' }),
    L({ id: 'b', direction: 'sale', ttc: 1000, date: new Date('2026-05-11'), contactName: 'ACP Woodside' }),
  ];
  assert.equal(pickMatch({ ...base, counterpartyName: null }, cands), null);
  assert.deepEqual(pickMatch({ ...base, counterpartyName: 'ACP ALGARVE c/o Baltimo' }, cands), { ledgerId: 'a', confidence: 'good' });
});

/* ----------------------------------------------------------- autoMatchAll (DB) */

let wsId = '';
const ledgerIds: string[] = [];
const txIds: string[] = [];
before(async () => {
  const ws = await prisma.worksite.create({ data: { ref: 'R-BM-TEST', title: 'bank match', source: 'test' } });
  wsId = ws.id;
  const l1 = await prisma.ledgerEntry.create({
    data: { direction: 'sale', ttc: 1210, ht: 1000, date: new Date('2026-04-15'), bankComm: '+++090/9337/55493+++', worksiteId: ws.id, source: 'test' },
  });
  const l2 = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', ttc: 480.75, ht: 397.31, date: new Date('2026-04-20'), supplierName: 'Cebeo', source: 'test' },
  });
  ledgerIds.push(l1.id, l2.id);
  const t1 = await prisma.bankTransaction.create({
    data: { amount: 1210, bookingDate: new Date('2026-04-16'), structuredComm: '090933755493', side: 'in', source: 'test' },
  });
  const t2 = await prisma.bankTransaction.create({
    data: { amount: -480.75, bookingDate: new Date('2026-04-21'), counterpartyName: 'CEBEO NV', side: 'out', source: 'test' },
  });
  const t3 = await prisma.bankTransaction.create({
    data: { amount: -1234567.89, bookingDate: new Date('2031-01-01'), counterpartyName: 'Inconnu', side: 'out', source: 'test' },
  });
  txIds.push(t1.id, t2.id, t3.id);
});

after(async () => {
  // scopé par id (pas par source:'test', qui matcherait aussi les écritures créées
  // par d'autres fichiers de test tournant en parallèle)
  await prisma.bankTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: ledgerIds } } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
});

test('autoMatchAll : lie la comm structurée (strong) et le montant+nom (good)', async () => {
  const r = await autoMatchAll({ txFilter: { source: 'test' } });
  assert.ok(r.strong >= 1, `strong=${r.strong}`);
  assert.ok(r.good >= 1, `good=${r.good}`);

  const strong = await prisma.bankTransaction.findFirst({ where: { source: 'test', structuredComm: '090933755493' }, include: { matches: true } });
  assert.equal(strong?.matchConfidence, 'strong');
  assert.ok(strong?.matches.some((m) => m.ledgerEntryId));

  const unmatched = await prisma.bankTransaction.findFirst({ where: { source: 'test', counterpartyName: 'Inconnu' }, include: { matches: true } });
  assert.equal(unmatched?.matches.length, 0);
});

/* --- régression : une facture de vente rapprochée automatiquement doit passer
   « payée » (pas seulement son écriture de grand livre synchronisée) --- */
test('autoMatchAll : une facture de vente rapprochée passe "paid", pas seulement son écriture', async () => {
  const doc = await prisma.document.create({
    data: {
      kind: 'invoice', number: 'F-BM-TEST-1', status: 'sent',
      issuedOn: new Date('2026-06-01'), lockedAt: new Date('2026-06-01'),
      totalHt: 1000, totalVat: 210, totalTtc: 1210, paidAmount: 0,
      source: 'test',
    },
  });
  await syncLedgerEntryForDocument(doc.id);

  const tx = await prisma.bankTransaction.create({
    data: { amount: 1210, bookingDate: new Date('2026-06-05'), structuredComm: null, counterpartyName: null, side: 'in', source: 'test' },
  });

  try {
    await autoMatchAll({ txFilter: { id: tx.id } });

    const updatedDoc = await prisma.document.findUnique({ where: { id: doc.id } });
    assert.equal(updatedDoc?.status, 'paid', 'la facture doit passer "paid", pas rester "sent"');
    assert.equal(updatedDoc?.paidAmount, 1210);
    assert.ok(updatedDoc?.paidOn);

    const ledger = await prisma.ledgerEntry.findUnique({ where: { documentId: doc.id } });
    assert.equal(ledger?.paymentStatus, 'Payé', 'le grand livre doit aussi refléter le paiement');
  } finally {
    await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: tx.id } });
    await prisma.bankTransaction.delete({ where: { id: tx.id } });
    await prisma.ledgerEntry.deleteMany({ where: { documentId: doc.id } });
    await prisma.document.delete({ where: { id: doc.id } });
  }
});
