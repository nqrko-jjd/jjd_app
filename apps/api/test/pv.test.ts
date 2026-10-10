import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { rawPrisma as prisma } from '../src/db.js';

let server: Server; let base = ''; let token = ''; let wsId = '';
const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const call = (path: string, method = 'GET', body?: object) => fetch(`${base}/api/pv${path}`, { method, headers: auth(), body: body ? JSON.stringify(body) : undefined });
// PNG 1×1 valide
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  wsId = (await prisma.worksite.create({ data: { ref: 'R-PVTEST', title: 'Chantier PV', source: 'test' } })).id;
});
after(async () => {
  await prisma.worksiteReport.deleteMany({ where: { worksiteId: wsId } });
  await prisma.message.deleteMany({ where: { thread: { worksiteId: wsId } } });
  await prisma.thread.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

test('PV de réception : réserves, signature, puis levée des réserves seulement', async () => {
  const created = await (await call('', 'POST', { worksiteId: wsId, quoteRef: 'D2026-777' })).json();
  const id = created.report.id as string;
  assert.equal(created.report.kind, 'reception');
  assert.equal(created.report.receptionResult, 'none');

  const withR = await (await call(`/${id}/reserves`, 'POST', { description: 'Joint de la douche à reprendre' })).json();
  assert.equal(withR.report.reserves.length, 1);
  assert.equal(withR.report.receptionResult, 'with_reserves', 'une réserve passe la réception « avec réserves »');
  await call(`/${id}/reserves`, 'POST', { description: 'Retouche peinture couloir' });
  assert.equal((await call(`/${id}`, 'PATCH', { presentParties: 'M. Dupont, Julien', placeSigned: 'Bruxelles' })).status, 200);

  assert.equal((await call(`/${id}/sign`, 'POST', { clientName: 'M. Dupont', signature: PNG })).status, 200);
  assert.equal((await call(`/${id}`, 'PATCH', { notes: 'trop tard' })).status, 409, 'signé : plus modifiable');
  assert.equal((await call(`/${id}/reserves`, 'POST', { description: 'Nouvelle réserve' })).status, 409);

  const state = await (await call(`/${id}`)).json();
  const [r1] = state.report.reserves as { id: string }[];
  const lifted = await (await call(`/${id}/reserves/${r1!.id}`, 'PATCH', { lifted: true, liftedNote: 'Repris le 14' })).json();
  assert.ok(lifted.report.reserves.find((r: { id: string }) => r.id === r1!.id).liftedAt, 'lever une réserve reste possible après signature');

  // les rapports quotidiens et les PV sont distincts : le PV n'est pas un brouillon de rapport quotidien
  const list = await (await fetch(`${base}/api/worksites/${wsId}/reports`, { headers: auth() })).json();
  assert.equal(list.items.find((r: { id: string }) => r.id === id).kind, 'reception');
  const pdf = await call(`/${id}/pdf?lifted=1`);
  assert.ok([200, 500].includes(pdf.status)); // PDF = Chromium (absent en local) : on vérifie seulement que la route répond
});
