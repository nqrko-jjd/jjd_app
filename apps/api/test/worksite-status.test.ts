import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { syncLedgerEntryForDocument } from '../src/lib/documents.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  wsId = (await prisma.worksite.create({ data: { ref: 'R-STTEST', title: 'Statuts auto test', status: 'quote_needed', source: 'test' } })).id;
});

after(async () => {
  await prisma.planningEvent.deleteMany({ where: { worksiteId: wsId } });
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: wsId } } });
  await prisma.document.deleteMany({ where: { worksiteId: wsId } });
  await prisma.auditLog.deleteMany({ where: { entity: 'worksite', entityId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const status = async () => (await prisma.worksite.findUniqueOrThrow({ where: { id: wsId } }));
async function issued(kind: 'quote' | 'invoice', ht: number) {
  const created = await post('/api/documents', { kind, worksiteId: wsId, lines: [{ label: 'Travaux', qty: 1, unitPriceHt: ht, vatRate: 0.06 }] });
  return (await post(`/api/documents/${created.body.document.id}/issue`)).body.document as { id: string; totalTtc: number };
}

test('cycle complet : devis accepté → planifié → facturé → clôturé (archivé), tracé dans le journal', async () => {
  const quote = await issued('quote', 10000);
  assert.equal((await status()).status, 'quote_needed', 'un devis seulement envoyé ne change rien');
  await post(`/api/documents/${quote.id}/status`, { status: 'accepted' });
  assert.equal((await status()).status, 'to_plan');

  const day = new Date(Date.now() + 5 * 86400000); day.setHours(8, 30, 0, 0);
  const end = new Date(day); end.setHours(17, 0, 0, 0);
  const ev = await post('/api/planning', { worksiteId: wsId, startAt: day.toISOString(), endAt: end.toISOString(), kind: 'intervention' });
  assert.equal(ev.status, 201);
  assert.equal((await status()).status, 'scheduled');

  const acompte = await issued('invoice', 3000);
  assert.equal((await status()).status, 'scheduled', 'un acompte ne change pas le statut');
  const final = await issued('invoice', 7000);
  assert.equal((await status()).status, 'invoiced', 'tout le marché est facturé');

  // paiement des deux factures → clôturé
  for (const d of [acompte, final]) {
    await prisma.document.update({ where: { id: d.id }, data: { status: 'paid', paidAmount: d.totalTtc, paidOn: new Date() } });
    await syncLedgerEntryForDocument(d.id);
  }
  const ws = await status();
  assert.equal(ws.status, 'closed');
  assert.equal(ws.archived, true);
  const log = await prisma.auditLog.findMany({ where: { entity: 'worksite', entityId: wsId, action: 'auto_status' }, orderBy: { at: 'asc' } });
  assert.deepEqual(log.map((l) => (l.meta as { to: string }).to), ['to_plan', 'scheduled', 'invoiced', 'closed']);

  // suppression du créneau : le chantier clôturé n'est pas touché par le planning
  await fetch(`${base}/api/planning/${ev.body.event.id}`, { method: 'DELETE', headers: H() });
  assert.equal((await status()).status, 'closed');
});
