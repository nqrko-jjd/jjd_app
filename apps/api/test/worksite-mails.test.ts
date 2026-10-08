import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { inlineCidImages, sanitizeMailHtml, mailPlainText, mailSnippet } from '../src/lib/mail-render.js';
import { buildMailSnapshot, PRIVATE_DIR } from '../src/lib/worksite-mails.js';

let server: Server; let base = '';
let office = ''; let worker = '';
let wsId = '';
const login = async (email: string) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'jjd' }) })).json() as { token: string }).token;
const call = (token: string, method: string, url: string, body?: unknown) => fetch(`${base}${url}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  office = await login('melvina@jjd-consult.be');
  worker = await login('ouvrier@jjd-consult.be');
  wsId = (await prisma.worksite.create({ data: { ref: 'R-MAILS-T', title: 'Suivi mails test', source: 'test' } })).id;
});
after(async () => {
  await prisma.worksiteMail.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.delete({ where: { id: wsId } });
  server.close();
});

test('HTML de mail : scripts, gestionnaires, iframes, images distantes et liens javascript retirés ; mise en page et liens sûrs gardés', () => {
  const dirty = '<p style="color:#ff0000;position:fixed" onclick="x()">Bonjour <b>Phil</b></p><script>alert(1)</script><iframe src="https://evil"></iframe>'
    + '<img src="https://track.example/p.gif"><a href="javascript:alert(1)">piège</a><a href="https://ok.example/x">lien</a><table><tr><td>cellule</td></tr></table>'
    + '<img src="data:image/png;base64,AAAA" alt="logo">';
  const out = sanitizeMailHtml(dirty);
  assert.ok(!/script|iframe|onclick|javascript:|track\.example|position/i.test(out), out);
  assert.ok(out.includes('color:#ff0000') && out.includes('<b>Phil</b>') && out.includes('<td>cellule</td>') && out.includes('data:image/png;base64,AAAA'));
  assert.match(out, /<a href="https:\/\/ok\.example\/x" target="_blank" rel="noopener noreferrer">lien<\/a>/);
});

test('images incorporées (cid:) reprises en place ; trop grosses ou inconnues laissées', () => {
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const html = inlineCidImages('<img src="cid:logo123"><img src="cid:inconnu">', [{ cid: '<logo123>', contentType: 'image/png', content: png }]);
  assert.ok(html.includes('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(html.includes('cid:inconnu'));
  assert.ok(!sanitizeMailHtml(html).includes('cid:'));
});

test('texte brut et aperçu : HTML aplati, citations ignorées', () => {
  assert.equal(mailPlainText('Salut\r\nà tous', null), 'Salut\nà tous');
  assert.match(mailPlainText('', '<p>Bonjour&nbsp;<b>toi</b></p><script>x</script>'), /^Bonjour\s+toi/);
  assert.equal(mailSnippet('> ancien message\nMerci de rappeler Mr Dumont\n\nCordialement'), 'Merci de rappeler Mr Dumont Cordialement');
});

test('copie d’un mail : pièces jointes rangées dans le dossier privé, image du corps non comptée comme pièce jointe', () => {
  const snap = buildMailSnapshot({
    subject: 'Fuite', from: { text: 'Syndic <s@baltimo.be>' }, to: { text: 'info@jjd-consult.be' }, date: new Date('2026-10-08T08:00:00Z'), text: 'Voir plan', html: '<p>Voir plan <img src="cid:i1"></p>',
    attachments: [
      { filename: 'plan.pdf', contentType: 'application/pdf', size: 5, content: Buffer.from('%PDF-'), contentDisposition: 'attachment' },
      { filename: 'logo.png', contentType: 'image/png', size: 4, content: Buffer.from([1, 2, 3, 4]), contentId: '<i1>', contentDisposition: 'inline' },
    ],
  } as never);
  assert.equal(snap.attachments.length, 1);
  assert.equal(snap.attachments[0]!.filename, 'plan.pdf');
  assert.ok(existsSync(path.join(PRIVATE_DIR, snap.attachments[0]!.file!)));
  assert.ok(snap.bodyHtml!.includes('data:image/png;base64,'));
});

test('suivi mails : réservé au bureau (un ouvrier n’y accède pas), note créée / lue / modifiée / supprimée', async () => {
  assert.equal((await call(worker, 'GET', `/api/worksites/${wsId}/mails`)).status, 403);
  assert.equal((await call(worker, 'POST', `/api/worksites/${wsId}/mails`, { note: 'x' })).status, 403);
  assert.equal((await fetch(`${base}/api/worksites/${wsId}/mails`)).status, 401);

  const created = await call(office, 'POST', `/api/worksites/${wsId}/mails`, { note: 'Rappeler le syndic jeudi', subject: 'Appel syndic' });
  assert.equal(created.status, 201);
  const { id } = await created.json() as { id: string };
  const list = await (await call(office, 'GET', `/api/worksites/${wsId}/mails`)).json() as { items: { id: string; kind: string; snippet: string }[] };
  assert.equal(list.items.length, 1); assert.equal(list.items[0]!.kind, 'note'); assert.match(list.items[0]!.snippet, /Rappeler le syndic/);

  assert.equal((await call(office, 'PATCH', `/api/worksites/${wsId}/mails/${id}`, { note: '' })).status, 422); // une note ne devient pas vide
  assert.equal((await call(office, 'PATCH', `/api/worksites/${wsId}/mails/${id}`, { note: 'Rappelé, RDV vendredi' })).status, 200);
  const one = await (await call(office, 'GET', `/api/worksites/${wsId}/mails/${id}`)).json() as { note: string };
  assert.equal(one.note, 'Rappelé, RDV vendredi');
  assert.equal((await call(office, 'DELETE', `/api/worksites/${wsId}/mails/${id}`)).status, 200);
  assert.equal((await call(office, 'GET', `/api/worksites/${wsId}/mails/${id}`)).status, 404);
});

test('pièces jointes : téléchargement authentifié, PDF affichable, HTML forcé en téléchargement, chemin hors dossier refusé, dossier privé non servi en statique', async () => {
  const dir = path.join(PRIVATE_DIR, 'worksite-mails', 'test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'a.pdf'), '%PDF-1.4 test');
  writeFileSync(path.join(dir, 'b.html'), '<script>alert(1)</script>');
  const m = await prisma.worksiteMail.create({
    data: {
      worksiteId: wsId, kind: 'mail', subject: 'Plans', bodyText: 'ci-joint',
      attachments: [
        { filename: 'plan.pdf', contentType: 'application/pdf', size: 13, file: 'worksite-mails/test/a.pdf' },
        { filename: 'page.html', contentType: 'text/html', size: 25, file: 'worksite-mails/test/b.html' },
        { filename: 'evil', contentType: 'application/pdf', size: 1, file: '../../../package.json' },
        { filename: 'gros.zip', contentType: 'application/zip', size: 99999999, skipped: 'trop volumineuse (plus de 25 Mo)' },
      ] as never,
    },
  });
  const url = (i: number) => `/api/worksites/${wsId}/mails/${m.id}/attachments/${i}`;
  assert.equal((await fetch(`${base}${url(0)}`)).status, 401);
  assert.equal((await call(worker, 'GET', url(0))).status, 403);
  const pdf = await call(office, 'GET', url(0));
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(pdf.headers.get('content-disposition') ?? '', /^inline/);
  const html = await call(office, 'GET', url(1));
  assert.equal(html.headers.get('content-type'), 'application/octet-stream'); assert.match(html.headers.get('content-disposition') ?? '', /^attachment/);
  assert.equal((await call(office, 'GET', url(2))).status, 404);
  assert.equal((await call(office, 'GET', url(3))).status, 404);
  assert.equal((await fetch(`${base}/uploads/_private/worksite-mails/test/a.pdf`)).status, 404);
  const detail = await (await call(office, 'GET', `/api/worksites/${wsId}/mails/${m.id}`)).json() as { attachments: { index: number; available: boolean; skipped: string | null }[] };
  assert.equal(detail.attachments.length, 4); assert.equal(detail.attachments[3]!.available, false); assert.match(detail.attachments[3]!.skipped ?? '', /25 Mo/);
});
