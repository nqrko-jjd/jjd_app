import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { rawPrisma as prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';

let server: Server; let base = '';
let scoped = ''; let office = '';
const ids: Record<string, string> = {};
const created = { users: [] as string[], ws: [] as string[] };
const login = async (email: string) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'jjd' }) })).json() as { token: string }).token;
const call = (t: string, method: string, url: string, body?: unknown) => fetch(`${base}${url}`, { method, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const u = await prisma.user.create({ data: { email: 'tonton-scope-test@jjd-consult.be', passwordHash: await hashPassword('jjd'), role: 'office', entityScope: 'tonton' } });
  created.users.push(u.id);
  const wj = await prisma.worksite.create({ data: { ref: 'R-SCOPE-J', title: 'Chantier JJD (scope)', entity: 'jjd', source: 'test' } });
  const wt = await prisma.worksite.create({ data: { ref: 'R-SCOPE-T', title: 'Chantier Tonton (scope)', entity: 'tonton', source: 'test' } });
  created.ws.push(wj.id, wt.id); ids.wj = wj.id; ids.wt = wt.id;
  const day = new Date('2026-11-03T08:00:00Z'), end = new Date('2026-11-03T16:00:00Z');
  ids.evJ = (await prisma.planningEvent.create({ data: { worksiteId: wj.id, startAt: day, endAt: end } })).id;
  ids.evT = (await prisma.planningEvent.create({ data: { worksiteId: wt.id, startAt: day, endAt: end } })).id;
  ids.docJ = (await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', status: 'draft', draftRef: 'SCOPE-J', worksiteId: wj.id } })).id;
  ids.docT = (await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', status: 'draft', draftRef: 'SCOPE-T', worksiteId: wt.id } })).id;
  scoped = await login('tonton-scope-test@jjd-consult.be');
  office = await login('melvina@jjd-consult.be');
});
after(async () => {
  await prisma.planningEvent.deleteMany({ where: { worksiteId: { in: created.ws } } });
  await prisma.document.deleteMany({ where: { worksiteId: { in: created.ws } } });
  await prisma.worksite.deleteMany({ where: { id: { in: created.ws } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server.close();
});

test('compte limité à Tonton : ne voit que ses chantiers (liste, fiche, recherche), jamais ceux de JJD', async () => {
  const list = await (await call(scoped, 'GET', '/api/worksites')).json() as { items: { ref: string; entity: string }[] };
  assert.ok(list.items.some((w) => w.ref === 'R-SCOPE-T')); assert.ok(!list.items.some((w) => w.ref === 'R-SCOPE-J'));
  assert.ok(list.items.every((w) => w.entity === 'tonton'));
  assert.equal((await call(scoped, 'GET', `/api/worksites/${ids.wj}`)).status, 404);
  assert.equal((await call(scoped, 'GET', `/api/worksites/${ids.wt}`)).status, 200);
  assert.equal((await call(scoped, 'PATCH', `/api/worksites/${ids.wj}`, { title: 'piraté' })).status, 404);
  assert.equal((await prisma.worksite.findUnique({ where: { id: ids.wj } }))?.title, 'Chantier JJD (scope)');
});

test('planning et documents : filtrés par entité, lecture comme écriture', async () => {
  const plan = await (await call(scoped, 'GET', '/api/planning?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z')).json() as { items: { id: string }[] };
  assert.ok(plan.items.some((e) => e.id === ids.evT)); assert.ok(!plan.items.some((e) => e.id === ids.evJ));
  assert.equal((await call(scoped, 'GET', `/api/planning/${ids.evJ}`)).status, 404);
  assert.equal((await call(scoped, 'DELETE', `/api/planning/${ids.evJ}`)).status, 404);
  assert.ok(await prisma.planningEvent.findUnique({ where: { id: ids.evJ } }));
  const body = { worksiteId: ids.wj, startAt: '2026-11-04T08:00:00Z', endAt: '2026-11-04T16:00:00Z' };
  assert.equal((await call(scoped, 'POST', '/api/planning', body)).status, 403); // créer sur un chantier JJD est refusé
  assert.equal((await call(scoped, 'POST', '/api/planning', { ...body, worksiteId: ids.wt })).status, 201);
  const docs = await (await call(scoped, 'GET', '/api/documents')).json() as { items: { id: string }[] };
  assert.ok(docs.items.some((d) => d.id === ids.docT)); assert.ok(!docs.items.some((d) => d.id === ids.docJ));
  assert.equal((await call(scoped, 'GET', `/api/documents/${ids.docJ}`)).status, 404);
});

test('zones hors périmètre refusées d’office : banque, contacts, réglages, utilisateurs, CRM, boîte IA', async () => {
  for (const url of ['/api/finance/bank/accounts', '/api/contacts', '/api/settings/company', '/api/users', '/api/crm', '/api/mail-suggestions', '/api/ponto/status', '/api/finance/sales', '/api/statements/x', '/api/stock/items', '/api/stock-orders', '/api/vehicles/x', '/api/people/x']) {
    const r = await call(scoped, 'GET', url);
    assert.equal(r.status, 403, `${url} devrait être refusé (reçu ${r.status})`);
  }
  assert.equal((await call(scoped, 'GET', '/api/dashboard')).status, 200);
});

test('compte sans limite (bureau, direction) : voit toujours tout, rien ne change', async () => {
  const list = await (await call(office, 'GET', '/api/worksites')).json() as { items: { ref: string }[] };
  assert.ok(list.items.some((w) => w.ref === 'R-SCOPE-J') && list.items.some((w) => w.ref === 'R-SCOPE-T'));
  assert.equal((await call(office, 'GET', `/api/worksites/${ids.wj}`)).status, 200);
  assert.equal((await call(office, 'GET', '/api/contacts')).status, 200);
});

test('annuaire du personnel : taux horaires retirés pour un compte limité', async () => {
  const p = await prisma.person.create({ data: { firstName: 'ScopeTest', normalizedName: 'scopetest', hourlyRate: 33, payoutPerDay: 200 } });
  try {
    const mine = await (await call(scoped, 'GET', '/api/people')).json() as { items: Record<string, unknown>[] };
    const row = mine.items.find((x) => x.id === p.id); assert.ok(row);
    assert.ok(!('hourlyRate' in row!) && !('payoutPerDay' in row!));
    const all = await (await call(office, 'GET', '/api/people')).json() as { items: Record<string, unknown>[] };
    assert.equal(all.items.find((x) => x.id === p.id)?.hourlyRate, 33);
  } finally { await prisma.person.delete({ where: { id: p.id } }); }
});
