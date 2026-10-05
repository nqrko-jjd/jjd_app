import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { markOverdueInvoices } from '../src/lib/documents.js';
import { recomputeDocumentPayment } from '../src/lib/bank-match.js';
import { normalizeName } from '@jjd/shared';

const docs: string[] = [];
const txs: string[] = [];
let contactId = '';
const mkDoc = async (number: string, total: number, paid: number, status: string) => {
  if (!contactId) contactId = (await prisma.contact.create({ data: { name: 'Client Tolérance Test', normalizedName: normalizeName('Client Tolérance Test'), type: 'client' } })).id;
  const d = await prisma.document.create({
    data: { kind: 'invoice', direction: 'sale', status, number, contactId, issuedOn: new Date('2025-09-12'), dueOn: new Date('2025-09-22'), lockedAt: new Date('2025-09-12'), totalHt: total / 1.06, totalVat: total - total / 1.06, totalTtc: total, paidAmount: paid, source: 'test' },
  });
  docs.push(d.id);
  return d;
};
after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { documentId: { in: docs } } });
  await prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: { in: txs } } });
  await prisma.bankTransaction.deleteMany({ where: { id: { in: txs } } });
  await prisma.document.deleteMany({ where: { id: { in: docs } } });
  if (contactId) await prisma.contact.delete({ where: { id: contactId } });
});

test('facture « en retard » encaissée à 10 centimes près : repasse payée (arrondi), jamais « 0,10 € dû »', async () => {
  const d = await mkDoc('FTOL-001', 18802.44, 18802.34, 'overdue');
  await markOverdueInvoices();
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: d.id } })).status, 'paid');
});

test('facture réellement en retard (encaissement partiel) : reste en retard', async () => {
  const d = await mkDoc('FTOL-002', 1000, 400, 'overdue');
  await markOverdueInvoices();
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: d.id } })).status, 'overdue');
});

test('rapprochement bancaire à quelques centimes de la facture : payée', async () => {
  const d = await mkDoc('FTOL-003', 500, 0, 'sent');
  const tx = await prisma.bankTransaction.create({ data: { amount: 499.8, bookingDate: new Date('2025-09-16'), side: 'in', counterpartyName: 'Test', source: 'test' } });
  txs.push(tx.id);
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, documentId: d.id } });
  await recomputeDocumentPayment(d.id);
  const after1 = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(after1.status, 'paid');
  assert.equal(after1.paidAmount, 499.8);
});

test('écart plus important (5 €) : toujours partielle', async () => {
  const d = await mkDoc('FTOL-004', 500, 0, 'sent');
  const tx = await prisma.bankTransaction.create({ data: { amount: 495, bookingDate: new Date('2025-09-16'), side: 'in', counterpartyName: 'Test', source: 'test' } });
  txs.push(tx.id);
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, documentId: d.id } });
  await recomputeDocumentPayment(d.id);
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: d.id } })).status, 'partial');
});
