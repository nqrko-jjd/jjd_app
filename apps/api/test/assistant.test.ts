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

test('les créations IA sont réservées à la direction et restent des brouillons',async()=>{
 const worker=await prisma.user.findFirst({where:{role:'worker',active:true}});
 if(worker)await assert.rejects(()=>runTool('create_task_draft',{worksiteId,title:'Interdit'},worker.id));
 assert.equal(await prisma.worksiteTask.count({where:{worksiteId}}),0);

 const devis=await runTool('create_devis_draft',{worksiteId,title:'Peinture',assumptions:'TVA à confirmer',lines:[{label:'Murs',qty:100,unit:'m²',unitPriceHt:20}]},userId);
 const d=await prisma.document.findUniqueOrThrow({where:{id:(devis.result as {id:string}).id}});
 assert.equal(d.status,'draft');assert.equal(d.number,null);assert.equal(d.source,'ai-draft');
 assert.equal(d.totalHt,2000);assert.equal(devis.action?.kind,'devis');

 const rdv=await runTool('create_planning_draft',{worksiteId,title:'RDV client',startAt:'2026-10-08T09:00:00+02:00',endAt:'2026-10-08T10:00:00+02:00'},userId);
 const ev=await prisma.planningEvent.findUniqueOrThrow({where:{id:(rdv.result as {id:string}).id}});
 assert.equal(ev.status,'tentative');assert.equal(ev.kind,'meeting');assert.equal(ev.source,'ai-draft');
 await assert.rejects(()=>runTool('create_planning_draft',{worksiteId,startAt:'2026-10-08T10:00:00Z',endAt:'2026-10-08T09:00:00Z'},userId));

 const task=await runTool('create_task_draft',{worksiteId,title:'Commander peinture'},userId);
 assert.equal((await prisma.worksiteTask.findUniqueOrThrow({where:{id:(task.result as {id:string}).id}})).source,'ai-draft');
});

test('search_worksites : retrouve le chantier de test par référence', async () => {
  const { result } = await runTool('search_worksites', { query: 'R-ASSIST-TEST' }, userId);
  const items = result as { id: string; ref: string }[];
  assert.ok(items.some((w) => w.id === worksiteId));
});
