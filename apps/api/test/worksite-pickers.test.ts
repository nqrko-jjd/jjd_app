import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
const ids: string[] = [];

async function jf<T>(path: string): Promise<T> {
  const r = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as T;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  const open = await prisma.worksite.create({ data: { ref: 'R-PK-OUVERT', title: 'Chantier ouvert test', kind: 'project', status: 'in_progress', source: 'test' } });
  const closed = await prisma.worksite.create({ data: { ref: 'R-PK-CLOS', title: 'Vieux dossier test', kind: 'project', status: 'closed', archived: true, source: 'test' } });
  ids.push(open.id, closed.id);
});

after(async () => {
  await prisma.worksite.deleteMany({ where: { id: { in: ids } } });
  server.close();
});

test('listes des formulaires : les chantiers clôturés/archivés restent choisissables, après les chantiers ouverts', async () => {
  for (const path of ['/api/meta/pickers', '/api/finance/expenses/meta']) {
    const r = await jf<{ worksites: { id: string; name: string }[] }>(path);
    const names = r.worksites.map((w) => w.name);
    const iOpen = names.findIndex((n) => n.startsWith('R-PK-OUVERT'));
    const iClosed = names.findIndex((n) => n.startsWith('R-PK-CLOS'));
    assert.ok(iOpen >= 0, `${path} : chantier ouvert présent`);
    assert.ok(iClosed >= 0, `${path} : chantier clôturé présent`);
    assert.ok(names[iClosed]!.endsWith('(clôturé)'), `${path} : suffixe clôturé`);
    assert.ok(iClosed > iOpen, `${path} : les clôturés viennent après les ouverts`);
  }
});
