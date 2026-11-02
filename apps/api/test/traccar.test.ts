import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/env.js';
import { isTraccarId, listTraccarDevices, lastTraccarPoint, traccarPointsBetween } from '../src/lib/traccar.js';

const realFetch = globalThis.fetch;
const urls: { url: string; auth: string | null }[] = [];
before(() => {
  env.traccarUrl = 'http://jjd-traccar:8082/'; env.traccarToken = 'tok';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    if (url.includes('/api/devices')) return new Response(JSON.stringify([{ id: 12, name: 'Test SinoTrack', uniqueId: '7028986229' }]), { status: 200 });
    if (url.includes('from=')) return new Response(JSON.stringify([
      { latitude: 50.65, longitude: 4.86, speed: 10, fixTime: '2026-11-02T12:10:00.000+00:00' },
      { latitude: 50.64, longitude: 4.85, speed: 0, fixTime: '2026-11-02T12:00:00.000+00:00' },
      { latitude: 0, longitude: 0, speed: 0, fixTime: '2026-11-02T12:20:00.000+00:00' },
    ]), { status: 200 });
    return new Response(JSON.stringify([{ latitude: 50.65434, longitude: 4.86505, speed: 2.1, fixTime: '2026-11-02T12:37:51.000+00:00', attributes: { batteryLevel: 87 } }]), { status: 200 });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; env.traccarUrl = ''; env.traccarToken = ''; });

test('identifiants Traccar préfixés et appareils listés', async () => {
  assert.equal(isTraccarId('tc:12'), true);
  assert.equal(isTraccarId('1011399158'), false);
  assert.deepEqual(await listTraccarDevices(), [{ id: 'tc:12', name: 'Test SinoTrack (Traccar)' }]);
  assert.equal(urls[0]!.auth, 'Bearer tok');
  assert.ok(urls[0]!.url.startsWith('http://jjd-traccar:8082/api/devices'));
});

test('dernière position : nœuds convertis en km/h, batterie lue', async () => {
  const p = await lastTraccarPoint('tc:12');
  assert.ok(p);
  assert.equal(p.lat, 50.65434);
  assert.ok(Math.abs(p.speed! - 3.89) < 0.01, `speed=${p.speed}`); // 2,1 nœuds
  assert.equal(p.battery, 87);
});

test('historique : trié, point 0/0 écarté', async () => {
  const pts = await traccarPointsBetween('tc:12', new Date('2026-11-02T00:00:00Z'), new Date('2026-11-02T13:00:00Z'));
  assert.equal(pts.length, 2);
  assert.ok(pts[0]!.at < pts[1]!.at);
});
