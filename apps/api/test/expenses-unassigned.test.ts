import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server; let base = ''; let token = '';
const ids: { oh?: string; other?: string; a?: string; b?: string; c?: string; person?: string; exp?: string } = {};
const get = async (p: string) => (await fetch(`${base}/api/finance/expenses${p}`, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  const e01 = await prisma.worksite.findFirst({ where: { ref: 'E-01' } });
  ids.oh = (e01 ?? await prisma.worksite.create({ data: { ref: 'E-01', title: 'Matériel sans chantier', kind: 'overhead', source: 'test-unas' } })).id;
  // un autre poste de charges (E-03…) ne doit PAS apparaître : ce sont de vraies charges
  ids.other = (await prisma.worksite.create({ data: { ref: 'E-UNAS-X', title: 'Autre poste de charges', kind: 'overhead', source: 'test-unas' } })).id;
  await prisma.ledgerEntry.create({ data: { direction: 'purchase', docNumber: 'UNAS-OTHER', supplierName: 'Autre poste', ht: 50, year: 2026, date: new Date('2026-09-10T00:00:00Z'), worksiteId: ids.other, source: 'test-unas' } });
  ids.a = (await prisma.worksite.create({ data: { ref: 'R-UNAS-A', title: 'Chantier A', source: 'test' } })).id;
  ids.b = (await prisma.worksite.create({ data: { ref: 'R-UNAS-B', title: 'Chantier B', source: 'test' } })).id;
  ids.c = (await prisma.worksite.create({ data: { ref: 'R-UNAS-C', title: 'Chantier C (la veille)', source: 'test' } })).id;
  ids.person = (await prisma.person.create({ data: { firstName: 'Test', lastName: 'Unas', normalizedName: 'test unas', role: 'worker' } })).id;
  // jour d'achat : 2026-09-10 ; A au planning ce jour-là, B pointé ce jour-là (6 h), C la veille seulement
  await prisma.planningEvent.create({ data: { worksiteId: ids.a, startAt: new Date('2026-09-10T06:30:00Z'), endAt: new Date('2026-09-10T15:00:00Z'), kind: 'intervention', status: 'confirmed' } });
  await prisma.timeEntry.create({ data: { personId: ids.person, worksiteId: ids.b, date: new Date('2026-09-10T00:00:00Z'), hours: 6, status: 'approved' } });
  await prisma.planningEvent.create({ data: { worksiteId: ids.c, startAt: new Date('2026-09-09T06:30:00Z'), endAt: new Date('2026-09-09T15:00:00Z'), kind: 'intervention', status: 'confirmed' } });
  ids.exp = (await prisma.ledgerEntry.create({ data: { direction: 'purchase', docNumber: 'UNAS-1', supplierName: 'Holcim Test', ht: 105, ttc: 127, year: 2026, date: new Date('2026-09-10T00:00:00Z'), worksiteId: ids.oh, source: 'test-unas' } })).id;
});
after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { source: 'test-unas' } });
  await prisma.timeEntry.deleteMany({ where: { personId: ids.person } });
  await prisma.planningEvent.deleteMany({ where: { worksiteId: { in: [ids.a!, ids.b!, ids.c!] } } });
  await prisma.person.deleteMany({ where: { id: ids.person } });
  await prisma.worksite.deleteMany({ where: { OR: [{ id: { in: [ids.a!, ids.b!, ids.c!, ids.other!] } }, { id: ids.oh, source: 'test-unas' }] } });
  server.close();
});

test('dépenses sans chantier : chantiers actifs le jour de l’achat (planning + pointage), voisins avec « window », imputation par PATCH', async () => {
  const day = await get('/unassigned?q=UNAS-1&window=0');
  assert.equal(day.items.length, 1);
  const refs = day.items[0].suggestions.map((s: { ref: string }) => s.ref).sort();
  assert.deepEqual(refs, ['R-UNAS-A', 'R-UNAS-B'], 'ce jour-là : A (planning) et B (pointage), pas C');
  const b = day.items[0].suggestions.find((s: { ref: string }) => s.ref === 'R-UNAS-B');
  assert.equal(b.hours, 6); assert.equal(b.people, 1); assert.equal(b.onDay, true);
  assert.equal(day.items[0].suggestions[0].ref, 'R-UNAS-B', 'les heures pointées passent en premier');

  assert.equal((await get('/unassigned?q=UNAS-OTHER')).items.length, 0, 'un autre poste E-xx n’est pas proposé à l’imputation');
  const wide = await get('/unassigned?q=UNAS-1&window=1');
  const c = wide.items[0].suggestions.find((s: { ref: string }) => s.ref === 'R-UNAS-C');
  assert.ok(c && c.onDay === false, 'la veille : proposé, marqué « à côté »');

  const r = await fetch(`${base}/api/finance/expenses/${ids.exp}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ worksiteId: ids.b }) });
  assert.equal(r.status, 200);
  assert.equal((await get('/unassigned?q=UNAS-1')).items.length, 0, 'imputée : elle quitte la liste');
});
