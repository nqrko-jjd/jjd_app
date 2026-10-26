import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { markCrmFollowedUp } from '../src/lib/crm-sync.js';

let server: Server; let base = ''; let token = '';
const ws: string[] = []; const manual: string[] = [];
/* eslint-disable @typescript-eslint/no-explicit-any */
const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const post = async (path: string, body: unknown = {}) => { const r = await fetch(base + path, { method: 'POST', headers: H(), body: JSON.stringify(body) }); return { status: r.status, body: (await r.json().catch(() => null)) as any }; };
const mkWs = async (ref: string) => { const w = await prisma.worksite.create({ data: { ref, title: `Chantier ${ref}`, status: 'quote_needed', source: 'test' } }); ws.push(w.id); return w.id; };
/** devis émis puis envoyé « hors JJD » (envoi confirmé) : c'est ce qui fait passer le chantier en « Devis envoyé » */
async function sentQuote(worksiteId: string, ht: number) {
  const created = await post('/api/documents', { kind: 'quote', worksiteId, lines: [{ label: 'Travaux', qty: 1, unitPriceHt: ht, vatRate: 0.06 }] });
  const id = created.body.document.id as string;
  await post(`/api/documents/${id}/issue`);
  assert.equal((await post(`/api/documents/${id}/send`, { confirmedExternal: true })).status, 200);
  return id;
}
const opp = (worksiteId: string) => prisma.crmOpportunity.findUnique({ where: { worksiteId } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
});
after(async () => {
  await prisma.crmOpportunity.deleteMany({ where: { OR: [{ worksiteId: { in: ws } }, { id: { in: manual } }] } });
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: { in: ws } } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: { in: ws } } } });
  await prisma.document.deleteMany({ where: { worksiteId: { in: ws } } });
  await prisma.auditLog.deleteMany({ where: { entity: 'worksite', entityId: { in: ws } } });
  await prisma.worksite.deleteMany({ where: { id: { in: ws } } });
  server.close();
});

test('pipeline : un devis envoyé crée la carte « Devis envoyé » du chantier, relancé → « Relancé », accepté → « Gagné »', async () => {
  const w = await mkWs('R-CRM1');
  const keepManual = await prisma.crmOpportunity.create({ data: { title: 'Demande saisie à la main', stage: 'new' } }); manual.push(keepManual.id);
  assert.equal(await opp(w), null, 'rien tant qu’aucun devis n’est envoyé');

  const q1 = await sentQuote(w, 1000);
  assert.equal((await prisma.worksite.findUniqueOrThrow({ where: { id: w } })).status, 'quote_sent');
  let o = await opp(w);
  assert.equal(o?.stage, 'quote_sent'); assert.equal(o?.estimatedValue, 1000); assert.equal(o?.title, 'Chantier R-CRM1');

  await sentQuote(w, 500); // un 2e devis envoyé : même carte, montant additionné
  assert.equal(await prisma.crmOpportunity.count({ where: { worksiteId: w } }), 1);
  assert.equal((await opp(w))?.estimatedValue, 1500);

  await markCrmFollowedUp(w);
  assert.equal((await opp(w))?.stage, 'follow_up', 'une relance de devis est partie');
  await sentQuote(w, 100);
  assert.equal((await opp(w))?.stage, 'follow_up', 'une carte déjà relancée le reste');

  assert.equal((await post(`/api/documents/${q1}/status`, { status: 'accepted' })).status, 200);
  o = await opp(w);
  assert.equal(o?.stage, 'won', 'devis accepté → chantier à planifier → carte gagnée');

  assert.equal((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: keepManual.id } })).stage, 'new', 'une opportunité saisie à la main n’est jamais touchée');
});

test('pipeline : devis refusé → carte « Perdu » avec un motif ; un chantier sans devis envoyé n’a pas de carte', async () => {
  const w = await mkWs('R-CRM2');
  const q = await sentQuote(w, 800);
  assert.equal((await opp(w))?.stage, 'quote_sent');
  assert.equal((await post(`/api/documents/${q}/status`, { status: 'declined', reason: 'trop cher' })).status, 200);
  const o = await opp(w);
  assert.equal(o?.stage, 'lost'); assert.equal(o?.lostReason, 'autre');

  const w3 = await mkWs('R-CRM3');
  assert.equal(await opp(w3), null);
});

test('pipeline : changement de statut du chantier à la main → la carte suit', async () => {
  const w = await mkWs('R-CRM4');
  await sentQuote(w, 300);
  assert.equal((await opp(w))?.stage, 'quote_sent');
  const r = await fetch(`${base}/api/worksites/${w}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ status: 'cancelled' }) });
  assert.equal(r.status, 200);
  const o = await opp(w);
  assert.equal(o?.stage, 'lost'); assert.equal(o?.lostReason, 'projet_annule');
});
