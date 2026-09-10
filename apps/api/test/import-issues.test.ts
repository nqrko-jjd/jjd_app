import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';
let batchId = '';
const issueIds: string[] = [];

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await login.json()).token;

  const ws = await prisma.worksite.create({ data: { ref: 'R-ISSUE-TEST', title: 'Issue link test', source: 'test' } });
  wsId = ws.id;

  const batch = await prisma.importBatch.create({ data: { source: 'xlsx', label: 'test' } });
  batchId = batch.id;
  const worksiteIssue = await prisma.importIssue.create({
    data: { batchId, entity: 'worksite', severity: 'info', message: 'R-ISSUE-TEST sans client', rawData: { ref: 'R-ISSUE-TEST' } },
  });
  const ledgerIssue = await prisma.importIssue.create({
    data: { batchId, entity: 'ledger', severity: 'warning', message: 'Écriture sur réf inconnue R-ORPHAN-TEST', rawData: { ref: 'R-ORPHAN-TEST' } },
  });
  const personIssue = await prisma.importIssue.create({
    data: { batchId, entity: 'person', severity: 'warning', message: 'Nom à vérifier', rawData: { name: 'Tonton/Julien' } },
  });
  issueIds.push(worksiteIssue.id, ledgerIssue.id, personIssue.id);
});

after(async () => {
  await prisma.importIssue.deleteMany({ where: { id: { in: issueIds } } });
  await prisma.importBatch.deleteMany({ where: { id: batchId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('GET /api/imports/issues : résout un lien vers la fiche chantier quand elle existe', async () => {
  const r = await fetch(`${base}/api/imports/issues?resolved=0&entity=worksite`, { headers: auth() });
  assert.equal(r.status, 200);
  const { items } = await r.json();
  const worksiteItem = items.find((i: { id: string }) => i.id === issueIds[0]);
  assert.ok(worksiteItem);
  assert.deepEqual(worksiteItem.link, { label: 'Ouvrir le chantier', href: `/app/chantiers/${wsId}` });
});

test('GET /api/imports/issues : lien de recherche vers Achats pour une réf de chantier inconnue', async () => {
  const r = await fetch(`${base}/api/imports/issues?resolved=0&entity=ledger`, { headers: auth() });
  const { items } = await r.json();
  const ledgerItem = items.find((i: { id: string }) => i.id === issueIds[1]);
  assert.ok(ledgerItem);
  assert.deepEqual(ledgerItem.link, { label: 'Chercher dans Achats', href: '/app/achats?q=R-ORPHAN-TEST' });
});

test('GET /api/imports/issues : lien de recherche vers Équipe pour un nom composite (ne garde que le 1er)', async () => {
  const r = await fetch(`${base}/api/imports/issues?resolved=0&entity=person`, { headers: auth() });
  const { items } = await r.json();
  const personItem = items.find((i: { id: string }) => i.id === issueIds[2]);
  assert.ok(personItem);
  assert.deepEqual(personItem.link, { label: 'Chercher l’ouvrier', href: `/app/equipe?q=${encodeURIComponent('Tonton')}` });
});

test('achats : la recherche trouve une écriture par sa référence de chantier orpheline (worksiteRef)', async () => {
  const orphan = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', worksiteRef: 'R-ORPHAN-TEST', ht: 42, date: new Date('2026-01-01'), source: 'test' },
  });
  try {
    const r = await fetch(`${base}/api/finance/expenses?q=R-ORPHAN-TEST`, { headers: auth() });
    assert.equal(r.status, 200);
    const { items } = await r.json();
    assert.ok(items.some((e: { id: string }) => e.id === orphan.id));
  } finally {
    await prisma.ledgerEntry.deleteMany({ where: { id: orphan.id } });
  }
});
