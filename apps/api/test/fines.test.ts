import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server; let base = ''; let token = '';
const ids: { v?: string; ws?: string; p?: string; fines: string[] } = { fines: [] };
const call = async (method: string, p: string, body?: object) => {
  const r = await fetch(`${base}/api/vehicles${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.v = (await prisma.vehicle.create({ data: { name: 'Camionnette PV', plate: 'T-PV-123' } })).id;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-FINE', title: 'Chantier amende', source: 'test' } })).id;
  ids.p = (await prisma.person.create({ data: { firstName: 'Conducteur', normalizedName: 'conducteur', displayName: 'Cond.', role: 'worker' } })).id;
  await prisma.planningEvent.create({ data: { worksiteId: ids.ws, startAt: new Date('2026-09-12T06:30:00Z'), endAt: new Date('2026-09-12T15:00:00Z'), kind: 'intervention', status: 'confirmed', vehicles: { create: [{ vehicleId: ids.v, driverPersonId: ids.p }] } } });
});
after(async () => {
  await prisma.fine.deleteMany({ where: { OR: [{ vehicleId: ids.v }, { id: { in: ids.fines } }] } });
  await prisma.planningEvent.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.person.deleteMany({ where: { id: ids.p } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  await prisma.vehicle.deleteMany({ where: { id: ids.v } });
  server.close();
});

test('PV de la flotte : création (plaque → véhicule), modification, payé / impayé, conducteur du planning, suppression', async () => {
  assert.equal((await call('POST', '/fines', {})).status, 422, 'ni véhicule ni plaque');
  const c = await call('POST', '/fines', { plateRaw: 't pv 123', date: '2026-09-12', time: '14:05', reference: 'PV-TEST-1', type: 'Stationnement', amount: 58, payTo: 'Ville de Bruxelles', street: 'Rue Royale 1', postalCode: '1000' });
  assert.equal(c.status, 201);
  ids.fines.push(c.body.fine.id);
  assert.equal(c.body.fine.vehicleId, ids.v, 'la plaque retrouve le véhicule (sans tirets ni espaces)');

  const list = await call('GET', `/fines?vehicleId=${ids.v}`);
  const f = list.body.items.find((x: { id: string }) => x.id === c.body.fine.id);
  assert.deepEqual(f.planned.drivers, ['Cond.'], 'conducteur du véhicule ce jour-là d’après le planning');
  assert.equal((await call('GET', '/fines?q=PV-TEST-1')).body.items.length, 1);

  const edit = await call('PATCH', `/fines/${f.id}`, { amount: 60, driverPersonId: ids.p, note: 'Contesté ?' });
  assert.equal(edit.status, 200); assert.equal(edit.body.fine.amount, 60);
  assert.equal((await call('GET', `/fines?vehicleId=${ids.v}`)).body.items[0].driverName, 'Cond.');

  const paid = await call('PATCH', `/fines/${f.id}`, { status: 'Payé' });
  assert.equal(paid.body.fine.status, 'Payé'); assert.ok(paid.body.fine.paidOn, 'date de paiement posée');
  assert.equal((await call('GET', `/fines?vehicleId=${ids.v}&unpaid=1`)).body.items.length, 0, 'plus dans les impayés');
  const unpaid = await call('PATCH', `/fines/${f.id}`, { status: null });
  assert.equal(unpaid.body.fine.paidOn, null);

  assert.equal((await call('DELETE', `/fines/${f.id}`)).status, 200);
  assert.equal((await call('DELETE', `/fines/${f.id}`)).status, 404);
});
