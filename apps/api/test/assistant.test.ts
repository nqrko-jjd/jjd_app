import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { runTool } from '../src/routes/assistant.js';

let server: Server;
let base = '';
let token = '';
let userId = '';
let worksiteId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  const body = await login.json();
  token = body.token;
  const me = await prisma.user.findUnique({ where: { email: 'david@jjd-consult.be' } });
  userId = me!.id;

  const ws = await prisma.worksite.create({ data: { ref: 'R-ASSIST-TEST', title: 'Assistant — test', source: 'test' } });
  worksiteId = ws.id;
});

after(async () => {
  await prisma.worksiteTask.deleteMany({ where: { worksiteId } });
  await prisma.planningEvent.deleteMany({ where: { worksiteId } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId } } });
  await prisma.document.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test('/api/assistant/status : accessible au bureau, enabled reflète la clé Anthropic', async () => {
  const r = await fetch(`${base}/api/assistant/status`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const { enabled } = await r.json();
  assert.equal(enabled, !!process.env.ANTHROPIC_API_KEY);
});

test('POST /api/assistant/chat sans clé configurée -> 503', async () => {
  if (process.env.ANTHROPIC_API_KEY) return; // pas testable si une vraie clé est présente en local
  const r = await fetch(`${base}/api/assistant/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Prépare un devis' }] }),
  });
  assert.equal(r.status, 503);
});

test('create_devis_draft : crée un Document en statut draft, source ai-draft', async () => {
  const { result, action } = await runTool('create_devis_draft', {
    worksiteId, title: 'Rénovation salle de bain', lines: [{ label: 'Carrelage', qty: 20, unit: 'm²', unitPriceHt: 45 }],
  }, userId);
  const r = result as { id: string; draftRef: string; status: string };
  assert.equal(r.status, 'draft');
  assert.equal(action?.kind, 'devis');

  const doc = await prisma.document.findUnique({ where: { id: r.id }, include: { lines: true } });
  assert.equal(doc!.status, 'draft');
  assert.equal(doc!.source, 'ai-draft');
  assert.equal(doc!.number, null, 'jamais numéroté automatiquement');
  assert.equal(doc!.lines.length, 1);
  assert.equal(doc!.totalHt, 900);
});

test('create_planning_draft : crée un PlanningEvent source ai-draft, pas de sync Google', async () => {
  const startAt = new Date('2026-10-01T08:00:00Z').toISOString();
  const endAt = new Date('2026-10-01T16:00:00Z').toISOString();
  const { result, action } = await runTool('create_planning_draft', { worksiteId, title: 'Pose carrelage', startAt, endAt }, userId);
  const r = result as { id: string };
  assert.equal(action?.kind, 'planning');

  const ev = await prisma.planningEvent.findUnique({ where: { id: r.id } });
  assert.equal(ev!.source, 'ai-draft');
  assert.equal(ev!.googleEventId, null);
});

test('create_planning_draft : chantier inconnu -> erreur, rien créé', async () => {
  await assert.rejects(() => runTool('create_planning_draft', { worksiteId: 'inexistant', startAt: new Date().toISOString(), endAt: new Date().toISOString() }, userId));
});

test('create_task_draft : crée une WorksiteTask source ai-draft, statut todo', async () => {
  const { result, action } = await runTool('create_task_draft', { worksiteId, title: 'Commander le carrelage', dueOn: '2026-09-20' }, userId);
  const r = result as { id: string; title: string };
  assert.equal(action?.kind, 'task');

  const task = await prisma.worksiteTask.findUnique({ where: { id: r.id } });
  assert.equal(task!.source, 'ai-draft');
  assert.equal(task!.status, 'todo');
  assert.equal(task!.title, 'Commander le carrelage');
});

test('search_worksites : retrouve le chantier de test par référence', async () => {
  const { result } = await runTool('search_worksites', { query: 'R-ASSIST-TEST' }, userId);
  const items = result as { id: string; ref: string }[];
  assert.ok(items.some((w) => w.id === worksiteId));
});
