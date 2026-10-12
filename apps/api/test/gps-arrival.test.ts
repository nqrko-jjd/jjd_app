import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { setMailTransportForTests } from '../src/lib/doc-mail.js';
import { syncVehiclePositions, listPajDevices, resetPajSessionForTests } from '../src/lib/paj.js';
import { runArrivalNotices, saveArrivalSettings, DEFAULT_ARRIVAL_SETTINGS, distanceKm, etaMinutes } from '../src/lib/arrival-notices.js';

const sent: Record<string, unknown>[] = [];
const created: { ws?: string; client?: string; vehicle?: string; vehicle2?: string; events: string[] } = { events: [] };
const realFetch = globalThis.fetch;
let pointLat = 50.8503; // chantier : Bruxelles centre
let logins = 0;

before(async () => {
  env.pajEmail = 'paj@test.be'; env.pajPassword = 'secret';
  env.smtp.host = 'smtp.test'; env.smtp.user = 'info@jjd-consult.be'; env.smtp.password = 'x';
  setMailTransportForTests({ sendMail: async (opts: Record<string, unknown>) => { sent.push(opts); return {}; } } as never);
  resetPajSessionForTests();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('connect.paj-gps.de')) return realFetch(input as never, init);
    if (url.includes('/login')) { logins++; return new Response(JSON.stringify({ success: { token: 'tok', expires_in: 2592000 } }), { status: 200 }); }
    if (url.endsWith('/device')) return new Response(JSON.stringify({ success: [{ id: 111, name: 'Traceur camionnette' }, { id: 222, name: 'Traceur Berlingo' }] }), { status: 200 });
    if (url.includes('/trackerdata/111/last_points')) return new Response(JSON.stringify({ success: [{ lat: pointLat, lng: 4.3517, dateunix: Math.floor(Date.now() / 1000) - 60, battery: 80, speed: 30 }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const client = await prisma.contact.create({ data: { name: 'Client Arrivée SA', normalizedName: 'client arrivee sa', type: 'client', email: 'client-arrivee@exemple.be' } });
  created.client = client.id;
  created.ws = (await prisma.worksite.create({ data: { ref: 'R-GPS-TEST', title: 'Chantier GPS', source: 'test', lat: 50.8503, lng: 4.3517, clientId: client.id } })).id;
  created.vehicle = (await prisma.vehicle.create({ data: { name: 'Camionnette test', plate: 'T-GPS-1', pajDeviceId: '111' } })).id;
  const start = new Date(Date.now() + 30 * 60_000);
  const ev = await prisma.planningEvent.create({ data: { worksiteId: created.ws, startAt: start, endAt: new Date(start.getTime() + 3600_000), kind: 'intervention', status: 'confirmed', vehicles: { create: [{ vehicleId: created.vehicle }] } } });
  created.events.push(ev.id);
});
after(async () => {
  globalThis.fetch = realFetch; setMailTransportForTests(null);
  env.pajEmail = ''; env.pajPassword = ''; env.smtp.host = ''; env.smtp.user = ''; env.smtp.password = '';
  await prisma.arrivalNotice.deleteMany({ where: { eventId: { in: created.events } } });
  await prisma.planningEvent.deleteMany({ where: { id: { in: created.events } } });
  await prisma.vehicle.deleteMany({ where: { id: created.vehicle } });
  await prisma.worksite.deleteMany({ where: { id: created.ws } });
  await prisma.contact.deleteMany({ where: { id: created.client } });
  await prisma.setting.deleteMany({ where: { key: 'arrivalNotices' } });
});

test('distance et délai estimé', () => {
  assert.ok(Math.abs(distanceKm({ lat: 50.85, lng: 4.35 }, { lat: 50.95, lng: 4.35 }) - 11.1) < 0.3);
  assert.equal(etaMinutes(0.5), 5);
  assert.equal(etaMinutes(4.5), 10);
});

test('PAJ : connexion, liste des traceurs, positions lues', async () => {
  assert.deepEqual(await listPajDevices(), [{ id: '111', name: 'Traceur camionnette' }, { id: '222', name: 'Traceur Berlingo' }]);
  assert.equal(await syncVehiclePositions(), 1);
  assert.equal(logins, 1, 'une seule connexion, jeton réutilisé');
  const v = await prisma.vehicle.findUnique({ where: { id: created.vehicle! } });
  assert.equal(v?.lastLat, 50.8503); assert.equal(v?.lastSpeed, 30);
});

test('avis d’arrivée : désactivé par défaut, loin = rien, proche = un seul e-mail, adresse de test respectée', async () => {
  sent.length = 0;
  pointLat = 50.8503 + 0.02; await syncVehiclePositions(); // ~2,2 km du chantier
  assert.equal(await runArrivalNotices(), 0, 'désactivé : rien ne part');

  await saveArrivalSettings({ ...DEFAULT_ARRIVAL_SETTINGS, enabled: true, radiusKm: 5, testTo: 'moi@jjd-consult.be' });
  pointLat = 50.8503 + 0.2; await syncVehiclePositions(); // ~22 km
  assert.equal(await runArrivalNotices(), 0, 'trop loin');

  pointLat = 50.8503 + 0.02; await syncVehiclePositions();
  assert.equal(await runArrivalNotices(), 1);
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { to: string[] }).to[0], 'moi@jjd-consult.be', 'adresse de test : le client n’est pas prévenu');
  assert.match(String(sent[0]!.text), /environ \d+ minutes/);
  assert.ok(!/50\.8|4\.35/.test(String(sent[0]!.text)), 'aucune coordonnée dans le message');
  assert.equal(await runArrivalNotices(), 0, 'une seule fois par intervention');
});
