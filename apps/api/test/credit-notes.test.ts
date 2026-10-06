import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  wsId = (await prisma.worksite.create({ data: { ref: 'R-NCTEST', title: 'Notes de crédit test', source: 'test' } })).id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: wsId } } });
  await prisma.document.deleteMany({ where: { worksiteId: wsId, kind: 'credit_note' } });
  await prisma.document.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
async function issuedInvoice(ht: number, vatRate = 0.06) {
  const created = await post('/api/documents', { kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Travaux', qty: 1, unitPriceHt: ht, vatRate }] });
  const issued = await post(`/api/documents/${created.body.document.id}/issue`);
  return issued.body.document as { id: string; number: string; totalTtc: number };
}

test('note de crédit émise : écriture du grand livre NÉGATIVE (réduit le CA) et jamais « à encaisser »', async () => {
  const inv = await issuedInvoice(1000);
  const cn = await post(`/api/documents/${inv.id}/credit-note`, { issue: true });
  assert.equal(cn.status, 201);
  assert.match(cn.body.document.number, /^NC\d{4}-\d+$/);
  const entry = await prisma.ledgerEntry.findUnique({ where: { documentId: cn.body.document.id } });
  assert.equal(entry!.direction, 'credit_note');
  assert.equal(entry!.ht, -1000);
  assert.equal(entry!.ttc, -1060);
  assert.equal(entry!.paymentStatus, 'Payé');
});

test('crédit total émis : la facture d’origine passe « créditée » ; un nouveau crédit est refusé (409)', async () => {
  const inv = await issuedInvoice(500);
  const draft = await post(`/api/documents/${inv.id}/credit-note`);
  assert.equal(draft.body.document.status, 'draft');
  assert.equal(draft.body.document.parentId, inv.id);
  let parent = await prisma.document.findUniqueOrThrow({ where: { id: inv.id } });
  assert.notEqual(parent.status, 'credited', 'un brouillon ne crédite pas encore la facture');
  await post(`/api/documents/${draft.body.document.id}/issue`);
  parent = await prisma.document.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(parent.status, 'credited');
  assert.equal((await post(`/api/documents/${inv.id}/credit-note`)).status, 409);
});

test('crédit partiel : montant TTC exact, facture inchangée tant que tout n’est pas crédité, plafond au reste à créditer', async () => {
  const inv = await issuedInvoice(1000); // 1 060 € TTC
  const p1 = await post(`/api/documents/${inv.id}/credit-note`, { amountTtc: 318, reason: 'remise commerciale', issue: true });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.document.totalTtc, 318);
  assert.match(p1.body.document.note, /partielle.*remise commerciale/);
  let parent = await prisma.document.findUniqueOrThrow({ where: { id: inv.id } });
  assert.notEqual(parent.status, 'credited');

  const tooMuch = await post(`/api/documents/${inv.id}/credit-note`, { amountTtc: 800 }); // il ne reste que 742
  assert.equal(tooMuch.status, 422);
  assert.match(tooMuch.body.error, /742,00/);

  const rest = await post(`/api/documents/${inv.id}/credit-note`, { issue: true }); // sans montant : le reste
  assert.equal(rest.body.document.totalTtc, 742);
  parent = await prisma.document.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(parent.status, 'credited');
});

test('crédit partiel à un montant TTC « difficile » : retombe exactement sur le montant demandé', async () => {
  const inv = await issuedInvoice(7900.88); // 8 374,93 € TTC
  const cn = await post(`/api/documents/${inv.id}/credit-note`, { amountTtc: 1234.57 });
  assert.equal(cn.body.document.totalTtc, 1234.57);
});

test('facture historique du grand livre (sans document) : « créer le document » puis note de crédit dessus', async () => {
  const e = await prisma.ledgerEntry.create({
    data: { direction: 'sale', docType: 'Facture de vente', docNumber: 'F2026-NCHIST', date: new Date('2026-05-28'), worksiteId: wsId, supplierName: 'Client historique', ht: 7900.88, vatDue: 474.05, ttc: 8374.93, paymentStatus: 'Payé', source: 'xlsx' },
  });
  const listed = await (await fetch(`${base}/api/finance/ledger-sync/historical?q=NCHIST`, { headers: H() })).json() as { items: { id: string; docNumber: string }[]; total: number };
  assert.deepEqual(listed.items.map((x) => x.docNumber), ['F2026-NCHIST'], 'listée tant qu’elle n’a pas de document');
  const made = await post(`/api/documents/from-ledger/${e.id}`);
  assert.equal(made.status, 201);
  const listedAfter = await (await fetch(`${base}/api/finance/ledger-sync/historical?q=NCHIST`, { headers: H() })).json() as { items: unknown[] };
  assert.equal(listedAfter.items.length, 0, 'plus listée une fois le document créé');
  assert.equal(made.body.document.number, 'F2026-NCHIST');
  assert.equal(made.body.document.totalTtc, 8374.93);
  assert.equal(made.body.document.status, 'paid');
  assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.id } })).documentId, made.body.document.id, 'l’écriture est adoptée');
  assert.equal(await prisma.ledgerEntry.count({ where: { docNumber: 'F2026-NCHIST' } }), 1, 'jamais de doublon au grand livre');

  const again = await post(`/api/documents/from-ledger/${e.id}`); // idempotent
  assert.equal(again.status, 200);
  assert.equal(again.body.document.id, made.body.document.id);

  const cn = await post(`/api/documents/${made.body.document.id}/credit-note`, { issue: true });
  assert.equal(cn.status, 201);
  assert.equal(cn.body.document.totalTtc, 8374.93);
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: made.body.document.id } })).status, 'credited');
  assert.equal((await post('/api/documents/from-ledger/inconnue')).status, 404);
});

test('note de crédit : refusée sur un brouillon de facture ou sur un devis', async () => {
  const draft = await post('/api/documents', { kind: 'invoice', worksiteId: wsId, lines: [{ label: 'x', qty: 1, unitPriceHt: 10, vatRate: 0 }] });
  assert.equal((await post(`/api/documents/${draft.body.document.id}/credit-note`)).status, 422);
  const quote = await post('/api/documents', { kind: 'quote', worksiteId: wsId, lines: [{ label: 'x', qty: 1, unitPriceHt: 10, vatRate: 0 }] });
  assert.equal((await post(`/api/documents/${quote.body.document.id}/credit-note`)).status, 422);
});

test('facture CRÉDITÉE : un paiement rattaché met à jour son « payé » sans changer son statut, et elle n’est jamais « à encaisser » au grand livre', async () => {
  const inv = await issuedInvoice(1000); // 1 060 € TTC
  await post(`/api/documents/${inv.id}/credit-note`, { issue: true });
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: inv.id } })).status, 'credited');
  const tx = await prisma.bankTransaction.create({ data: { bookingDate: new Date('2026-06-01'), amount: 1060, description: 'VERSEMENT test facture créditée', side: 'in', bank: 'Belfius', source: 'test' } });
  const r = await post(`/api/finance/bank/${tx.id}/matches`, { documentId: inv.id });
  assert.equal(r.status, 201);
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(doc.status, 'credited', 'le statut reste « créditée »');
  assert.equal(doc.paidAmount, 1060, 'le paiement est bien enregistré sur la facture');
  assert.ok(doc.paidOn);
  assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({ where: { documentId: inv.id } })).paymentStatus, 'Payé');
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: tx.id } });
  await prisma.bankTransaction.delete({ where: { id: tx.id } });
});
