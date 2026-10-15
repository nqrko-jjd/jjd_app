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

test('Peppol routes the raw PO and buyer reference into distinct structured fields for all sale types', () => {
  for (const kind of ['invoice', 'deposit_invoice', 'credit_note']) {
    for (const poNumber of [' 4500135126 ', ' 00456789402 ', '', '   ', null, undefined]) {
      const d = {
        kind, number: 'F-TEST-PO', issuedOn: new Date('2026-10-13'), dueOn: null,
        structuredComm: '+++020/2600/41810+++', customerRef: ' DOSSIER-12 ', poNumber,
        billingName: 'Client Test', billingVat: 'BE1003823997', billingAddress: 'Rue du Pont 12, 1000 Bruxelles',
        contact: null, worksite: { ref: 'R-667' }, totalTtc: 13074,
        lines: [{ kind: 'item', label: 'Travaux', qty: 1, unitPriceHt: 13074, discountPct: 0, vatRate: 0 }],
      };
      const payload = JSON.parse(JSON.stringify(buildPeppolPayload(d, { iban: 'BE31068949400055' })));
      assert.equal(payload.document.purchaseOrderReference, poNumber?.trim() || undefined);
      assert.equal(Object.hasOwn(payload.document, 'purchaseOrderReference'), !!poNumber?.trim());
      assert.equal(payload.document.buyerReference, 'DOSSIER-12');
      assert.equal(payload.document.paymentMeans[0].reference, '+++020/2600/41810+++');
      assert.match(payload.document.note, /Chantier R-667/);
      const withoutBuyer = buildPeppolPayload({ ...d, customerRef: '  ' }, { iban: '' });
      assert.equal(Object.hasOwn(withoutBuyer.document, 'buyerReference'), false);
      assert.equal(withoutBuyer.document.purchaseOrderReference, poNumber?.trim() || undefined);
    }
  }
});
