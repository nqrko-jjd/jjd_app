import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
let server: Server;
let base = '';
let token = '';
let sourceId = '';
let contactId = '';
const ids: string[] = [];
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  token = (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({email:'david@jjd-consult.be',password:'jjd'}) })).json()).token;
  assert.ok(token);
  contactId = (await prisma.contact.create({ data: { name: 'Duplication test', normalizedName: 'duplication test', type: 'client' } })).id;
  const src = await prisma.worksite.create({ data: {
    ref: 'R-DUPLICATE-TEST', title: 'Ancien chantier', entity: 'jjd', status: 'closed', archived: true,
    clientId: contactId, billToContactId: contactId, address: 'Rue du Test 1', box: '4',
    postalCode: '1000', city: 'Bruxelles', unitLabel: 'Lot A',
    quotedHt: 12000, quoteRef: 'D-OLD', clientRef: 'PO-OLD', description: 'Ancien travail',
    endedOn: new Date(), priority: 'urgent',
    contacts: { create: [{ contactId, role: 'sur_place', name: 'Contact test', phone: '012345678', email: 'test@example.com', position: 0 }] },
    documents: { create: [{ kind: 'invoice', totalTtc: 121, paidAmount: 121, status: 'paid' }] },
  } });
  sourceId = src.id; ids.push(src.id);
});
after(async () => {
  await prisma.auditLog.deleteMany({ where: { entity: 'worksite', entityId: { in: ids } } });
  await prisma.document.deleteMany({ where: { worksiteId: { in: ids } } });
  await prisma.worksiteContact.deleteMany({ where: { worksiteId: { in: ids } } });
  await prisma.worksite.deleteMany({ where: { id: { in: ids } } });
  if (contactId) await prisma.contact.delete({ where: { id: contactId } });
  server.close();
});
async function duplicate(id: string, title = 'Nouvelle intervention', authenticated = true) {
  const r = await fetch(base + '/api/worksites/' + id + '/duplicate', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ title }),
  });
  const body = await r.json();
  if (r.status === 201) ids.push(body.worksite.id);
  return { status: r.status, body };
}
test('duplicate keeps address and contacts with a fresh R reference and no previous activity', async () => {
  const result = await duplicate(sourceId);
  assert.equal(result.status, 201);
  const copy = await prisma.worksite.findUniqueOrThrow({ where: { id: result.body.worksite.id }, include: { contacts: true, _count: { select: { documents: true, ledgerEntries: true, tasks: true, timeEntries: true, events: true, reports: true, files: true } } } });
  assert.match(copy.ref, /^R-\d+$/);
  assert.notEqual(copy.id, sourceId);
  assert.equal(copy.title, 'Nouvelle intervention');
  assert.equal(copy.status, 'to_plan'); assert.equal(copy.archived, false); assert.equal(copy.priority, 'normal');
  assert.equal(copy.clientId, contactId); assert.equal(copy.billToContactId, contactId);
  assert.equal(copy.address, 'Rue du Test 1'); assert.equal(copy.box, '4');
  assert.equal(copy.postalCode, '1000'); assert.equal(copy.city, 'Bruxelles'); assert.equal(copy.unitLabel, 'Lot A');
  assert.equal(copy.contacts.length, 1); assert.equal(copy.contacts[0]!.contactId, contactId);
  assert.equal(copy.contacts[0]!.phone, '012345678');
  for (const field of ['quotedHt','quoteRef','clientRef','description','startedOn','endedOn'] as const) assert.equal(copy[field], null);
  for (const count of Object.values(copy._count)) assert.equal(count, 0);
  const original = await prisma.worksite.findUniqueOrThrow({where:{id:sourceId},include:{contacts:true,documents:true}});
  assert.notEqual(original.contacts[0]!.id, copy.contacts[0]!.id);
  assert.equal(original.status, 'closed'); assert.equal(original.documents.length, 1);
  const second = await duplicate(sourceId, 'Encore un chantier');
  assert.equal(second.status, 201); assert.notEqual(second.body.worksite.ref, copy.ref);
  assert.ok(await prisma.auditLog.findFirst({where:{entityId:copy.id,action:'duplicate'}}));
});
test('duplicate rejects an invalid title, missing source and unauthenticated requests', async () => {
  assert.equal((await duplicate(sourceId, '')).status, 422);
  assert.equal((await duplicate('missing-worksite')).status, 404);
  assert.equal((await duplicate(sourceId, 'Test', false)).status, 401);
});
