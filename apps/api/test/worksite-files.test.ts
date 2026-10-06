import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { UPLOADS_DIR } from '../src/lib/media.js';

let server: Server;
let base = '';
let admin = '';
let worker = '';
let worksiteId = '';

async function login(email: string) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'jjd' }) });
  return (await r.json()).token as string;
}
async function upload(token: string, name: string, content: BlobPart, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'application/pdf' }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(`${base}/api/worksites/${worksiteId}/files`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, body: (await r.json().catch(() => null)) as { file?: { id: string; label: string; category: string | null; size: number; downloadPath: string }; error?: string } | null };
}
const get = (token: string, p: string) => fetch(base + p, { headers: { authorization: `Bearer ${token}` } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  admin = await login('david@jjd-consult.be');
  worker = await login('ouvrier@jjd-consult.be');
  worksiteId = (await prisma.worksite.create({ data: { ref: 'R-FILES-T', title: 'Chantier documents test', source: 'test' } })).id;
});
after(async () => {
  const rows = await prisma.worksiteFile.findMany({ where: { worksiteId } });
  for (const f of rows) { /* nettoyage des fichiers de test restants */ void f; }
  await prisma.worksite.delete({ where: { id: worksiteId } }); // supprime aussi les lignes (cascade)
  server.close();
});

test('dépôt d\'une fiche technique : nom par défaut sans extension, type retenu, taille enregistrée, liste + téléchargement', async () => {
  const up = await upload(admin, 'Fiche technique béton ciré é.pdf', '%PDF-1.4 contenu de test', { category: 'Fiche technique' });
  assert.equal(up.status, 201);
  assert.equal(up.body!.file!.label, 'Fiche technique béton ciré é');
  assert.equal(up.body!.file!.category, 'Fiche technique');
  assert.equal(up.body!.file!.size, '%PDF-1.4 contenu de test'.length);
  const list = await (await get(worker, `/api/worksites/${worksiteId}/files`)).json() as { items: { id: string }[] };
  assert.equal(list.items.length, 1, 'un ouvrier peut consulter la liste');
  const dl = await get(worker, up.body!.file!.downloadPath);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(await dl.text(), /contenu de test/);
});

test('seul le bureau dépose, renomme et supprime ; la suppression efface aussi le fichier du disque', async () => {
  const denied = await upload(worker, 'plan.pdf', 'x');
  assert.equal(denied.status, 403);
  const up = await upload(admin, 'plan-facade.pdf', 'plan', { category: 'Plan' });
  const id = up.body!.file!.id;
  const row = await prisma.worksiteFile.findUniqueOrThrow({ where: { id } });
  const disk = path.join(UPLOADS_DIR, row.fileUrl.replace(/^\/?uploads\//, ''));
  assert.ok(existsSync(disk));
  const rename = await fetch(`${base}/api/worksites/${worksiteId}/files/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` }, body: JSON.stringify({ label: 'Plan façade avant', category: 'Plan' }) });
  assert.equal(rename.status, 200);
  assert.equal(((await rename.json()) as { file: { label: string } }).file.label, 'Plan façade avant');
  assert.equal((await fetch(`${base}/api/worksites/${worksiteId}/files/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${worker}` } })).status, 403);
  assert.equal((await fetch(`${base}/api/worksites/${worksiteId}/files/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } })).status, 204);
  assert.equal(existsSync(disk), false, 'fichier effacé du disque');
  assert.equal(await prisma.worksiteFile.count({ where: { id } }), 0);
});

test('fichier trop lourd : message clair (413), type non accepté : 422, chantier inconnu : 404', async () => {
  const big = await upload(admin, 'gros.pdf', new Uint8Array(15 * 1024 * 1024));
  assert.equal(big.status, 413);
  assert.match(big.body!.error!, /trop lourd/i);
  const bad = await upload(admin, 'virus.exe', 'MZ');
  assert.equal(bad.status, 422);
  const none = await get(admin, '/api/worksites/inconnu/files');
  assert.equal(none.status, 404);
});
