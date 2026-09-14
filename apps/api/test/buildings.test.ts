import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let buildingId = '';

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
        body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  // un "immeuble" est un Contact de kind 'acp'/'developer' (fusion Contact/Immeuble) —
  // /api/buildings n'est qu'une vue filtrée de /api/contacts.
  const b = await prisma.contact.create({
    data: { name: 'Test Algarve', normalizedName: 'test algarve', type: 'client', kind: 'acp', source: 'test' },
  });
  buildingId = b.id;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { ref: 'R-TESTDEL' } });
  await prisma.contact.deleteMany({ where: { source: 'test' } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

test('immeuble : contacts clés + lots/occupants', async () => {
  const c = await fetch(`${base}/api/buildings/${buildingId}/contacts`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ role: 'concierge', name: 'M. Da Silva', phone: '0470 11 22 33' }),
  });
  assert.equal(c.status, 201);

  const u = await fetch(`${base}/api/buildings/${buildingId}/units`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ label: 'C1', floor: '1er étage', door: 'App C', occupantName: 'Mme Pinto', occupantKind: 'owner' }),
  });
  assert.equal(u.status, 201);
  const unitId = (await u.json()).unit.id;

  const detail = await (await fetch(`${base}/api/buildings/${buildingId}`, { headers: auth() })).json();
  assert.equal(detail.building.contacts.length, 1);
  assert.equal(detail.building.contacts[0].role, 'concierge');
  assert.equal(detail.building.units[0].occupantName, 'Mme Pinto');

  const patch = await fetch(`${base}/api/buildings/${buildingId}/units/${unitId}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ occupantPhone: '0475 99 88 77' }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).unit.occupantPhone, '0475 99 88 77');

  const del = await fetch(`${base}/api/buildings/${buildingId}/units/${unitId}`, { method: 'DELETE', headers: auth() });
  assert.equal(del.status, 200);
});

test('immeuble : un lot peut être lié à une vraie fiche contact (pas juste du texte libre)', async () => {
  await prisma.contact.deleteMany({ where: { name: 'Mme Pinto — test' } });
  const contact = await prisma.contact.create({
    data: { name: 'Mme Pinto — test', normalizedName: 'mme pinto test', type: 'client', phone: '0470 12 34 56', source: 'test' },
  });
  try {
    const u = await fetch(`${base}/api/buildings/${buildingId}/units`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ label: 'C2', contactId: contact.id }),
    });
    assert.equal(u.status, 201);
    const unitId = (await u.json()).unit.id;

    const detail = await (await fetch(`${base}/api/buildings/${buildingId}`, { headers: auth() })).json();
    const unit = detail.building.units.find((x: { id: string }) => x.id === unitId);
    assert.equal(unit.contactId, contact.id);
    assert.equal(unit.contact.name, 'Mme Pinto — test');
    assert.equal(unit.contact.phone, '0470 12 34 56');

    const cleared = await fetch(`${base}/api/buildings/${buildingId}/units/${unitId}`, {
      method: 'PATCH', headers: auth(), body: JSON.stringify({ contactId: null }),
    });
    assert.equal((await cleared.json()).unit.contactId, null);

    await fetch(`${base}/api/buildings/${buildingId}/units/${unitId}`, { method: 'DELETE', headers: auth() });
  } finally {
    await prisma.contact.deleteMany({ where: { id: contact.id } });
  }
});

test('immeuble : créer un immeuble crée directement un contact ACP (plus de fiche séparée)', async () => {
  await prisma.contact.deleteMany({ where: { name: 'Projet — test' } });
  const created = await fetch(`${base}/api/buildings`, {
    method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Projet — test', kind: 'developer' }),
  });
  assert.equal(created.status, 201);
  const building = (await created.json()).building;
  try {
    assert.equal(building.kind, 'developer');
    assert.equal(building.type, 'client');
    // la fiche est directement accessible comme contact ET comme immeuble — une seule ligne
    const asContact = await (await fetch(`${base}/api/contacts/${building.id}`, { headers: auth() })).json();
    assert.equal(asContact.contact.name, 'Projet — test');
  } finally {
    await prisma.contact.deleteMany({ where: { id: building.id } });
  }
});

test('immeuble : un résident (particulier) peut être lié à son ACP', async () => {
  await prisma.contact.deleteMany({ where: { name: 'M. Résident — test' } });
  const resident = await prisma.contact.create({
    data: { name: 'M. Résident — test', normalizedName: 'm resident test', type: 'client', kind: 'individual', linkedAcpId: buildingId, source: 'test' },
  });
  try {
    const detail = await (await fetch(`${base}/api/buildings/${buildingId}`, { headers: auth() })).json();
    const residents = detail.building.linkedContacts as { id: string }[];
    assert.ok(residents.some((r) => r.id === resident.id));
  } finally {
    await prisma.contact.deleteMany({ where: { id: resident.id } });
  }
});

test('immeuble : suppression bloquée si encore référencé, permise sinon', async () => {
  await prisma.worksite.deleteMany({ where: { ref: 'R-TESTDEL' } });
  const b = await prisma.contact.create({
    data: { name: 'Test à supprimer', normalizedName: 'test a supprimer', type: 'client', kind: 'acp', source: 'test' },
  });
  const ws = await prisma.worksite.create({ data: { ref: 'R-TESTDEL', title: 'Test', acpId: b.id, source: 'test' } });

  const blocked = await fetch(`${base}/api/buildings/${b.id}`, { method: 'DELETE', headers: auth() });
  assert.equal(blocked.status, 409);

  await prisma.worksite.delete({ where: { id: ws.id } });
  const ok = await fetch(`${base}/api/buildings/${b.id}`, { method: 'DELETE', headers: auth() });
  assert.equal(ok.status, 204);
  assert.equal(await prisma.contact.findUnique({ where: { id: b.id } }), null);
});

test('immeuble : champs ACP éditables', async () => {
  const r = await fetch(`${base}/api/buildings/${buildingId}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ reference: 'ACP-2024-17', lotCount: 24, digicode: 'A1234' }),
  });
  assert.equal(r.status, 200);
  const b = (await r.json()).building;
  assert.equal(b.reference, 'ACP-2024-17');
  assert.equal(b.lotCount, 24);
});
