import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { normalizeName } from '@jjd/shared';

let server: Server;
let base = '';
let token = '';
const docs: string[] = [];
let contactId = '';
let worksiteId = '';

async function patch(id: string, body: unknown) {
  const r = await fetch(`${base}/api/documents/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as { document?: { totalTtc: number; totalHt: number; worksiteId: string | null; lines: unknown[] } } | null };
}
const mkLegacy = async (number: string, ttc: number, extra: Record<string, unknown> = {}) => {
  const d = await prisma.document.create({
    data: { kind: 'invoice', direction: 'sale', status: 'overdue', number, contactId, issuedOn: new Date('2026-08-25'), dueOn: new Date('2026-09-05'), lockedAt: new Date('2026-08-25'), totalHt: ttc / 1.06, totalVat: ttc - ttc / 1.06, totalTtc: ttc, source: 'legacy', ...extra },
  });
  docs.push(d.id);
  return d;
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  contactId = (await prisma.contact.create({ data: { name: 'Client Legacy Test', normalizedName: normalizeName('Client Legacy Test'), type: 'client' } })).id;
  worksiteId = (await prisma.worksite.create({ data: { ref: 'R-LG-TEST', title: 'Chantier legacy test', kind: 'project', source: 'test' } })).id;
});
after(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: docs } } });
  await prisma.documentLine.deleteMany({ where: { documentId: { in: docs } } });
  await prisma.ledgerEntry.deleteMany({ where: { documentId: { in: docs } } });
  await prisma.document.deleteMany({ where: { id: { in: docs } } });
  await prisma.worksite.delete({ where: { id: worksiteId } });
  await prisma.contact.delete({ where: { id: contactId } });
  server.close();
});

test('document importé (sans lignes) : rattacher un chantier avec une liste de lignes vide ne remet PAS le montant à 0', async () => {
  const d = await mkLegacy('FLEG-001', 2343.45);
  const r = await patch(d.id, { worksiteId, lines: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body!.document!.worksiteId, worksiteId, 'le chantier est bien imputé');
  assert.equal(r.body!.document!.totalTtc, 2343.45, 'le montant est conservé');
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: d.id } })).totalTtc, 2343.45);
  assert.equal(await prisma.auditLog.count({ where: { entityId: d.id, action: 'edit_issued_lines' } }), 0, 'aucune « édition de lignes » tracée à tort');
});

test('document importé : y saisir réellement une ligne recalcule le total à partir de cette ligne', async () => {
  const d = await mkLegacy('FLEG-002', 1000);
  const r = await patch(d.id, { lines: [{ label: 'Prestation', qty: 1, unit: 'forfait', unitPriceHt: 500, vatRate: 0.06 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body!.document!.lines.length, 1);
  assert.equal(r.body!.document!.totalHt, 500);
  assert.equal(r.body!.document!.totalTtc, 530);
});

test('document avec lignes : vider les lignes reste possible (comportement inchangé)', async () => {
  const d = await mkLegacy('FLEG-003', 530);
  await patch(d.id, { lines: [{ label: 'X', qty: 1, unit: 'forfait', unitPriceHt: 500, vatRate: 0.06 }] });
  const r = await patch(d.id, { lines: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body!.document!.totalTtc, 0);
});
