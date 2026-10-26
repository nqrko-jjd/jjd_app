import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let acpId = '';
let wsId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) })).json()).token;
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  await prisma.contact.deleteMany({ where: { id: acpId } });
  server.close();
});

test('import des chantiers : la colonne Immeuble rattache le chantier à la fiche immeuble (nom inconnu = avertissement)', async () => {
  const acp = await prisma.contact.create({ data: { name: 'ACP Importtest', normalizedName: 'acp importtest', type: 'client', kind: 'acp' } });
  acpId = acp.id;
  const ws = await prisma.worksite.create({ data: { ref: 'R-IMPB1', title: 'Chantier import immeuble', status: 'lead', source: 'test' } });
  wsId = ws.id;

  const send = async (building: string) => {
    const form = new FormData();
    form.append('file', new Blob([`id;Immeuble\n${ws.id};${building}\n`], { type: 'text/csv' }), 'chantiers.csv');
    const r = await fetch(`${base}/api/worksites/import`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    assert.equal(r.status, 200);
    return (await r.json()) as { updated: number; skipped: number; warnings: { message: string }[] };
  };

  const unknown = await send('ACP Qui N Existe Pas');
  assert.equal(unknown.updated, 0);
  assert.match(unknown.warnings[0]!.message, /Immeuble/);
  assert.equal((await prisma.worksite.findUniqueOrThrow({ where: { id: ws.id } })).acpId, null);

  const ok = await send('acp importtest');
  assert.equal(ok.updated, 1);
  assert.equal((await prisma.worksite.findUniqueOrThrow({ where: { id: ws.id } })).acpId, acp.id);
});
