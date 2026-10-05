import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { normalizeName } from '@jjd/shared';

let server: Server;
let base = '';
let token = '';
let contactId = '';
let docId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  contactId = (await prisma.contact.create({ data: { name: 'Client Devis Orphelin', normalizedName: normalizeName('Client Devis Orphelin'), type: 'client' } })).id;
  docId = (await prisma.document.create({
    data: { kind: 'quote', direction: 'sale', status: 'accepted', number: 'DORPH-001', title: 'Rénovation toiture test', contactId, issuedOn: new Date('2026-05-01'), lockedAt: new Date('2026-05-01'), totalHt: 5000, totalVat: 300, totalTtc: 5300, source: 'legacy' },
  })).id;
});
after(async () => {
  await prisma.document.deleteMany({ where: { id: docId } });
  await prisma.contact.delete({ where: { id: contactId } });
  server.close();
});

test('« Reste à facturer » : un devis accepté sans chantier expose son n°, son client et son intitulé (pour le retrouver et lui imputer un R-)', async () => {
  const r = await (await fetch(`${base}/api/finance/forecast`, { headers: { authorization: `Bearer ${token}` } })).json() as { items: { documentId?: string; number?: string; client?: string; subject?: string; worksiteId: string | null; remaining: number }[] };
  const it = r.items.find((i) => i.documentId === docId);
  assert.ok(it, 'le devis orphelin est listé');
  assert.equal(it!.worksiteId, null);
  assert.equal(it!.number, 'DORPH-001');
  assert.equal(it!.client, 'Client Devis Orphelin');
  assert.equal(it!.subject, 'Rénovation toiture test');
  assert.equal(it!.remaining, 5000);
});
