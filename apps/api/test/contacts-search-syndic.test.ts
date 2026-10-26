import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let syndicId = '';
const contactIds: string[] = [];

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
});

after(async () => {
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.syndic.deleteMany({ where: { id: syndicId } });
  server.close();
});

test('recherche de contacts : un gestionnaire rattaché à un syndic est trouvé par son nom ou par celui du syndic, quel que soit son type', async () => {
  const syndic = await prisma.syndic.create({ data: { name: 'Syndic Zorglub', normalizedName: 'syndic zorglub' } });
  syndicId = syndic.id;
  const mk = async (name: string, type: string) => {
    const c = await prisma.contact.create({ data: { name, normalizedName: name.toLowerCase(), type, kind: 'individual', syndicId: syndic.id } });
    contactIds.push(c.id);
  };
  await mk('Gestionnaire Fournisseur', 'supplier');
  await mk('Gestionnaire Client', 'client');

  const search = async (qs: string) => {
    const r = await fetch(`${base}/api/contacts?${qs}&pageSize=20`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    return ((await r.json()).items as { name: string }[]).map((c) => c.name).sort();
  };
  assert.deepEqual(await search('type=all&q=zorglub'), ['Gestionnaire Client', 'Gestionnaire Fournisseur'], 'par le nom du syndic');
  assert.deepEqual(await search('type=all&q=gestionnaire%20fournisseur'), ['Gestionnaire Fournisseur'], 'par son nom, même fournisseur');
  assert.deepEqual(await search('type=client&q=zorglub'), ['Gestionnaire Client'], 'la recherche « client » seule ne le voyait pas');
});
