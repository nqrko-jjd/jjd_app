import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
const ids: { a?: string; b?: string; ws?: string } = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.a = (await prisma.contact.create({ data: { name: 'Fiche A test liens', normalizedName: 'fiche a test liens', type: 'client', email: 'a@test.be', note: 'note A' } })).id;
  ids.b = (await prisma.contact.create({ data: { name: 'Fiche B test liens', normalizedName: 'fiche b test liens', type: 'client', email: 'b@test.be', phone: '0470 00 00 00', note: 'note B' } })).id;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-LKTEST', title: 'Chantier liens', clientId: ids.b, source: 'test' } })).id;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  await prisma.contact.deleteMany({ where: { id: { in: [ids.a!, ids.b].filter(Boolean) as string[] } } });
  server.close();
});

const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const get = async (p: string) => { const r = await fetch(base + p, { headers: H() }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('rattachements : chantiers du client listés avec lien', async () => {
  const r = await get(`/api/contacts/${ids.b}/links`);
  assert.equal(r.status, 200);
  const g = r.body.groups.find((x: { key: string }) => x.key === 'Worksite.clientId');
  assert.equal(g.count, 1);
  assert.match(g.items[0].label, /R-LKTEST/);
  assert.equal(g.items[0].href, `/app/chantiers/${ids.ws}`);
  assert.equal((await get(`/api/contacts/${ids.a}/links`)).body.total, 0);
});

test('suppression refusée : le message dit à quoi la fiche est rattachée', async () => {
  const r = await fetch(`${base}/api/contacts/${ids.b}`, { method: 'DELETE', headers: H() });
  assert.equal(r.status, 409);
  const body = (await r.json()) as { error: string };
  assert.match(body.error, /Chantiers \(client\) : 1/);
});

test('aperçu de fusion : champs complétés, notes ajoutées, rattachements déplacés — sans rien écraser', async () => {
  const r = await get(`/api/contacts/merge-preview?keepId=${ids.a}&removeId=${ids.b}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.fill.map((f: { field: string }) => f.field).sort(), ['note', 'phone']);
  assert.deepEqual(r.body.differing.map((f: { field: string }) => f.field), ['email']); // e-mails différents : celui de la fiche conservée reste
  assert.equal(r.body.moves.find((g: { key: string }) => g.key === 'Worksite.clientId').count, 1);
  // fusion réelle : l'e-mail de A reste, le téléphone de B est ajouté, la note de B est ajoutée à la suite
  const m = await fetch(`${base}/api/contacts/merge`, { method: 'POST', headers: H(), body: JSON.stringify({ keepId: ids.a, removeIds: [ids.b] }) });
  assert.equal(m.status, 200);
  const a = await prisma.contact.findUniqueOrThrow({ where: { id: ids.a } });
  assert.equal(a.email, 'a@test.be');
  assert.equal(a.phone, '0470 00 00 00');
  assert.match(a.note ?? '', /note A[^]*note B/);
  assert.equal((await prisma.worksite.findUniqueOrThrow({ where: { id: ids.ws } })).clientId, ids.a);
  ids.b = undefined;
});
