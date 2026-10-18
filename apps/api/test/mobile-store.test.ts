import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signToken } from '../src/lib/auth.js';
import { isExpoToken, notifyMobile, notifyMessage } from '../src/lib/native-push.js';

let server: Server, base = '', david = '', worker = '', userId = '', workerId = '';
const device = 'ExpoPushToken[store_test_device]';
const realFetch = globalThis.fetch;
let deliveries: any[] = [];
let expired = false;
before(async () => {
  const a = await prisma.user.findUniqueOrThrow({ where: { email: 'david@jjd-consult.be' } });
  const b = await prisma.user.findUniqueOrThrow({ where: { email: 'ouvrier@jjd-consult.be' } });
  userId = a.id; workerId = b.id; david = signToken(a.id); worker = signToken(b.id);
  server = createApp().listen(0); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://exp.host/--/api/v2/push/send') return realFetch(input, init);
    const batch = JSON.parse(String(init?.body)); deliveries.push(...batch);
    return new Response(JSON.stringify({ data: batch.map(() => expired ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'fake-ticket' }) }), { status: 200 });
  };
});
after(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: device } });
  await prisma.message.deleteMany({ where: { id: { startsWith: 'voice-' }, authorId: userId } });
  globalThis.fetch = realFetch; server.close();
});
const post = (path: string, token: string, body: unknown) => realFetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('native subscription rejects unauthenticated and malformed tokens', async () => {
  assert.equal(isExpoToken('https://attacker.invalid'), false);
  assert.equal((await post('/api/push/native/subscribe', '', { token: device })).status, 401);
  assert.equal((await post('/api/push/native/subscribe', david, { token: 'https://attacker.invalid' })).status, 422);
});
test('one native token belongs to one account and another user cannot unsubscribe it', async () => {
  assert.equal((await post('/api/push/native/subscribe', david, { token: device, userId: workerId })).status, 200);
  assert.equal((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: device } })).userId, userId);
  await post('/api/push/native/unsubscribe', worker, { token: device });
  assert.ok(await prisma.pushSubscription.findUnique({ where: { endpoint: device } }));
  await post('/api/push/native/subscribe', worker, { token: device });
  assert.equal((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: device } })).userId, workerId);
});
test('push payload contains only generic content and a recipient-bound route', async () => {
  deliveries = [];
  await notifyMobile([workerId, workerId], '/planning', 'Votre planning a été mis à jour');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].data.userId, workerId);
  assert.equal(deliveries[0].data.route, '/planning');
  assert.equal(deliveries[0].body, 'Ouvrez JJD Chantier pour consulter les nouveautés.');
});
test('new general messages never notify their author', async () => {
  deliveries = [];
  await notifyMessage(workerId);
  assert.equal(deliveries.length, 0);
});
test('expired native tokens are removed', async () => {
  expired = true;
  await notifyMobile([workerId], '/planning', 'Planning');
  assert.equal(await prisma.pushSubscription.findUnique({ where: { endpoint: device } }), null);
});
test('a retried voice upload returns the existing message', async () => {
  async function send() {
    const data = new FormData(); data.append('file', new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'audio/mp4' }), 'note.m4a'); data.append('requestId', 'store-test-voice');
    return realFetch(base + '/api/messagerie/general/voice', { method: 'POST', headers: { authorization: `Bearer ${david}` }, body: data });
  }
  const first = await send(); assert.equal(first.status, 201); const a = await first.json();
  const second = await send(); assert.equal(second.status, 200); const b = await second.json();
  assert.equal(a.message.id, b.message.id); assert.equal(a.message.kind, 'audio');
});

test('message reports are private to administrators and removal changes the conversation', async () => {
  const t = await prisma.thread.create({data:{kind:'general'}});
  const m = await prisma.message.create({data:{threadId:t.id,authorId:userId,body:'Synthetic moderation test'}});
  try {
    const path='/api/messagerie/moderation/reports';
    assert.equal((await post(path,'',{messageId:m.id,reason:'Contenu inapproprié'})).status,401);
    assert.equal((await post(path,worker,{messageId:m.id,reason:'Contenu inapproprié'})).status,201);
    assert.equal((await realFetch(base+path,{headers:{authorization:`Bearer ${worker}`}})).status,403);
    const list=await realFetch(base+path,{headers:{authorization:`Bearer ${david}`}});
    assert.equal(list.status,200);
    const report=(await list.json()).items.find((r:any)=>r.entityId===m.id);
    assert.ok(report);
    assert.equal((await post(`${path}/${report.id}/resolve`,worker,{remove:true})).status,403);
    assert.equal((await post(`${path}/${report.id}/resolve`,david,{remove:true})).status,200);
    const changed=await prisma.message.findUniqueOrThrow({where:{id:m.id}});
    assert.equal(changed.body,'Message retiré par la modération.');
    assert.equal(changed.fileUrl,null);
  } finally {
    await prisma.auditLog.deleteMany({where:{entityId:m.id}});
    await prisma.thread.delete({where:{id:t.id}});
  }
});
