import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let davidToken = '';
let workerToken = '';
let workerUserId = '';
let worksiteId = '';
let testPersonId = '';
let originalWorkerPersonId: string | null = null;

async function login(email: string) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'jjd' }),
  });
  return (await r.json()).token as string;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  davidToken = await login('david@jjd-consult.be');

  // nettoyage défensif d'un run précédent interrompu (sinon FK : un User pointerait encore
  // vers ce Person via personId)
  const stale = await prisma.person.findFirst({ where: { normalizedName: 'zephyrine mentionnable' } });
  if (stale) {
    await prisma.user.updateMany({ where: { personId: stale.id }, data: { personId: null } });
    await prisma.person.delete({ where: { id: stale.id } });
  }
  const person = await prisma.person.create({
    data: { firstName: 'Test', displayName: 'Zephyrine Mentionnable', normalizedName: 'zephyrine mentionnable', role: 'worker', source: 'test' },
  });
  testPersonId = person.id;

  const originalUser = await prisma.user.findUnique({ where: { email: 'chef@jjd-consult.be' } });
  originalWorkerPersonId = originalUser?.personId ?? null;
  await prisma.user.update({ where: { email: 'chef@jjd-consult.be' }, data: { personId: person.id } });
  workerUserId = originalUser!.id;
  workerToken = await login('chef@jjd-consult.be');

  const ws = await prisma.worksite.create({ data: { ref: 'R-MSGTEST', title: 'Messagerie test', source: 'test' } });
  worksiteId = ws.id;
});

after(async () => {
  await prisma.message.deleteMany({ where: { thread: { worksiteId } } });
  await prisma.timeEntry.deleteMany({ where: { worksiteId } });
  await prisma.thread.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  await prisma.user.update({ where: { email: 'chef@jjd-consult.be' }, data: { personId: originalWorkerPersonId } });
  await prisma.person.deleteMany({ where: { id: testPersonId } });
  server.close();
});

const authOf = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

test('mention @Nom : crée une MessageMention et l’expose (mentionedNames) au relire du fil', async () => {
  const post = await fetch(`${base}/api/worksites/${worksiteId}/thread/messages`, {
    method: 'POST',
    headers: authOf(davidToken),
    body: JSON.stringify({ body: 'Salut @Zephyrine Mentionnable, tu peux passer demain ?' }),
  });
  assert.equal(post.status, 201);
  const { message } = await post.json();

  const mention = await prisma.messageMention.findFirst({ where: { messageId: message.id, userId: workerUserId } });
  assert.ok(mention, 'la mention doit être enregistrée en base');

  const get = await fetch(`${base}/api/worksites/${worksiteId}/thread`, { headers: authOf(davidToken) });
  const { messages } = await get.json();
  const found = messages.find((m: { id: string }) => m.id === message.id);
  assert.ok(found.mentionedNames.includes('Zephyrine Mentionnable'));
});

test('mention : ne se déclenche pas sur un "@" isolé sans nom valide, ni sur l’auteur lui-même', async () => {
  const post = await fetch(`${base}/api/worksites/${worksiteId}/thread/messages`, {
    method: 'POST',
    headers: authOf(davidToken),
    body: JSON.stringify({ body: 'Le prix est de 12@h, rien à voir' }),
  });
  assert.equal(post.status, 201);
  const { message } = await post.json();
  const count = await prisma.messageMention.count({ where: { messageId: message.id } });
  assert.equal(count, 0);
});

test('inbox Messagerie : un ouvrier ne voit que les chantiers où il a du pointage/planning', async () => {
  // message posté -> le fil existe et a un message "internal", condition nécessaire pour
  // apparaître dans la liste, mais pas suffisante sans pointage/affectation
  await fetch(`${base}/api/worksites/${worksiteId}/thread/messages`, {
    method: 'POST', headers: authOf(davidToken), body: JSON.stringify({ body: 'Message de test inbox' }),
  });

  const before1 = await (await fetch(`${base}/api/messagerie/threads?audience=internal`, { headers: authOf(workerToken) })).json();
  assert.ok(!before1.items.some((it: { worksiteId: string | null }) => it.worksiteId === worksiteId), 'pas encore visible sans pointage ni planning');

  await prisma.timeEntry.create({ data: { personId: testPersonId, worksiteId, date: new Date(), hours: 4, source: 'test' } });

  const after1 = await (await fetch(`${base}/api/messagerie/threads?audience=internal`, { headers: authOf(workerToken) })).json();
  assert.ok(after1.items.some((it: { worksiteId: string | null }) => it.worksiteId === worksiteId), 'visible une fois du pointage enregistré sur ce chantier');

  // le bureau, lui, voit tout sans condition
  const officeView = await (await fetch(`${base}/api/messagerie/threads?audience=internal`, { headers: authOf(davidToken) })).json();
  assert.ok(officeView.items.some((it: { worksiteId: string | null }) => it.worksiteId === worksiteId));
});
