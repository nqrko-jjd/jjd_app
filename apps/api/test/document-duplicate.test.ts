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
  wsId = (await prisma.worksite.create({ data: { ref: 'R-DUPTEST', title: 'Duplication test', source: 'test' } })).id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: wsId } } });
  await prisma.document.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('dupliquer dans un autre type : facture -> devis (brouillon indépendant) -> facture ; même type ; note de crédit sur facture émise refusée ici', async () => {
  const mk = await post('/api/documents', { kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Travaux', qty: 2, unitPriceHt: 100, vatRate: 0.06 }] });
  const inv = mk.body.document as { id: string };
  const asQuote = await post(`/api/documents/${inv.id}/duplicate`, { kind: 'quote' });
  assert.equal(asQuote.status, 201);
  assert.equal(asQuote.body.document.kind, 'quote');
  assert.equal(asQuote.body.document.status, 'draft');
  assert.equal(asQuote.body.document.totalHt, 200);
  assert.equal(asQuote.body.document.parentId ?? null, null);
  assert.match(asQuote.body.document.note, /Copie du/);
  const back = await post(`/api/documents/${asQuote.body.document.id}/duplicate`, { kind: 'invoice' });
  assert.equal(back.body.document.kind, 'invoice');
  assert.equal((await post(`/api/documents/${inv.id}/duplicate`, {})).body.document.kind, 'invoice');
  await post(`/api/documents/${inv.id}/issue`);
  assert.equal((await post(`/api/documents/${inv.id}/duplicate`, { kind: 'credit_note' })).status, 422, 'une facture émise passe par « Note de crédit… »');
  assert.equal((await post(`/api/documents/${inv.id}/duplicate`, { kind: 'bidon' })).status, 422);
  // devis -> note de crédit libre (brouillon, sans lien)
  const free = await post(`/api/documents/${asQuote.body.document.id}/duplicate`, { kind: 'credit_note' });
  assert.equal(free.status, 201);
  assert.equal(free.body.document.kind, 'credit_note');
  assert.equal(free.body.document.parentId ?? null, null);
});
