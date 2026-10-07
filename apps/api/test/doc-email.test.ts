import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { UPLOADS_DIR } from '../src/lib/media.js';
import { setMailTransportForTests } from '../src/lib/doc-mail.js';

let server: Server; let base = ''; let token = '';
const ids: { ws?: string; contact?: string; docs: string[] } = { docs: [] };
const sent: Record<string, unknown>[] = [];
let failSmtp = false;
const PDF_NAME = 'test-doc-email.pdf';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  mkdirSync(path.join(UPLOADS_DIR, 'documents'), { recursive: true });
  writeFileSync(path.join(UPLOADS_DIR, 'documents', PDF_NAME), '%PDF-1.4 test');
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-MAILTEST', title: 'Mail test', source: 'test' } })).id;
  ids.contact = (await prisma.contact.create({ data: { name: 'Client Mail SA', normalizedName: 'client mail sa', type: 'client', email: 'client@exemple.be' } })).id;
  setMailTransportForTests({ sendMail: async (opts: Record<string, unknown>) => { if (failSmtp) throw new Error('535 authentification refusée'); sent.push(opts); return {}; } } as never);
});
after(async () => {
  setMailTransportForTests(null);
  env.smtp.host = ''; env.smtp.user = ''; env.smtp.password = '';
  rmSync(path.join(UPLOADS_DIR, 'documents', PDF_NAME), { force: true });
  await prisma.auditLog.deleteMany({ where: { entity: 'document', entityId: { in: ids.docs } } });
  await prisma.document.deleteMany({ where: { id: { in: ids.docs } } });
  await prisma.contact.deleteMany({ where: { id: ids.contact } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
async function mkDoc(number: string, opts: { locked?: boolean; kind?: string } = {}) {
  const d = await prisma.document.create({ data: { kind: opts.kind ?? 'invoice', direction: 'sale', number, status: 'draft', worksiteId: ids.ws, contactId: ids.contact, totalHt: 100, totalVat: 21, totalTtc: 121, issuedOn: new Date('2026-10-01'), dueOn: new Date('2026-10-31'), lockedAt: opts.locked === false ? null : new Date('2026-10-01'), originalPdf: PDF_NAME, source: 'test' } });
  ids.docs.push(d.id);
  return d.id;
}

test('e-mail : sans identifiants SMTP -> 503, rien d’enregistré', async () => {
  const id = await mkDoc('FM-1');
  const r = await call('POST', `/api/documents/${id}/email`, { to: ['client@exemple.be'], subject: 'S', message: 'M' });
  assert.equal(r.status, 503);
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.sentAt, null);
  assert.equal((await call('GET', '/api/settings/email')).body.enabled, false);
});

test('e-mail : proposition par défaut, validations, échec SMTP sans marquage, puis envoi réel avec PDF joint', async () => {
  env.smtp.host = 'smtp.test'; env.smtp.user = 'info@jjd-consult.be'; env.smtp.password = 'x';
  assert.equal((await call('GET', '/api/settings/email')).body.enabled, true);
  const id = await mkDoc('FM-2');

  const def = (await call('GET', `/api/documents/${id}/email/defaults`)).body;
  assert.equal(def.to, 'client@exemple.be'); assert.match(def.subject, /FM-2/); assert.match(def.message, /121,00/); assert.match(def.message, /Échéance/);

  assert.equal((await call('POST', `/api/documents/${id}/email`, { to: ['pas-un-mail'], subject: 'S', message: 'M' })).status, 422);
  assert.equal((await call('POST', `/api/documents/${id}/email`, { to: [], subject: 'S', message: 'M' })).status, 422);
  const draft = await mkDoc('FM-3', { locked: false });
  assert.equal((await call('POST', `/api/documents/${draft}/email`, { to: ['client@exemple.be'], subject: 'S', message: 'M' })).status, 409, 'document non émis');

  failSmtp = true;
  const failed = await call('POST', `/api/documents/${id}/email`, { to: ['client@exemple.be'], subject: 'S', message: 'M' });
  assert.equal(failed.status, 502);
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.sentAt, null, 'échec SMTP : pas marqué envoyé');
  failSmtp = false;

  const ok = await call('POST', `/api/documents/${id}/email`, { to: ['client@exemple.be', 'compta@exemple.be'], subject: 'Facture FM-2', message: 'Bonjour', copyToSelf: true });
  assert.equal(ok.status, 200);
  const mail = sent.at(-1) as { to: string[]; bcc?: string; subject: string; attachments: { filename: string; content: Buffer }[] };
  assert.deepEqual(mail.to, ['client@exemple.be', 'compta@exemple.be']);
  assert.match(String(mail.bcc), /info@jjd-consult\.be/);
  assert.equal(mail.attachments[0]!.filename, 'FM-2.pdf'); assert.match(mail.attachments[0]!.content.toString(), /%PDF/);
  const doc = await prisma.document.findUnique({ where: { id } });
  assert.ok(doc?.sentAt); assert.equal(doc?.status, 'sent');

  // renvoi : autorisé, ne change pas la date d'envoi déjà enregistrée
  const firstSent = doc!.sentAt!.getTime();
  assert.equal((await call('POST', `/api/documents/${id}/email`, { to: ['client@exemple.be'], subject: 'Rappel', message: 'Bonjour', copyToSelf: false })).status, 200);
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.sentAt?.getTime(), firstSent);
  assert.equal((sent.at(-1) as { bcc?: string }).bcc, undefined);
});

test('e-mail : un devis émis peut aussi être envoyé', async () => {
  const id = await mkDoc('DM-1', { kind: 'quote' });
  const r = await call('POST', `/api/documents/${id}/email`, { to: ['client@exemple.be'], subject: 'Devis', message: 'Bonjour' });
  assert.equal(r.status, 200);
  const def = (await call('GET', `/api/documents/${id}/email/defaults`)).body;
  assert.match(def.message, /Bon pour accord/);
});
