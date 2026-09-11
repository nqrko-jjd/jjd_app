import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let vehicleId = '';

// PNG 1×1 rouge
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (
    await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  const veh = await prisma.vehicle.create({ data: { brand: 'Test', model: 'Doc', source: 'test' } });
  vehicleId = veh.id;
});

after(async () => {
  await prisma.vehicleDoc.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('documents véhicule : créer, joindre un fichier, consulter, supprimer', async () => {
  const create = await fetch(`${base}/api/vehicles/${vehicleId}/docs`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'insurance', label: 'Assurance omnium', number: 'POL-123' }),
  });
  assert.equal(create.status, 201);
  const { doc } = await create.json();
  assert.equal(doc.type, 'insurance');
  assert.equal(doc.fileUrl, null);

  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'assurance.png');
  const upload = await fetch(`${base}/api/vehicles/${vehicleId}/docs/${doc.id}/file`, {
    method: 'POST',
    headers: auth(),
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploaded = (await upload.json()).doc;
  assert.match(uploaded.fileUrl, /^\/uploads\/vehicle-docs\/.+\.png$/);

  const view = await fetch(`${base}/api/vehicles/${vehicleId}/docs/${doc.id}/file`, { headers: auth() });
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('content-type'), 'image/png');

  const del = await fetch(`${base}/api/vehicles/${vehicleId}/docs/${doc.id}`, { method: 'DELETE', headers: auth() });
  assert.equal(del.status, 204);
  const remaining = await prisma.vehicleDoc.findUnique({ where: { id: doc.id } });
  assert.equal(remaining, null);
});

test('documents véhicule : le détail du véhicule renvoie ses docs', async () => {
  await prisma.vehicleDoc.create({ data: { vehicleId, type: 'registration', label: 'Certificat' } });
  const r = await fetch(`${base}/api/vehicles/${vehicleId}`, { headers: auth() });
  assert.equal(r.status, 200);
  const { vehicle } = await r.json();
  assert.ok(vehicle.docs.some((d: { type: string }) => d.type === 'registration'));
});
