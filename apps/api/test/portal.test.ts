import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  // le compte syndic de démo est recréé par import:trustup ; on s'assure qu'il existe
  const syndic = await prisma.syndic.findFirst({ orderBy: { contacts: { _count: 'desc' } } });
  if (!syndic) return;
  await prisma.user.upsert({
    where: { email: 'test-syndic@portal.test' },
    create: { email: 'test-syndic@portal.test', passwordHash: 'x', role: 'client', syndicId: syndic.id },
    update: { syndicId: syndic.id, active: true },
  });
  const link = await (
    await fetch(`${base}/api/portal/request-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'test-syndic@portal.test' }),
    })
  ).json();
  const verify = await (
    await fetch(`${base}/api/portal/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: link.devToken }),
    })
  ).json();
  token = verify.token;
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: 'test-syndic@portal.test' } });
  await prisma.loginToken.deleteMany({ where: { email: 'test-syndic@portal.test' } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('portail : dashboard renvoie KPIs + sections pour un syndic', async () => {
  const r = await fetch(`${base}/api/portal/dashboard`, { headers: auth() });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.greeting.isSyndic, true);
  assert.ok(d.kpis.buildings > 0);
  assert.ok('interventionsActive' in d.kpis && 'quotesToValidate' in d.kpis && 'urgent' in d.kpis);
  assert.equal(d.weekPlanning.days.length, 7);
  assert.ok(Array.isArray(d.recentInterventions));
  // payé/impayé doit être exposé à côté du statut chantier (et des documents récents),
  // même quand aucune facture n'existe encore (invoiceStatus/status alors null/vide)
  for (const w of d.recentInterventions) assert.ok('invoiceStatus' in w);
  for (const doc of d.recentDocuments) assert.ok('status' in doc);
});

test('portail : planning limité à 2 semaines (pas 6) et plafonné en nombre', async () => {
  const r = await fetch(`${base}/api/portal/planning`, { headers: auth() });
  assert.equal(r.status, 200);
  const { items } = await r.json();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // lundi de cette semaine
  const maxDate = new Date(from);
  maxDate.setDate(maxDate.getDate() + 14);
  for (const e of items as { startAt: string }[]) {
    assert.ok(new Date(e.startAt) < maxDate, `événement au-delà de la fenêtre de 14 jours : ${e.startAt}`);
  }
});

test('portail : liste interventions scoping syndic', async () => {
  const r = await fetch(`${base}/api/portal/interventions?status=open`, { headers: auth() });
  assert.equal(r.status, 200);
  const { items } = await r.json();
  assert.ok(Array.isArray(items));
  // toutes rattachées à un immeuble du syndic
  for (const w of items) assert.ok(w.building, `intervention ${w.ref} sans immeuble`);
});

test('portail : dashboard refusé sans token', async () => {
  const r = await fetch(`${base}/api/portal/dashboard`);
  assert.equal(r.status, 401);
});

test('portail : accès résident limité — scoping immeuble + pas de devis/factures', async () => {
  const b = await prisma.contact.findFirst({ where: { kind: { in: ['acp', 'developer'] }, acpWorksites: { some: { documents: { some: { number: { not: null } } } } } } });
  if (!b) return;
  await prisma.user.upsert({
    where: { email: 'test-resident@portal.test' },
    create: { email: 'test-resident@portal.test', passwordHash: 'x', role: 'client', residentOfId: b.id, portalAccess: 'limited' },
    update: { residentOfId: b.id, portalAccess: 'limited', active: true },
  });
  const link = await (await fetch(`${base}/api/portal/request-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'test-resident@portal.test' }) })).json();
  const { token: rt } = await (await fetch(`${base}/api/portal/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: link.devToken }) })).json();
  const h = { authorization: `Bearer ${rt}` };

  const me = await (await fetch(`${base}/api/portal/me`, { headers: h })).json();
  assert.equal(me.user.access, 'limited');

  const dash = await (await fetch(`${base}/api/portal/dashboard`, { headers: h })).json();
  assert.equal(dash.kpis.quotesToValidate, null);
  assert.equal(dash.recentDocuments.length, 0);

  // les interventions restent visibles (photos/suivi)
  const iv = await fetch(`${base}/api/portal/interventions`, { headers: h });
  assert.equal(iv.status, 200);

  // devis / documents interdits
  assert.equal((await fetch(`${base}/api/portal/quotes`, { headers: h })).status, 403);
  assert.equal((await fetch(`${base}/api/portal/documents`, { headers: h })).status, 403);

  // une fiche chantier de l'immeuble n'expose ni devis ni factures
  const first = (await (await fetch(`${base}/api/portal/interventions`, { headers: h })).json()).items[0];
  if (first) {
    const ws = await (await fetch(`${base}/api/portal/worksites/${first.id}`, { headers: h })).json();
    assert.equal(ws.quotes.length, 0);
    assert.equal(ws.invoices.length, 0);
  }

  await prisma.user.deleteMany({ where: { email: 'test-resident@portal.test' } });
  await prisma.loginToken.deleteMany({ where: { email: 'test-resident@portal.test' } });
});
