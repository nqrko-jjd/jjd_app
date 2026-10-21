import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';
const createdIds: string[] = [];

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  wsId = (await prisma.worksite.create({ data: { ref: 'R-CNLINK', title: 'Lien NC test', source: 'test' } })).id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
  await prisma.document.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
async function make(kind: string, unit: number) {
  const created = await (await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind, worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: unit, vatRate: 0.21 }] }) })).json();
  createdIds.push(created.document.id);
  await fetch(`${base}/api/documents/${created.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });
  return created.document.id as string;
}
const patch = (id: string, body: unknown) => fetch(`${base}/api/documents/${id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify(body) });

test('note de crédit libre : rattachement après coup à sa facture, puis détachement', async () => {
  const inv = await make('invoice', 200);
  const nc = await make('credit_note', 200);

  let list = await (await fetch(`${base}/api/documents?kind=credit_note&worksiteId=${wsId}`, { headers: auth() })).json();
  assert.equal(list.items.find((d: { id: string }) => d.id === nc).parent, null, 'au départ la NC n’est liée à aucune facture');

  const r = await patch(nc, { parentId: inv });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).document.parent.id, inv);

  list = await (await fetch(`${base}/api/documents?kind=credit_note&worksiteId=${wsId}`, { headers: auth() })).json();
  assert.equal(list.items.find((d: { id: string }) => d.id === nc).parent.number.length > 0, true, 'la liste expose la facture liée');
  const invList = await (await fetch(`${base}/api/documents?kind=invoice&worksiteId=${wsId}`, { headers: auth() })).json();
  assert.equal(invList.items.find((d: { id: string }) => d.id === inv).children.length, 1, 'la liste expose les NC de la facture');

  const invoice = await prisma.document.findUnique({ where: { id: inv } });
  assert.equal(invoice!.status, 'credited', 'facture entièrement couverte par la NC rattachée → créditée');

  const un = await patch(nc, { parentId: null });
  assert.equal(un.status, 200);
  assert.equal((await un.json()).document.parent, null);
});

test('rattachement refusé : facture inexistante, devis, soi-même, ou document qui n’est pas une NC', async () => {
  const inv = await make('invoice', 100);
  const nc = await make('credit_note', 100);
  const quote = await make('quote', 100);
  assert.equal((await patch(nc, { parentId: quote })).status, 422, 'un devis n’est pas une facture');
  assert.equal((await patch(nc, { parentId: nc })).status, 422, 'une NC ne s’annule pas elle-même');
  assert.equal((await patch(nc, { parentId: 'inexistant' })).status, 422);
  assert.equal((await patch(inv, { parentId: quote })).status, 422, 'seule une NC se rattache à une facture');
});
