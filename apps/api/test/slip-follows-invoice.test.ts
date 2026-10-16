import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server; let base = ''; let token = '';
const ids: string[] = [];
const get = async (p: string) => (await fetch(`${base}/api/finance/expenses${p}`, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const entry = async (data: Record<string, unknown>) => { const e = await prisma.ledgerEntry.create({ data: { source: 'test-slip', year: 2026, ...data } as never }); ids.push(e.id); return e; };

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
});
after(async () => { await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids } } }); server.close(); });

test('un bordereau relié suit sa facture : payé comme elle, absent de la liste par défaut, listé dans la facture', async () => {
  const unpaid = await entry({ direction: 'purchase', docNumber: 'FT-SLIP-1', supplierName: 'Vector Test SRL', ht: 100, ttc: 121, paymentStatus: 'Non payé', date: new Date('2026-10-01') });
  const paidInv = await entry({ direction: 'purchase', docNumber: 'FT-SLIP-2', supplierName: 'Vector Test SRL', ht: 200, ttc: 242, paymentStatus: 'Payé', date: new Date('2026-10-02') });
  const slipLinked = await entry({ direction: 'delivery_slip', docNumber: 'BD-SLIP-1', supplierName: 'Vector Test SRL', ht: 200, ttc: 242, paymentStatus: 'Non payé', linkedInvoiceId: paidInv.id, date: new Date('2026-09-30') });
  const slipLinkedUnpaid = await entry({ direction: 'delivery_slip', docNumber: 'BD-SLIP-3', supplierName: 'Vector Test SRL', ht: 100, ttc: 121, paymentStatus: 'Payé', linkedInvoiceId: unpaid.id, date: new Date('2026-09-29') });
  const slipFree = await entry({ direction: 'delivery_slip', docNumber: 'BD-SLIP-2', supplierName: 'Vector Test SRL', ht: 50, ttc: 60.5, paymentStatus: 'Non payé', date: new Date('2026-09-28') });

  const list = await get('?q=SLIP&pageSize=200');
  const nums = list.items.map((e: { docNumber: string }) => e.docNumber);
  assert.ok(nums.includes('FT-SLIP-1') && nums.includes('FT-SLIP-2'), 'les factures sont listées');
  assert.ok(nums.includes('BD-SLIP-2'), 'un bordereau pas encore relié reste visible (en attente de facture)');
  assert.ok(!nums.includes('BD-SLIP-1') && !nums.includes('BD-SLIP-3'), 'un bordereau relié disparaît de la liste par défaut');
  assert.equal(list.totals.pendingSlips >= 1, true);

  const one = (await get(`/${slipLinked.id}`)).expense;
  assert.equal(one.paymentStatus, 'Payé', 'le bordereau relié à une facture payée est payé');
  assert.equal(one.remainingAmount, 0);
  const two = (await get(`/${slipLinkedUnpaid.id}`)).expense;
  assert.equal(two.paymentStatus, 'Non payé', 'et il reste à payer comme sa facture, même si lui-même était marqué payé');

  const inv = (await get(`/${paidInv.id}`)).expense;
  assert.deepEqual(inv.bordereaux.map((b: { docNumber: string }) => b.docNumber), ['BD-SLIP-1']);

  const slips = await get('?type=delivery_slip&q=SLIP&pageSize=200');
  assert.equal(slips.items.length, 3, 'la vue « Bordereaux » les montre tous, reliés compris');
  const paidSlips = (await get('?type=delivery_slip&paid=1&q=SLIP&pageSize=200')).items.map((e: { docNumber: string }) => e.docNumber);
  assert.deepEqual(paidSlips, ['BD-SLIP-1'], 'filtre « payé » : le bordereau de la facture payée seulement');
  const dueSlips = (await get('?type=delivery_slip&paid=0&q=SLIP&pageSize=200')).items.map((e: { docNumber: string }) => e.docNumber).sort();
  assert.deepEqual(dueSlips, ['BD-SLIP-2', 'BD-SLIP-3']);
  void slipFree;
});
