import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server; let base = ''; let token = '';
const made = { sugs: [] as string[], ws: [] as string[], opps: [] as string[] };
const call = (method: string, url: string, body?: unknown) => fetch(`${base}${url}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const sug = async (extra: object = {}) => { const s = await prisma.mailSuggestion.create({ data: { messageId: `zz-lead-${Math.random()}`, subject: 'Demande de devis joints', fromAddress: '"Mme Test" <mme.test@exemple.be>', kind: 'lead', summary: 'Mme Test demande un devis pour refaire ses joints.', status: 'pending', ...extra } }); made.sugs.push(s.id); return s; };

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json() as { token: string }).token;
});
after(async () => {
  await prisma.worksiteMail.deleteMany({ where: { worksiteId: { in: made.ws } } });
  await prisma.crmOpportunity.deleteMany({ where: { OR: [{ id: { in: made.opps } }, { worksiteId: { in: made.ws } }] } });
  await prisma.mailSuggestion.deleteMany({ where: { id: { in: made.sugs } } });
  await prisma.worksite.deleteMany({ where: { id: { in: made.ws } } });
  server.close();
});

test('valider une demande sans chantier crée un nouveau R- « devis à rédiger », relié à la piste, mail rangé dans son suivi', async () => {
  const s = await sug();
  const r = await call('POST', `/api/mail-suggestions/${s.id}/apply`, { title: 'Joints Mme Test', createWorksite: true, note: 'Visite déjà faite' });
  assert.equal(r.status, 200);
  const done = await prisma.mailSuggestion.findUnique({ where: { id: s.id }, include: { worksite: true } });
  assert.ok(done?.worksite); made.ws.push(done!.worksite!.id);
  assert.equal(done!.worksite!.status, 'quote_needed'); assert.match(done!.worksite!.ref, /^R-/);
  const opp = await prisma.crmOpportunity.findFirst({ where: { worksiteId: done!.worksite!.id } });
  assert.ok(opp); made.opps.push(opp!.id);
  const mails = await prisma.worksiteMail.findMany({ where: { worksiteId: done!.worksite!.id } });
  assert.equal(mails.length, 1); assert.equal(mails[0]!.note, 'Visite déjà faite');
});

test('valider sur un chantier existant : la piste y est reliée ; déjà relié à une autre piste : le mail est quand même rangé', async () => {
  const ws = await prisma.worksite.create({ data: { ref: 'R-LEAD-T', title: 'Chantier existant', source: 'test' } }); made.ws.push(ws.id);
  const a = await sug();
  assert.equal((await call('POST', `/api/mail-suggestions/${a.id}/apply`, { title: 'Piste A', worksiteId: ws.id })).status, 200);
  const oppA = await prisma.crmOpportunity.findFirst({ where: { worksiteId: ws.id } }); assert.ok(oppA); made.opps.push(oppA!.id);
  const b = await sug();
  assert.equal((await call('POST', `/api/mail-suggestions/${b.id}/apply`, { title: 'Piste B', worksiteId: ws.id })).status, 200);
  assert.equal(await prisma.crmOpportunity.count({ where: { worksiteId: ws.id } }), 1);
  assert.equal(await prisma.worksiteMail.count({ where: { worksiteId: ws.id } }), 2);
  const oppB = await prisma.crmOpportunity.findFirst({ where: { title: 'Piste B' } }); if (oppB) made.opps.push(oppB.id);
});
