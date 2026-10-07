import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { UPLOADS_DIR } from '../src/lib/media.js';
import { setMailTransportForTests } from '../src/lib/doc-mail.js';

let server: Server; let base = ''; let token = '';
const ids: { ws?: string; contact?: string; docs: string[] } = { docs: [] };
const mails: { to: string[]; subject: string; text: string; attachments?: { filename: string }[] }[] = [];
let failSmtp = false;
const PDF_NAME = 'test-quote-sign.pdf';
const PDF_BYTES = Buffer.from('%PDF-1.4 devis de test à signer');

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  mkdirSync(path.join(UPLOADS_DIR, 'documents'), { recursive: true });
  writeFileSync(path.join(UPLOADS_DIR, 'documents', PDF_NAME), PDF_BYTES);
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-SIGNTEST', title: 'Signature test', source: 'test' } })).id;
  ids.contact = (await prisma.contact.create({ data: { name: 'Client Signature', normalizedName: 'client signature', type: 'client', email: 'client@exemple.be' } })).id;
});
// la suite complète tourne en un seul processus : chaque test pose lui-même son état SMTP (jamais dans before)
function arm() {
  env.smtp.host = 'smtp.test'; env.smtp.user = 'info@jjd-consult.be'; env.smtp.password = 'x';
  setMailTransportForTests({ sendMail: async (o: Record<string, unknown>) => { if (failSmtp) throw new Error('421 indisponible'); mails.push({ to: o.to as string[], subject: String(o.subject), text: String(o.text), attachments: o.attachments as { filename: string }[] | undefined }); return {}; } } as never);
}
after(async () => {
  setMailTransportForTests(null);
  env.smtp.host = ''; env.smtp.user = ''; env.smtp.password = '';
  rmSync(path.join(UPLOADS_DIR, 'documents', PDF_NAME), { force: true });
  const sigs = await prisma.quoteSignature.findMany({ where: { documentId: { in: ids.docs } } });
  for (const s of sigs) rmSync(path.join(UPLOADS_DIR, 'signatures', s.pdfFile), { force: true });
  await prisma.quoteSignature.deleteMany({ where: { documentId: { in: ids.docs } } });
  await prisma.auditLog.deleteMany({ where: { entity: 'document', entityId: { in: ids.docs } } });
  await prisma.document.deleteMany({ where: { id: { in: ids.docs } } });
  await prisma.contact.deleteMany({ where: { id: ids.contact } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});
const call = async (method: string, p: string, body?: unknown, auth = true) => {
  const r = await fetch(base + p, { method, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any, raw: r }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
async function mkDoc(number: string, kind = 'quote') {
  const d = await prisma.document.create({ data: { kind, direction: 'sale', number, status: 'sent', worksiteId: ids.ws, contactId: ids.contact, totalHt: 1000, totalVat: 210, totalTtc: 1210, issuedOn: new Date(), lockedAt: new Date(), originalPdf: PDF_NAME, source: 'test' } });
  ids.docs.push(d.id);
  return d.id;
}
const tokenFromMail = () => /\/signer\/([A-Za-z0-9_-]{20,})/.exec(mails.at(-1)!.text)![1]!;
const send = (id: string, extra: object = {}) => call('POST', `/api/documents/${id}/email`, { to: ['client@exemple.be'], subject: 'Devis', message: 'Bonjour', copyToSelf: false, ...extra });

test('signature : l’envoi avec « signer en ligne » ajoute un lien, fige le PDF et le client peut le lire', async () => {
  arm();
  const id = await mkDoc('DSIGN-1');
  const r = await send(id, { sign: true });
  assert.equal(r.status, 200); assert.match(r.body.note, /signature en ligne/);
  const t = tokenFromMail();
  assert.match(mails.at(-1)!.text, /Pour accepter et signer ce devis en ligne/);
  const sig = await prisma.quoteSignature.findFirst({ where: { documentId: id } });
  assert.equal(sig?.status, 'pending'); assert.equal(sig?.pdfHash, createHash('sha256').update(PDF_BYTES).digest('hex'));
  assert.ok(readdirSync(path.join(UPLOADS_DIR, 'signatures')).includes(sig!.pdfFile));

  const view = await call('GET', `/api/public/sign/${t}`, undefined, false);
  assert.equal(view.status, 200); assert.equal(view.body.status, 'pending'); assert.equal(view.body.document.number, 'DSIGN-1'); assert.equal(view.body.document.totalTtc, 1210);
  const pdf = await fetch(`${base}/api/public/sign/${t}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), PDF_BYTES);
  assert.equal((await call('GET', '/api/public/sign/jetoninconnujetoninconnu', undefined, false)).status, 404);

  // le devis modifié ensuite ne change pas ce que le client signe : le PDF servi est la copie figée
  const staff = await call('GET', `/api/quote-sign/document/${id}`);
  assert.equal(staff.body.signature.status, 'pending'); assert.match(staff.body.signature.url, /\/signer\//);
});

test('signature : refus sans case ni nom, puis signature valide, double signature refusée, confirmation par e-mail', async () => {
  arm();
  const id = await mkDoc('DSIGN-2');
  await send(id, { sign: true });
  const t = tokenFromMail();
  assert.equal((await call('POST', `/api/public/sign/${t}/sign`, { name: 'Jean Dupont', accepted: false }, false)).status, 422);
  assert.equal((await call('POST', `/api/public/sign/${t}/sign`, { name: 'Jd', accepted: true }, false)).status, 422);
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.status, 'sent', 'rien ne change sans signature valide');

  const before = mails.length;
  const ok = await call('POST', `/api/public/sign/${t}/sign`, { name: '  Jean   Dupont ', accepted: true }, false);
  assert.equal(ok.status, 200); assert.equal(ok.body.signerName, 'Jean Dupont');
  const doc = await prisma.document.findUnique({ where: { id } });
  assert.equal(doc?.status, 'accepted'); assert.ok(doc?.acceptedOn);
  const sig = await prisma.quoteSignature.findFirst({ where: { documentId: id } });
  assert.equal(sig?.status, 'signed'); assert.equal(sig?.signerName, 'Jean Dupont'); assert.ok(sig?.signedAt); assert.ok(sig?.signerIp);
  const sentMails = mails.slice(before);
  assert.ok(sentMails.some((m) => m.to.includes('client@exemple.be') && /signé/.test(m.subject) && m.attachments?.[0]?.filename === 'DSIGN-2.pdf'), 'confirmation au client avec le PDF signé');
  assert.ok(sentMails.some((m) => /signé par Jean Dupont/.test(m.subject)), 'alerte à JJD');

  assert.equal((await call('POST', `/api/public/sign/${t}/sign`, { name: 'Autre Personne', accepted: true }, false)).status, 409);
  assert.equal((await call('POST', `/api/public/sign/${t}/decline`, { comment: 'finalement non' }, false)).status, 409);
  assert.equal((await call('GET', `/api/public/sign/${t}`, undefined, false)).body.status, 'signed');
  assert.equal((await call('GET', `/api/quote-sign/document/${id}`)).body.signature.signerName, 'Jean Dupont');
});

test('signature : refus par le client (devis « refusé » avec son commentaire), expiration, annulation par JJD', async () => {
  arm();
  const dec = await mkDoc('DSIGN-3');
  await send(dec, { sign: true });
  const t1 = tokenFromMail();
  assert.equal((await call('POST', `/api/public/sign/${t1}/decline`, { comment: 'Trop cher' }, false)).status, 200);
  const d = await prisma.document.findUnique({ where: { id: dec } });
  assert.equal(d?.status, 'declined'); assert.equal(d?.declinedReason, 'Trop cher');

  const exp = await mkDoc('DSIGN-4');
  await send(exp, { sign: true });
  const t2 = tokenFromMail();
  await prisma.quoteSignature.updateMany({ where: { documentId: exp }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', `/api/public/sign/${t2}`, undefined, false)).body.status, 'expired');
  assert.equal((await call('POST', `/api/public/sign/${t2}/sign`, { name: 'Jean Dupont', accepted: true }, false)).status, 410);
  assert.equal((await prisma.document.findUnique({ where: { id: exp } }))?.status, 'sent');

  const rev = await mkDoc('DSIGN-5');
  await send(rev, { sign: true });
  const t3 = tokenFromMail();
  const sigId = (await prisma.quoteSignature.findFirst({ where: { documentId: rev } }))!.id;
  assert.equal((await call('POST', `/api/quote-sign/${sigId}/revoke`, {})).status, 200);
  assert.equal((await call('GET', `/api/public/sign/${t3}`, undefined, false)).status, 404);
  // un nouvel envoi remplace le lien précédent
  await send(rev, { sign: true });
  const t4 = tokenFromMail();
  assert.notEqual(t3, t4);
  assert.equal((await call('GET', `/api/public/sign/${t4}`, undefined, false)).status, 200);
  await send(rev, { sign: true });
  assert.equal((await call('GET', `/api/public/sign/${t4}`, undefined, false)).status, 404, 'l’ancien lien est annulé par le nouvel envoi');
});

test('signature : e-mail refusé -> le lien est annulé ; facture et devis déjà accepté -> refus', async () => {
  arm();
  const id = await mkDoc('DSIGN-6');
  failSmtp = true;
  assert.equal((await send(id, { sign: true })).status, 502);
  failSmtp = false;
  const sig = await prisma.quoteSignature.findFirst({ where: { documentId: id } });
  assert.equal(sig?.status, 'revoked', 'lien orphelin annulé');
  assert.equal((await call('GET', `/api/public/sign/${sig!.token}`, undefined, false)).status, 404);

  const inv = await mkDoc('FSIGN-1', 'invoice');
  assert.equal((await send(inv, { sign: true })).status, 422);

  const acc = await mkDoc('DSIGN-7');
  await prisma.document.update({ where: { id: acc }, data: { status: 'accepted' } });
  assert.equal((await send(acc, { sign: true })).status, 409);
  assert.equal(readFileSync(path.join(UPLOADS_DIR, 'documents', PDF_NAME)).length, PDF_BYTES.length);
});
