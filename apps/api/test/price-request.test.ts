import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { setMailTransportForTests } from '../src/lib/doc-mail.js';

let server: Server; let base = ''; let token = ''; let supplierId = ''; const orderIds: string[] = [];
const sent: Record<string, unknown>[] = [];
const call = (p: string, method = 'GET', body?: object) => fetch(`${base}/api/purchasing${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
  supplierId = (await prisma.contact.create({ data: { name: 'Fournisseur Prix SA', normalizedName: 'fournisseur prix sa', type: 'supplier', email: 'ventes@fournisseur-prix.be' } })).id;
  env.smtp.host = 'smtp.test'; env.smtp.user = 'info@jjd-consult.be'; env.smtp.password = 'x';
  setMailTransportForTests({ sendMail: async (opts: Record<string, unknown>) => { sent.push(opts); return {}; } } as never);
});
after(async () => {
  setMailTransportForTests(null); env.smtp.host = ''; env.smtp.user = ''; env.smtp.password = '';
  await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.contact.deleteMany({ where: { id: supplierId } });
  server.close();
});

test('demande de prix : e-mail au fournisseur depuis un brouillon uniquement', async () => {
  const created = await (await call('/orders', 'POST', { contactId: supplierId, status: 'draft', lines: [{ label: 'Carrelage 60x60', unitName: 'm²', qty: 12 }] })).json();
  const id = created.order.id as string; orderIds.push(id);

  const draft = await (await call(`/orders/${id}/price-request`)).json();
  assert.equal(draft.to, 'ventes@fournisseur-prix.be');
  assert.ok(draft.body.includes('Carrelage 60x60 : 12 m²'));

  const r = await call(`/orders/${id}/request-price`, 'POST', { to: draft.to, subject: draft.subject, body: draft.body });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.attachments, undefined);
  const after = await (await call(`/orders/${id}`)).json();
  assert.ok(after.order.priceRequestedAt);
  assert.equal(after.order.priceRequestedTo, 'ventes@fournisseur-prix.be');
  assert.equal(after.order.status, 'draft', 'la demande de prix ne passe pas la commande');

  await call(`/orders/${id}/place`, 'POST');
  const again = await call(`/orders/${id}/request-price`, 'POST', { to: draft.to, subject: 'x', body: 'y' });
  assert.equal(again.status, 409, 'plus de demande de prix une fois commandée');
});
