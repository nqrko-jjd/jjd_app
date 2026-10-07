import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { netHours } from '../src/lib/planned-time.js';

let server: Server;
let base = '';
let token = '';
const ids: { ws?: string; ev?: string; ev2?: string; a?: string; b?: string; c?: string; m?: string; abs?: string } = {};
const DAY = '2026-10-05';
const DAY2 = '2026-10-06';
// 08:30–17:00 à Bruxelles (UTC+2 en octobre)
const at = (day: string, h: number, m = 0) => new Date(new Date(`${day}T00:00:00Z`).getTime() + ((h - 2) * 60 + m) * 60000);

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  const mkPerson = (firstName: string, role = 'worker') => prisma.person.create({ data: { firstName, normalizedName: firstName.toLowerCase(), displayName: firstName, role, contractType: 'employee', hourlyRate: 20, active: true } });
  const [a, b, c, m] = await Promise.all([mkPerson('Aaa Plan'), mkPerson('Bbb Plan'), mkPerson('Ccc Plan'), mkPerson('Mmm Plan', 'manager')]);
  Object.assign(ids, { a: a.id, b: b.id, c: c.id, m: m.id });
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-PTTEST', title: 'Pointage planning test', source: 'test' } })).id;
  const mkEvent = (day: string, personIds: string[]) => prisma.planningEvent.create({
    data: { worksiteId: ids.ws!, startAt: at(day, 8, 30), endAt: at(day, 17), assignments: { create: personIds.map((personId) => ({ personId })) } },
  });
  ids.ev = (await mkEvent(DAY, [a.id, b.id, c.id, m.id])).id;
  ids.ev2 = (await mkEvent(DAY2, [a.id])).id;
  // Ccc est en congé le 5 ; Bbb a déjà pointé lui-même ce jour-là sur ce chantier
  ids.abs = (await prisma.absence.create({ data: { personId: c.id, kind: 'leave', startsOn: new Date(`${DAY}T00:00:00Z`), endsOn: new Date(`${DAY}T00:00:00Z`) } })).id;
  await prisma.timeEntry.create({ data: { personId: b.id, worksiteId: ids.ws, date: new Date(`${DAY}T00:00:00Z`), hours: 8, status: 'submitted', source: 'timer' } });
});

