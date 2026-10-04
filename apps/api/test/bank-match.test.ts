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

test('isInternalMovement : virements entre comptes JJD, recharges et relevés VISA ne se rapprochent jamais', async () => {
  const { isInternalMovement } = await import('../src/lib/bank-match.js');
  assert.equal(isInternalMovement({ description: 'VIREMENT INSTANTANE BELFIUS MOBILE VERS BE64 3632 5469 4152 Jjd Consult REF. : 0905471864798' }), true);
  assert.equal(isInternalMovement({ description: 'Instantoverschrijving in euro Van: JJD CONSULT - BE31068949400055' }), true);
  assert.equal(isInternalMovement({ counterpartyAccount: 'BE31 0689 4940 0055' }), true);
  assert.equal(isInternalMovement({ description: 'VISA RELEVE NUMERO 116 REF. : 0827556272771 VAL. 06-05' }), true);
  assert.equal(isInternalMovement({ description: 'CHARGEMENT DE LA CARTE VISA BUSINESS GOLD PREPAID NO 4569' }), true);
  assert.equal(isInternalMovement({ description: 'CHARGEMENT DE LA CARTE PREPAID VISA BUSINESS GOLD PREPAID NO 4569 58** **** 7639' }), true);
  assert.equal(isInternalMovement({ description: 'DECHARGEMENT DE LA CARTE PREPAID VISA BUSINESS GOLD PREPAID NO 4569 58** **** 8031' }), true);
  // un client qui paie JJD (JJD bénéficiaire) n'est PAS un virement interne
  assert.equal(isInternalMovement({ description: 'VERSEMENT DE BE33 2100 4334 8746 STEVENART VERS BE31 0689 4940 0055 SPRL JJD Consult REF. : 080G73L285131' }), false);
  assert.equal(isInternalMovement({ description: 'ACHAT VISA BUSINESS GOLD NO 4569 59** **** 7449 AU NOM DE SWEERT JULIEN' }), false);
});

test('pickCitedMatch : paiement partiel d’une facture citée par son numéro (acompte puis solde)', async () => {
  const { pickCitedMatch, invoiceTokens } = await import('../src/lib/bank-match.js');
  const inv = { id: 'L1', ttc: 58300, ht: 55000, date: new Date('2026-08-01'), direction: 'sale', bankComm: null, supplierName: null, contactName: 'Jacobs', documentId: 'D1' };
  const other = { ...inv, id: 'L2', documentId: 'D2' };
  const byNumber = new Map([['F2026336', [inv]], ['F2026337', [other]]]);
  const left = (l: { id: string; ttc: number | null }) => (l.ttc ?? 0) - (l.id === 'L1' ? 40000 : 0); // 40 000 € déjà payés sur F2026-336
  const tx = (desc: string, amount: number, side: string) => ({ amount, side, description: desc, communication: null });
  assert.deepEqual(invoiceTokens('SOLDE FACTURE F2026-336 VERS BE31 0689 4940 0055 REF. : 080G7A3059693'), ['F2026336']);
  // solde de 8 300 € sur 18 300 € restants : retenu
  assert.equal(pickCitedMatch(tx('SOLDE FACTURE F2026-336 JACOBS', 8300, 'in'), byNumber, left), 'L1');
  // dépasse ce qui reste à payer : écarté
  assert.equal(pickCitedMatch(tx('FACTURE F2026-336', 20000, 'in'), byNumber, left), null);
  // sens incohérent (sortie pour une vente) : écarté
  assert.equal(pickCitedMatch(tx('FACTURE F2026-336', 8300, 'out'), byNumber, left), null);
  // deux factures citées : à traiter à la main
  assert.equal(pickCitedMatch(tx('FACTURES F2026-336 ET F2026-337', 8300, 'in'), byNumber, left), null);
  // facture déjà soldée : rien à rapprocher
  assert.equal(pickCitedMatch(tx('FACTURE F2026-336', 100, 'in'), byNumber, () => 0), null);
});

test('paiement groupé : « Factures F2026/ 65,66,67 » rapproche chaque facture pour sa part, à la cent près', async () => {
  const { pickGroupedMatch, invoiceNumbersIn, paymentMessage } = await import('../src/lib/bank-match.js');
  const mk = (id: string, ttc: number) => ({ id, ttc, ht: ttc / 1.06, date: new Date('2026-02-01'), direction: 'sale', bankComm: null, supplierName: null, contactName: 'Beerlandt', documentId: 'D' + id });
  const idx = new Map([['2026-65', [mk('L65', 10000)]], ['2026-66', [mk('L66', 8000)]], ['2026-67', [mk('L67', 12051.18)]], ['2026-68', [mk('L68', 5000)]]]);
  const left = (l: { ttc: number | null }) => l.ttc ?? 0;
  const ing = (msg: string, amount: number) => ({ amount, side: 'in', bookingDate: new Date('2026-03-16'), description: `Instantoverschrijving in euro Van: M JOHAN - BE35 Instant op 16/03 - 17:17:13 Mededeling: ${msg} Persoonlijke info: 84c9fea775`, communication: null });

  assert.equal(paymentMessage(ing('Factures F2026/ 65,66,67', 1)), 'Factures F2026/ 65,66,67');
  assert.deepEqual(invoiceNumbersIn('Factures F2026/ 65,66,67,68,69,70'), [65, 66, 67, 68, 69, 70]);
  assert.deepEqual(invoiceNumbersIn('F2026 302 291 290'), [302, 291, 290]);
  assert.deepEqual(invoiceNumbersIn('Facture 2026-134'), [134]);
  assert.deepEqual(invoiceNumbersIn('Facture D2026-059 VB26/338'), []);
  assert.deepEqual(invoiceNumbersIn('F 079'), [79]);
  assert.deepEqual(invoiceNumbersIn('Factures 187 278 28...'), [187, 278]); // dernier nombre tronqué écarté
  assert.deepEqual(invoiceNumbersIn('Solde travaux non termines'), []);

  // 10 000 + 8 000 + 12 051,18 = 30 051,18 : les trois factures citées, chacune pour sa part
  const all = pickGroupedMatch(ing('Factures F2026/ 65,66,67', 30051.18), idx, left)!;
  assert.deepEqual(all.map((p) => [p.ledgerId, p.amount]), [['L65', 10000], ['L66', 8000], ['L67', 12051.18]]);
  // une facture citée en trop (68) : le seul sous-ensemble qui égale le virement est retenu
  const sub = pickGroupedMatch(ing('Factures F2026/ 65,66,67,68', 18000), idx, left)!;
  assert.deepEqual(sub.map((p) => p.ledgerId), ['L65', 'L66']);
  // aucun sous-ensemble ne tombe juste : rien (à la main)
  assert.equal(pickGroupedMatch(ing('Factures F2026/ 65,66,67', 12345), idx, left), null);
  // une seule facture citée, paiement partiel
  assert.deepEqual(pickGroupedMatch(ing('Facture F2026-65', 4000), idx, left)!.map((p) => p.amount), [4000]);
  // paiement supérieur à ce qui reste : écarté ; sortie d'argent : jamais
  assert.equal(pickGroupedMatch(ing('Facture F2026-65', 11000), idx, left), null);
  assert.equal(pickGroupedMatch({ ...ing('Factures F2026/ 65,66', 18000), side: 'out' }, idx, left), null);
});
