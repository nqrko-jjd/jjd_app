import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { configuration, ready } from '../src/lib/assistant-quota.js';
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

test('/api/assistant/status : accessible au bureau, enabled exige clé et budgets validés', async () => {
  const r = await fetch(`${base}/api/assistant/status`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const { enabled } = await r.json();
  assert.equal(enabled, !!process.env.ANTHROPIC_API_KEY && ready(await configuration()));
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

test('les créations IA sont interdites avant intégration de la confirmation',async()=>{
 for(const name of ['create_devis_draft','create_planning_draft','create_task_draft']){
  await assert.rejects(()=>runTool(name,{worksiteId,title:'Ne pas créer',lines:[]},userId));
 }
 assert.equal(await prisma.document.count({where:{worksiteId}}),0);
 assert.equal(await prisma.planningEvent.count({where:{worksiteId}}),0);
 assert.equal(await prisma.worksiteTask.count({where:{worksiteId}}),0);
});

test('search_worksites : retrouve le chantier de test par référence', async () => {
  const { result } = await runTool('search_worksites', { query: 'R-ASSIST-TEST' }, userId);
  const items = result as { id: string; ref: string }[];
  assert.ok(items.some((w) => w.id === worksiteId));
});
