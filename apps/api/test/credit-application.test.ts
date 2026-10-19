import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { supplierAccounts } from '../src/lib/supplier-account.js';

let server: Server; let base = ''; let token = '';
const ids: { c?: string; ws?: string; e: string[] } = { e: [] };
const call = async (method: string, p: string, body?: object) => {
  const r = await fetch(`${base}/api/finance/expenses${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const mk = async (data: Record<string, unknown>) => { const e = await prisma.ledgerEntry.create({ data: { source: 'test-credit', year: 2026, contactId: ids.c, supplierName: 'Quadrus Credit Test', worksiteId: ids.ws, ...data } as never }); ids.e.push(e.id); return e; };

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.c = (await prisma.contact.create({ data: { name: 'Quadrus Credit Test', normalizedName: 'quadrus credit test', type: 'supplier' } })).id;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-CREDIT', title: 'Chantier avoir', source: 'test' } })).id;
});
after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids.e } } });
  await prisma.contact.deleteMany({ where: { id: ids.c } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});

test('avoir imputé sur deux factures (cas Quadrus) : factures payées, crédit restant 0, refus si trop', async () => {
  const nc = await mk({ direction: 'credit_note', docNumber: 'NC-1', ht: -3432, ttc: -4152.72, date: new Date('2026-05-28') });
  const f1 = await mk({ direction: 'purchase', docNumber: 'F-673', ht: 556.52, ttc: 673.39, paymentStatus: 'Non payé', date: new Date('2026-06-12') });
  const f2 = await mk({ direction: 'purchase', docNumber: 'F-2953', ht: 2875.48, ttc: 3479.33, paymentStatus: 'Non payé', date: new Date('2026-06-18') });

  const before = (await supplierAccounts()).find((a) => a.contactId === ids.c)!;
  assert.equal(before.credits, 4152.72); assert.equal(before.openTtc, 4152.72);

  const info = await call('GET', `/${nc.id}/credit-applications`);
  assert.equal(info.body.role, 'credit'); assert.equal(info.body.remaining, 4152.72);
  assert.deepEqual(info.body.candidates.map((c: { docNumber: string }) => c.docNumber).sort(), ['F-2953', 'F-673']);

  assert.equal((await call('POST', `/${nc.id}/apply-credit`, { otherId: f1.id, amount: 700 })).status, 422, 'plus que la facture');
  assert.equal((await call('POST', `/${nc.id}/apply-credit`, { otherId: f1.id, amount: 673.39 })).status, 201);
  assert.equal((await call('POST', `/${nc.id}/apply-credit`, { otherId: f2.id, amount: 3479.33 })).status, 201);
  assert.equal((await call('POST', `/${nc.id}/apply-credit`, { otherId: f2.id, amount: 1 })).status, 422, 'facture déjà payée / avoir épuisé');

  assert.equal((await call('GET', `/${f1.id}`)).body.expense.paymentStatus, 'Payé');
  assert.equal((await prisma.ledgerEntry.findUnique({ where: { id: f2.id } }))?.paymentStatus, 'Payé');
  const after = (await supplierAccounts()).find((a) => a.contactId === ids.c)!;
  assert.equal(after.credits, 0, 'crédit entièrement utilisé'); assert.equal(after.openTtc, 0, 'plus rien à payer');
  assert.equal(after.balance, 0);

  // côté facture : on voit l'avoir imputé ; annuler rend le crédit et remet la facture « à payer »
  const inv = await call('GET', `/${f2.id}/credit-applications`);
  assert.equal(inv.body.role, 'invoice'); assert.equal(inv.body.applications[0].amount, 3479.33);
  assert.equal((await call('DELETE', `/credit-applications/${inv.body.applications[0].id}`)).status, 200);
  const undone = (await supplierAccounts()).find((a) => a.contactId === ids.c)!;
  assert.equal(undone.credits, 3479.33); assert.equal(undone.openTtc, 3479.33);
  assert.equal((await prisma.ledgerEntry.findUnique({ where: { id: f2.id } }))?.paymentStatus, 'Non payé');
});

test('imputation refusée entre fournisseurs différents', async () => {
  const nc = await mk({ direction: 'credit_note', docNumber: 'NC-2', ht: -10, ttc: -12.1, date: new Date('2026-05-28') });
  const other = await prisma.ledgerEntry.create({ data: { source: 'test-credit', year: 2026, direction: 'purchase', docNumber: 'F-AUTRE', supplierName: 'Autre Fournisseur', ht: 10, ttc: 12.1, date: new Date('2026-05-29') } });
  ids.e.push(other.id);
  assert.equal((await call('POST', `/${nc.id}/apply-credit`, { otherId: other.id, amount: 12.1 })).status, 422);
});
