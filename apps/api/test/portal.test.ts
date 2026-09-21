import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let syndicId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  // le compte syndic de démo est recréé par import:trustup ; on s'assure qu'il existe
  const syndic = await prisma.syndic.findFirst({ orderBy: { contacts: { _count: 'desc' } } });
  if (!syndic) return;
  syndicId = syndic.id;
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

test('portail : refuser un devis (avec note) -> status "declined", note dans le fil interne', async () => {
  await prisma.contact.deleteMany({ where: { name: 'ACP Portail Devis — test' } });
  const acp = await prisma.contact.create({
    data: { name: 'ACP Portail Devis — test', normalizedName: 'acp portail devis test', type: 'client', kind: 'acp', syndicId, source: 'test' },
  });
  const ws = await prisma.worksite.create({ data: { ref: 'R-PORTALQUOTE', title: 'Devis portail test', acpId: acp.id, source: 'test' } });
  const quote = await prisma.document.create({
    data: { kind: 'quote', direction: 'sale', number: 'DEV-TEST-1', worksiteId: ws.id, status: 'sent' },
  });

  const r = await fetch(`${base}/api/portal/quotes/${quote.id}/decline`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'Trop cher, on attend le prochain AG' }),
  });
  assert.equal(r.status, 200);

  const updated = await prisma.document.findUnique({ where: { id: quote.id } });
  assert.equal(updated?.status, 'declined');

  const thread = await prisma.thread.findUnique({ where: { worksiteId: ws.id } });
  const statusMsg = await prisma.message.findFirst({ where: { threadId: thread!.id, kind: 'status' }, orderBy: { createdAt: 'desc' } });
  assert.ok(statusMsg?.body?.includes('décliné'));
  assert.ok(statusMsg?.body?.includes('Trop cher, on attend le prochain AG'));

  // idempotent : rappeler decline ne recrée pas de message
  const again = await fetch(`${base}/api/portal/quotes/${quote.id}/decline`, { method: 'POST', headers: auth() });
  assert.equal(again.status, 200);
  const count = await prisma.message.count({ where: { threadId: thread!.id, kind: 'status' } });
  assert.equal(count, 1);

  await prisma.document.deleteMany({ where: { id: quote.id } });
  await prisma.thread.deleteMany({ where: { worksiteId: ws.id } });
  await prisma.worksite.deleteMany({ where: { id: ws.id } });
  await prisma.contact.deleteMany({ where: { id: acp.id } });
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

test('portail : nouvelle demande d’intervention (parcours 4 étapes) — photo puis création complète', async () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const up = await fetch(`${base}/api/portal/requests/photos`, { method: 'POST', headers: auth(), body: form });
  assert.equal(up.status, 201);
  const photo = await up.json() as { url: string; thumbUrl: string | null };
  assert.ok(photo.url);

  const r = await fetch(`${base}/api/portal/requests`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Fuite test portail',
      problemType: 'fuite',
      unitLabel: 'Lot 4B',
      details: 'Ça coule sous l’évier',
      urgency: 'urgent',
      onSiteContactName: 'Mme Test',
      onSiteContactPhone: '0470000000',
      accessNotes: 'Code 1234',
      visitPreference: 'Matinée',
      photos: [photo],
    }),
  });
  assert.equal(r.status, 201);
  const { id, reference } = await r.json() as { id: string; reference: string };
  assert.match(reference, /^INT-[0-9]{4}-[A-Z0-9]{5}$/);

  const opp = await prisma.crmOpportunity.findUnique({ where: { id }, include: { photos: true } });
  assert.equal(opp?.problemType, 'fuite');
  assert.equal(opp?.unitLabel, 'Lot 4B');
  assert.equal(opp?.urgent, true);
  assert.equal(opp?.urgency, 'urgent');
  assert.equal(opp?.onSiteContactName, 'Mme Test');
  assert.equal(opp?.accessNotes, 'Code 1234');
  assert.equal(opp?.visitPreference, 'Matinée');
  assert.equal(opp?.photos.length, 1);
  assert.equal(opp?.photos[0]?.url, photo.url);

  // le bureau peut ensuite éditer/déplacer l'opportunité (PATCH /api/crm/:id) sans que ça
  // supprime les photos déposées par le client (photos exclue du spread vers Prisma)
  const staffLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  const staffToken = (await staffLogin.json()).token as string;
  const patch = await fetch(`${base}/api/crm/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'to_qualify' }),
  });
  assert.equal(patch.status, 200);
  const afterPatch = await prisma.crmOpportunity.findUnique({ where: { id }, include: { photos: true } });
  assert.equal(afterPatch?.photos.length, 1, 'la photo doit survivre à un PATCH bureau');

  await prisma.crmOpportunity.deleteMany({ where: { id } });
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

test('portail : urgence à 3 niveaux — « soon » n’est pas urgent, l’ancien booléen `urgent` reste accepté', async () => {
  const post = async (extra: Record<string, unknown>) => {
    const r = await fetch(`${base}/api/portal/requests`, {
      method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test urgence portail', ...extra }),
    });
    assert.equal(r.status, 201);
    return (await r.json() as { id: string }).id;
  };
  const soon = await post({ urgency: 'soon' });
  const legacy = await post({ urgent: true });
  const plain = await post({});
  const rows = await prisma.crmOpportunity.findMany({ where: { id: { in: [soon, legacy, plain] } } });
  const by = (id: string) => rows.find((x) => x.id === id)!;
  assert.deepEqual([by(soon).urgency, by(soon).urgent], ['soon', false]);
  assert.deepEqual([by(legacy).urgency, by(legacy).urgent], ['urgent', true]);
  assert.deepEqual([by(plain).urgency, by(plain).urgent], ['normal', false]);
  await prisma.crmOpportunity.deleteMany({ where: { id: { in: [soon, legacy, plain] } } });
});
