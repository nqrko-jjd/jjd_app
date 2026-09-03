import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await prisma.crmOpportunity.deleteMany({ where: { source: 'site' } });
  server.close();
});

const post = (body: unknown) =>
  fetch(`${base}/api/public/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('contact site : crée une opportunité CRM (source site)', async () => {
  const r = await post({
    name: 'Marie Dupont', company: 'ACP Les Tilleuls', email: 'marie@example.be',
    phone: '0470 12 34 56', type: 'Maintenance', location: 'Uccle',
    message: 'Infiltration dans le hall d’entrée, intervention souhaitée rapidement.',
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);

  const opp = await prisma.crmOpportunity.findFirst({ where: { source: 'site' }, orderBy: { createdAt: 'desc' } });
  assert.ok(opp);
  assert.equal(opp?.stage, 'new');
  assert.match(opp!.title, /Maintenance — Marie Dupont/);
  assert.match(opp!.note ?? '', /Uccle/);
});

test('contact site : honeypot rempli -> 200 sans opportunité', async () => {
  const before = await prisma.crmOpportunity.count({ where: { source: 'site' } });
  const r = await post({ name: 'Bot Spam', email: 'bot@spam.com', message: 'buy things', website: 'http://spam' });
  assert.equal(r.status, 200);
  assert.equal(await prisma.crmOpportunity.count({ where: { source: 'site' } }), before);
});

test('contact site : champs manquants -> 422', async () => {
  const r = await post({ name: 'X', email: 'pas-un-email', message: 'court' });
  assert.equal(r.status, 422);
});
