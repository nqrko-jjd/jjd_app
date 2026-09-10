import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';

async function jfUpload<T>(path: string, filename: string, content: string): Promise<{ status: number; body: T }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), filename);
  const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await login.json()).token;

  const ws = await prisma.worksite.create({ data: { ref: 'R-SALES-TEST', title: 'Ventes — test', source: 'test' } });
  worksiteId = ws.id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test('export CSV puis réimport (ventes) : met à jour par id, crée les nouvelles lignes en direction "sale"', async () => {
  const toUpdate = await prisma.ledgerEntry.create({
    data: { direction: 'sale', worksiteId, ht: 100, ttc: 121, date: new Date('2026-09-01'), source: 'test', paymentStatus: 'Non payé' },
  });

  const csv = [
    'id;Date;Échéance;Client;N° document;Chantier;HT;TVA due;TTC;Statut;Notes',
    `${toUpdate.id};2026-09-05;;Client MAJ;FAC-MAJ;R-SALES-TEST;300;63;363;Payé;maj via import`,
    ';2026-09-06;;Nouveau Client;FAC-NEW;R-SALES-TEST;80;16,8;96,8;Non payé;créé via import',
  ].join('\r\n');

  const r = await jfUpload<{ created: number; updated: number; warnings: unknown[] }>('/api/finance/sales/import', 'ventes.csv', csv);
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, 1);
  assert.equal(r.body.created, 1);
  assert.equal(r.body.warnings.length, 0);

  const updated = await prisma.ledgerEntry.findUnique({ where: { id: toUpdate.id } });
  assert.equal(updated!.direction, 'sale');
  assert.equal(updated!.ht, 300);
  assert.equal(updated!.paymentStatus, 'Payé');

  const created = await prisma.ledgerEntry.findFirst({ where: { docNumber: 'FAC-NEW', worksiteId } });
  assert.ok(created);
  assert.equal(created!.direction, 'sale');
  assert.equal(created!.ht, 80);
  assert.equal(created!.worksiteId, worksiteId);
});
