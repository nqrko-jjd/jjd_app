import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { supplierAccounts } from '../src/lib/supplier-account.js';

const ids: { c?: string; e: string[] } = { e: [] };
after(async () => { await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids.e } } }); await prisma.contact.deleteMany({ where: { id: ids.c } }); });

test('comptes fournisseurs : un avoir sans contact, nommé comme le fournisseur (casse différente), rejoint son compte', async () => {
  ids.c = (await prisma.contact.create({ data: { name: 'Quadrus - MD CENTER TEST', normalizedName: 'quadrus md center test', type: 'supplier' } })).id;
  const mk = async (data: Record<string, unknown>) => { const e = await prisma.ledgerEntry.create({ data: { source: 'test-merge', year: 2026, ...data } as never }); ids.e.push(e.id); return e; };
  await mk({ direction: 'purchase', docNumber: 'MERGE-F1', contactId: ids.c, supplierName: 'Quadrus - MD CENTER TEST', ht: 100, ttc: 121, date: new Date('2026-05-01'), dueDate: new Date('2026-12-01') });
  await mk({ direction: 'credit_note', docNumber: 'MERGE-NC1', supplierName: 'Quadrus - MD Center TEST', ht: -50, ttc: -60.5, date: new Date('2026-05-28') }); // sans contact, casse différente
  const accounts = (await supplierAccounts()).filter((a) => /quadrus - md center test/i.test(a.name));
  assert.equal(accounts.length, 1, 'un seul compte, pas deux');
  assert.equal(accounts[0]!.contactId, ids.c);
  assert.equal(accounts[0]!.credits, 60.5, 'l’avoir est sur le même compte que la facture');
  assert.equal(accounts[0]!.openTtc, 121);
  assert.equal(accounts[0]!.balance, 60.5, 'solde net : 121 − 60,50');
});