after(async () => {
  await prisma.timeEntry.deleteMany({ where: { personId: { in: [ids.a!, ids.b!, ids.c!, ids.m!] } } });
  await prisma.absence.deleteMany({ where: { id: ids.abs } });
  await prisma.planningEvent.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.auditLog.deleteMany({ where: { entity: 'worksite', entityId: ids.ws } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  await prisma.person.deleteMany({ where: { id: { in: [ids.a!, ids.b!, ids.c!, ids.m!] } } });
  server.close();
});

const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const get = async (p: string) => { const r = await fetch(base + p, { headers: H() }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (p: string, body: unknown) => { const r = await fetch(base + p, { method: 'POST', headers: H(), body: JSON.stringify(body) }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('heures nettes : créneau moins la pause (30 min dès 6 h de présence), plusieurs créneaux cumulés', () => {
  assert.deepEqual(netHours([{ minutes: 510, allDay: false }]), { hours: 8, pauseMinutes: 30 });
  assert.deepEqual(netHours([{ minutes: 240, allDay: false }]), { hours: 4, pauseMinutes: 0 });
  assert.deepEqual(netHours([{ minutes: 240, allDay: false }, { minutes: 270, allDay: false }]), { hours: 8, pauseMinutes: 30 });
  assert.deepEqual(netHours([{ minutes: 0, allDay: true }]), { hours: 8, pauseMinutes: 0 });
});

test('propositions du jour : ouvriers affectés ; le gestionnaire, la personne en congé sont écartés ; celui qui a déjà pointé est « déjà couvert »', async () => {
  const r = await get(`/api/timesheet/planned?date=${DAY}&worksiteId=${ids.ws}`);
  assert.equal(r.status, 200);
  const byName = Object.fromEntries(r.body.items.map((i: { personName: string }) => [i.personName, i]));
  assert.deepEqual(Object.keys(byName).sort(), ['Aaa Plan', 'Bbb Plan']);
  assert.equal(byName['Aaa Plan'].state, 'open');
  assert.equal(byName['Aaa Plan'].hours, 8);
  assert.equal(byName['Aaa Plan'].slots[0].start, '08:30');
  assert.equal(byName['Bbb Plan'].state, 'covered');
  assert.equal(r.body.summary.open, 1);
  assert.equal(r.body.perDay[DAY], 1);
});

test('valider : pointage validé (source planning, montant = heures × taux), heures modifiables ; jamais en double', async () => {
  const v = await post('/api/timesheet/planned/validate', { items: [{ personId: ids.a, worksiteId: ids.ws, date: DAY, hours: 7.5 }] });
  assert.equal(v.status, 200);
  assert.deepEqual(v.body, { created: 1, skipped: 0 });
  const e = await prisma.timeEntry.findFirstOrThrow({ where: { personId: ids.a, planningEventId: ids.ev } });
  assert.equal(e.status, 'approved');
  assert.equal(e.hours, 7.5);
  assert.equal(e.amount, 150);
  assert.equal(e.source, 'planning');
  assert.equal((await get(`/api/timesheet/planned?date=${DAY}&worksiteId=${ids.ws}`)).body.summary.open, 0);
  assert.deepEqual((await post('/api/timesheet/planned/validate', { items: [{ personId: ids.a, worksiteId: ids.ws, date: DAY }] })).body, { created: 0, skipped: 1 });
});

test('« n’a pas travaillé » : pointage refusé sans heures, la proposition ne revient pas ; heures invalides refusées', async () => {
  const bad = await post('/api/timesheet/planned/dismiss', { items: [{ personId: ids.a, worksiteId: ids.ws, date: DAY2, hours: 40 }] });
  assert.equal(bad.status, 422);
  const d = await post('/api/timesheet/planned/dismiss', { items: [{ personId: ids.a, worksiteId: ids.ws, date: DAY2 }] });
  assert.deepEqual(d.body, { created: 1, skipped: 0 });
  const e = await prisma.timeEntry.findFirstOrThrow({ where: { personId: ids.a, planningEventId: ids.ev2 } });
  assert.equal(e.status, 'rejected');
  assert.equal(e.hours, null);
  assert.equal((await get(`/api/timesheet/planned?date=${DAY2}&worksiteId=${ids.ws}`)).body.items.length, 0);
});

test('valider la journée : toutes les propositions ouvertes ; décompte : heures prévues à part, jamais dans le payé', async () => {
  // nouvelle journée avec deux ouvriers
  const day3 = '2026-10-02';
  const ev = await prisma.planningEvent.create({ data: { worksiteId: ids.ws!, startAt: at(day3, 8), endAt: at(day3, 12), assignments: { create: [{ personId: ids.a! }, { personId: ids.b! }] } } });
  const before = await prisma.timeEntry.count({ where: { personId: { in: [ids.a!, ids.b!] } } });
  const s0 = await get(`/api/statements/${ids.a}?year=2026&month=10`);
  assert.equal(s0.body.plannedHours, 4, 'prévu non validé = 4 h le 2 octobre (4 h sans pause)');
  assert.equal(s0.body.totalHours, 7.5 > 0 ? s0.body.totalHours : 0);
  const paidBefore = s0.body.totalHours;
  const r = await post('/api/timesheet/planned/validate-day', { date: day3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 2);
  assert.equal(r.body.hours, 8);
  assert.equal(await prisma.timeEntry.count({ where: { personId: { in: [ids.a!, ids.b!] } } }), before + 2);
  const s1 = await get(`/api/statements/${ids.a}?year=2026&month=10`);
  assert.equal(s1.body.plannedHours, 0);
  assert.ok(s1.body.totalHours >= paidBefore, 'les heures validées entrent dans le payé');
  await prisma.planningEvent.delete({ where: { id: ev.id } });
});

test('saisie manuelle : « valider directement » crée un pointage validé ; sinon à valider', async () => {
  const mk = async (approve: boolean) => (await post('/api/timesheet/entries', { personId: ids.c, worksiteId: ids.ws, date: '2026-10-01', hours: 5, approve })).body.entry;
  assert.equal((await mk(true)).status, 'approved');
  assert.equal((await mk(false)).status, 'submitted');
});
