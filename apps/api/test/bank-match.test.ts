import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { pickMatch, autoMatchAll, type LedgerLite } from '../src/lib/bank-match.js';
import { normalizeStructuredComm, normalizePontoTx } from '../src/lib/ponto.js';

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

const ids: string[] = [];
before(async () => {
  const ws = await prisma.worksite.create({ data: { ref: 'R-BM-TEST', title: 'bank match', source: 'test' } });
  ids.push(ws.id);
  const l1 = await prisma.ledgerEntry.create({
    data: { direction: 'sale', ttc: 1210, ht: 1000, date: new Date('2026-04-15'), bankComm: '+++090/9337/55493+++', worksiteId: ws.id, source: 'test' },
  });
  const l2 = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', ttc: 480.75, ht: 397.31, date: new Date('2026-04-20'), supplierName: 'Cebeo', source: 'test' },
  });
  ids.push(l1.id, l2.id);
  await prisma.bankTransaction.createMany({
    data: [
      { amount: 1210, bookingDate: new Date('2026-04-16'), structuredComm: '090933755493', side: 'in', source: 'test' },
      { amount: -480.75, bookingDate: new Date('2026-04-21'), counterpartyName: 'CEBEO NV', side: 'out', source: 'test' },
      { amount: -1234567.89, bookingDate: new Date('2031-01-01'), counterpartyName: 'Inconnu', side: 'out', source: 'test' },
    ],
  });
});

after(async () => {
  await prisma.bankTransaction.deleteMany({ where: { source: 'test' } });
  await prisma.ledgerEntry.deleteMany({ where: { source: 'test' } });
  await prisma.worksite.deleteMany({ where: { ref: 'R-BM-TEST' } });
});

test('autoMatchAll : lie la comm structurée (strong) et le montant+nom (good)', async () => {
  const r = await autoMatchAll({ txFilter: { source: 'test' } });
  assert.ok(r.strong >= 1, `strong=${r.strong}`);
  assert.ok(r.good >= 1, `good=${r.good}`);

  const strong = await prisma.bankTransaction.findFirst({ where: { source: 'test', structuredComm: '090933755493' } });
  assert.equal(strong?.matchConfidence, 'strong');
  assert.ok(strong?.matchedLedgerId);

  const unmatched = await prisma.bankTransaction.findFirst({ where: { source: 'test', counterpartyName: 'Inconnu' } });
  assert.equal(unmatched?.matchedLedgerId, null);
});
