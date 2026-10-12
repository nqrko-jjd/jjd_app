import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { buildPeppolPayload } from '../src/lib/peppol.js';

let server: Server;
let base = '';
let token = '';
const ids: string[] = [];
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  assert.ok(token);
});
after(async () => {
  await prisma.documentLine.deleteMany({ where: { documentId: { in: ids } } });
  await prisma.document.deleteMany({ where: { id: { in: ids } } });
  server.close();
});
async function request(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(base + '/api/documents' + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (r.status === 201 && data.document?.id) ids.push(data.document.id);
  return { status: r.status, data };
}
test('PO is independent, survives persistence and duplication, and can be cleared', async () => {
  const created = await request('', 'POST', { kind: 'invoice', customerRef: 'DOSSIER-12', poNumber: ' 00456789402 ', lines: [{ label: 'Travaux', qty: 1, unitPriceHt: 100, vatRate: 0.21 }] });
  assert.equal(created.status, 201);
  const id = created.data.document.id;
  assert.equal(created.data.document.poNumber, '00456789402');
  assert.equal(created.data.document.customerRef, 'DOSSIER-12');
  assert.equal((await request('/' + id)).data.document.poNumber, '00456789402');
  assert.equal((await request('/' + id, 'PATCH', { poNumber: '456789402' })).status, 200);
  assert.equal((await request('/' + id)).data.document.poNumber, '456789402');
  const copy = await request('/' + id + '/duplicate', 'POST', {});
  assert.equal(copy.status, 201);
  assert.equal(copy.data.document.poNumber, '456789402');
  assert.equal(copy.data.document.customerRef, 'DOSSIER-12');
  await request('/' + id, 'PATCH', { title: 'Updated' });
  assert.equal((await request('/' + id)).data.document.poNumber, '456789402');
  assert.equal((await request('/' + id, 'PATCH', { poNumber: 'x'.repeat(161) })).status, 422);
  await request('/' + id, 'PATCH', { poNumber: '' });
  assert.equal((await request('/' + id)).data.document.poNumber, null);
  assert.equal((await request('/' + id)).data.document.customerRef, 'DOSSIER-12');
});
test('Peppol note retains both references', () => {
  const payload = buildPeppolPayload({
    kind: 'invoice', number: 'F-TEST-PO', issuedOn: new Date(), dueOn: new Date(),
    structuredComm: null, customerRef: 'DOSSIER-12', poNumber: '00456789402',
    billingName: 'Client Test', billingVat: 'BE1003823997', billingAddress: 'Rue du Pont 12, 1000 Bruxelles',
    contact: null, totalTtc: 121,
    lines: [{ kind: 'item', label: 'Travaux', qty: 1, unitPriceHt: 100, discountPct: 0, vatRate: 0.21 }],
  }, { iban: '' });
  assert.match(payload.document.note ?? '', /Réf\. client : DOSSIER-12/);
  assert.match(payload.document.note ?? '', /Référence de commande : 00456789402/);
});
