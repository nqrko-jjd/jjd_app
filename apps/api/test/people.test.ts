import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';

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
});

after(async () => {
  await prisma.person.deleteMany({ where: { normalizedName: { in: ['personne import test', 'jean import test'] } } });
  server.close();
});

test('export CSV puis réimport : met à jour par id, crée les nouvelles fiches', async () => {
  const toUpdate = await prisma.person.create({
    data: { firstName: 'Personne', lastName: 'Import Test', normalizedName: 'personne import test', role: 'worker', source: 'test' },
  });

  const csv = [
    'id;Prénom;Nom;Nom affiché;Rôle;Contrat;Taux horaire;Heures/jour;Téléphone;Email;Adresse;Actif;Note',
    `${toUpdate.id};Personne;Import Test;;Chef de chantier;Salarié;22,5;9;;;;Oui;maj via import`,
    ';Jean;Import Test;;Ouvrier;Salarié;18;10;;;;Oui;créé via import',
  ].join('\r\n');

  const r = await jfUpload<{ created: number; updated: number; warnings: unknown[] }>('/api/people/import', 'equipe.csv', csv);
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, 1);
  assert.equal(r.body.created, 1);
  assert.equal(r.body.warnings.length, 0);

  const updated = await prisma.person.findUnique({ where: { id: toUpdate.id } });
  assert.equal(updated!.role, 'foreman');
  assert.equal(updated!.hourlyRate, 22.5);

  const created = await prisma.person.findFirst({ where: { normalizedName: 'jean import test' } });
  assert.ok(created);
  assert.equal(created!.role, 'worker');
  assert.equal(created!.source, 'manual');
});
