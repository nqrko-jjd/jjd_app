import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let davidId = '';
let melvinaId = '';
let wsId = '';

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
  const loginJson = await login.json();
  token = loginJson.token;
  davidId = loginJson.user.id;
  const melvina = await prisma.user.findUniqueOrThrow({ where: { email: 'melvina@jjd-consult.be' } });
  melvinaId = melvina.id;
  const ws = await prisma.worksite.create({ data: { ref: 'R-TASKTEST', title: 'Tasks test', source: 'test' } });
  wsId = ws.id;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

test('POST /api/worksites/:id/tasks avec assigneeIds -> les deux assignés ressortent', async () => {
  const post = await fetch(`${base}/api/worksites/${wsId}/tasks`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ title: 'Poser le carrelage', assigneeIds: [davidId, melvinaId] }),
  });
  assert.equal(post.status, 201);
  const posted = await post.json();
  assert.equal(posted.task.assignees.length, 2);
  assert.deepEqual(new Set(posted.task.assignees.map((a: { id: string }) => a.id)), new Set([davidId, melvinaId]));

  const list = await (await fetch(`${base}/api/worksites/${wsId}/tasks`, { headers: auth() })).json();
  const found = list.items.find((t: { id: string }) => t.id === posted.task.id);
  assert.equal(found.assignees.length, 2);
});

test('PATCH /api/tasks/:id avec assigneeIds remplace les assignés', async () => {
  const post = await fetch(`${base}/api/worksites/${wsId}/tasks`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ title: 'Tâche à réassigner', assigneeIds: [davidId] }),
  });
  const { task } = await post.json();

  const patch = await fetch(`${base}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ assigneeIds: [melvinaId] }),
  });
  assert.equal(patch.status, 200);
  const patched = await patch.json();
  assert.deepEqual(patched.task.assignees.map((a: { id: string }) => a.id), [melvinaId]);
});

test('POST /api/tasks sans worksiteId -> tâche générale, visible dans ?mine=1 pour l’assigné', async () => {
  const post = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ title: 'Ranger le dépôt', assigneeIds: [davidId] }),
  });
  assert.equal(post.status, 201);
  const { task } = await post.json();
  assert.equal(task.worksiteId, null);

  const general = await (await fetch(`${base}/api/tasks`, { headers: auth() })).json();
  assert.ok(general.items.some((t: { id: string }) => t.id === task.id));

  const mine = await (await fetch(`${base}/api/tasks?mine=1`, { headers: auth() })).json();
  assert.ok(mine.items.some((t: { id: string }) => t.id === task.id));

  await prisma.worksiteTask.delete({ where: { id: task.id } }); // tâche générale, pas de cascade via wsId
});

test('POST /api/documents/:id/tasks-from-lines crée une tâche par ligne sélectionnée, source "quote"', async () => {
  const doc = await prisma.document.create({
    data: {
      kind: 'quote',
      worksiteId: wsId,
      source: 'test',
      lines: {
        create: [
          { kind: 'item', label: 'Démontage ancien carrelage', position: 0 },
          { kind: 'item', label: 'Pose du nouveau carrelage', position: 1 },
          { kind: 'section', label: 'Salle de bain', position: 2 },
        ],
      },
    },
    include: { lines: true },
  });
  const itemLineIds = doc.lines.filter((l) => l.kind === 'item').map((l) => l.id);

  const r = await fetch(`${base}/api/documents/${doc.id}/tasks-from-lines`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ lineIds: itemLineIds, assigneeIds: [melvinaId] }),
  });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.tasks.length, 2);
  assert.ok(j.tasks.every((t: { source: string }) => t.source === 'quote'));
  assert.ok(j.tasks.every((t: { assignees: { id: string }[] }) => t.assignees.some((a) => a.id === melvinaId)));

  await prisma.document.delete({ where: { id: doc.id } });
});

test('POST /api/documents/:id/tasks-from-lines : 422 si le devis n’a pas de chantier', async () => {
  const doc = await prisma.document.create({
    data: { kind: 'quote', source: 'test', lines: { create: [{ kind: 'item', label: 'Ligne orpheline', position: 0 }] } },
    include: { lines: true },
  });
  const r = await fetch(`${base}/api/documents/${doc.id}/tasks-from-lines`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ lineIds: [doc.lines[0]!.id] }),
  });
  assert.equal(r.status, 422);
  await prisma.document.delete({ where: { id: doc.id } });
});

test('phases : créée, tâche rattachée, renommée, supprimée -> la tâche repasse sans phase', async () => {
  const create = await fetch(`${base}/api/worksites/${wsId}/phases`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ name: 'Gros-oeuvre' }),
  });
  assert.equal(create.status, 201);
  const { phase } = await create.json();

  const list = await (await fetch(`${base}/api/worksites/${wsId}/phases`, { headers: auth() })).json();
  assert.ok(list.items.some((p: { id: string }) => p.id === phase.id));

  const rename = await fetch(`${base}/api/phases/${phase.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ name: 'Gros-oeuvre & structure' }),
  });
  assert.equal(rename.status, 200);
  assert.equal((await rename.json()).phase.name, 'Gros-oeuvre & structure');

  const taskPost = await fetch(`${base}/api/worksites/${wsId}/tasks`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ title: 'Couler la dalle', phaseId: phase.id }),
  });
  const { task } = await taskPost.json();
  assert.equal(task.phaseId, phase.id);

  const del = await fetch(`${base}/api/phases/${phase.id}`, { method: 'DELETE', headers: auth() });
  assert.equal(del.status, 200);

  const after2 = await (await fetch(`${base}/api/worksites/${wsId}/tasks`, { headers: auth() })).json();
  const found = after2.items.find((t: { id: string }) => t.id === task.id);
  assert.equal(found.phaseId, null); // la tâche survit, juste sans phase (SetNull)
});

test('GET /api/tasks?view=overdue|today : filtre par échéance, exclut les tâches terminées pour "overdue"', async () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const lateTask = await (
    await fetch(`${base}/api/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'En retard', dueOn: yesterday }) })
  ).json();
  const lateDoneTask = await (
    await fetch(`${base}/api/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'En retard mais faite', dueOn: yesterday }) })
  ).json();
  await fetch(`${base}/api/tasks/${lateDoneTask.task.id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ status: 'done' }) });
  const todayTask = await (
    await fetch(`${base}/api/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'Pour aujourd’hui', dueOn: today }) })
  ).json();

  const overdue = await (await fetch(`${base}/api/tasks?view=overdue`, { headers: auth() })).json();
  assert.ok(overdue.items.some((t: { id: string }) => t.id === lateTask.task.id));
  assert.ok(!overdue.items.some((t: { id: string }) => t.id === lateDoneTask.task.id));
  assert.ok(!overdue.items.some((t: { id: string }) => t.id === todayTask.task.id));

  const dueToday = await (await fetch(`${base}/api/tasks?view=today`, { headers: auth() })).json();
  assert.ok(dueToday.items.some((t: { id: string }) => t.id === todayTask.task.id));
  assert.ok(!dueToday.items.some((t: { id: string }) => t.id === lateTask.task.id));

  await prisma.worksiteTask.deleteMany({ where: { id: { in: [lateTask.task.id, lateDoneTask.task.id, todayTask.task.id] } } });
});
