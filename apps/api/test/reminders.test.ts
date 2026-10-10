import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { setMailTransportForTests } from '../src/lib/doc-mail.js';
import { UPLOADS_DIR } from '../src/lib/media.js';
import { computeProposals, runAutoReminders, saveReminderSettings, getReminderSettings, DEFAULT_REMINDER_SETTINGS } from '../src/lib/reminders.js';
import { getDocPdfBuffer } from '../src/routes/documents.js';

let server: Server; let base = ''; let token = '';
const sent: Record<string, unknown>[] = [];
const created = { docs: [] as string[], contacts: [] as string[] };
const PDF = 'test-reminders.pdf';
const DAY = 86_400_000;
const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const call = (p: string, method = 'GET', body?: object) => fetch(`${base}/api/reminders${p}`, { method, headers: auth(), body: body ? JSON.stringify(body) : undefined });

async function invoice(contactId: string, daysLate: number, o: { paid?: number; status?: string } = {}) {
  const d = await prisma.document.create({ data: {
    kind: 'invoice', direction: 'sale', number: `F9${Math.floor(Math.random() * 1e6)}`, status: o.status ?? 'overdue', title: 'Test relance', contactId, lockedAt: new Date(), issuedOn: new Date(Date.now() - (daysLate + 30) * DAY),
    dueOn: new Date(Date.now() - daysLate * DAY), totalHt: 1000, totalVat: 210, totalTtc: 1210, paidAmount: o.paid ?? 0, originalPdf: PDF, source: 'test-reminders',
  } });
  created.docs.push(d.id);
  return d;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  mkdirSync(path.join(UPLOADS_DIR, 'documents'), { recursive: true });
  writeFileSync(path.join(UPLOADS_DIR, 'documents', PDF), '%PDF-1.4 test');
  await prisma.setting.deleteMany({ where: { key: { in: ['reminders', 'reminders:lastRun'] } } });
});
function arm() {
  env.smtp.host = 'smtp.test'; env.smtp.user = 'info@jjd-consult.be'; env.smtp.password = 'x';
  setMailTransportForTests({ sendMail: async (opts: Record<string, unknown>) => { sent.push(opts); return {}; } } as never);
}
after(async () => {
  setMailTransportForTests(null); env.smtp.host = ''; env.smtp.user = ''; env.smtp.password = '';
  rmSync(path.join(UPLOADS_DIR, 'documents', PDF), { force: true });
  await prisma.auditLog.deleteMany({ where: { entity: 'document', entityId: { in: created.docs } } });
  await prisma.document.deleteMany({ where: { id: { in: created.docs } } });
  await prisma.contact.deleteMany({ where: { id: { in: created.contacts } } });
  await prisma.setting.deleteMany({ where: { key: { in: ['reminders', 'reminders:lastRun'] } } });
  server.close();
});

test('relances : étape selon le retard, facture soldée / client exclu / pas d’e-mail', async () => {
  const c = await prisma.contact.create({ data: { name: 'Client Relance SA', normalizedName: 'client relance sa', type: 'client', email: 'compta@client-relance.be' } });
  const noMail = await prisma.contact.create({ data: { name: 'Sans Mail SA', normalizedName: 'sans mail sa', type: 'client' } });
  const off = await prisma.contact.create({ data: { name: 'Ne Pas Relancer SA', normalizedName: 'ne pas relancer sa', type: 'client', reminderMode: 'off' } });
  created.contacts.push(c.id, noMail.id, off.id);
  const late10 = await invoice(c.id, 10);
  const late30 = await invoice(c.id, 30);
  const late60 = await invoice(c.id, 60);
  const early = await invoice(c.id, 3);
  const paid = await invoice(c.id, 40, { paid: 1210 });
  const tiny = await invoice(c.id, 40, { paid: 1200 });
  const excluded = await invoice(off.id, 40);
  const blocked = await invoice(noMail.id, 40);

  const props = await computeProposals();
  const by = (id: string) => props.find((p) => p.documentId === id);
  assert.equal(by(late10.id)?.step, 1);
  assert.equal(by(late30.id)?.step, 2);
  assert.equal(by(late60.id)?.step, 3);
  assert.ok(!by(early.id), 'pas encore à J+7');
  assert.ok(!by(paid.id) && !by(tiny.id), 'soldée ou reste négligeable');
  assert.ok(!by(excluded.id), 'client marqué « ne pas relancer »');
  assert.equal(by(blocked.id)?.blocked, 'Aucune adresse e-mail pour ce client');
  assert.match(by(late30.id)!.subject, /F9\d+/);
  assert.match(by(late30.id)!.body, /1\s?210,00/);
});

test('relance envoyée à la main : consignée, avec PDF ; plus proposée ensuite ; ignorer ; étape suivante plus tard', async () => {
  arm(); sent.length = 0;
  const c = await prisma.contact.create({ data: { name: 'Client Relance 2', normalizedName: 'client relance 2', type: 'client', email: 'x@relance2.be' } });
  created.contacts.push(c.id);
  const inv = await invoice(c.id, 25);
  const r = await call('/send', 'POST', { documentId: inv.id, step: 2, subject: 'Petit rappel', body: 'Bonjour, petit rappel.' });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.to, ['x@relance2.be']);
  assert.equal((sent[0]!.attachments as unknown[]).length, 1);
  const rec = await prisma.invoiceReminder.findUnique({ where: { documentId_step: { documentId: inv.id, step: 2 } } });
  assert.equal(rec?.status, 'sent');
  assert.ok(!(await computeProposals()).some((p) => p.documentId === inv.id), 'déjà relancée : pas deux fois, et 7 jours minimum entre deux relances');
  assert.equal((await call('/send', 'POST', { documentId: inv.id, step: 2 })).status, 409);
  const inv2 = await invoice(c.id, 25);
  assert.equal((await call('/skip', 'POST', { documentId: inv2.id, step: 2 })).status, 200);
  assert.ok(!(await computeProposals()).some((p) => p.documentId === inv2.id));
});

test('envoi automatique : seulement si activé, et une seule passe par jour', async () => {
  arm(); sent.length = 0;
  const c = await prisma.contact.create({ data: { name: 'Client Auto', normalizedName: 'client auto', type: 'client', email: 'auto@client.be' } });
  created.contacts.push(c.id);
  const inv = await invoice(c.id, 50);
  // mardi 14 h à Bruxelles
  const tuesday = new Date('2026-10-13T12:00:00Z');
  assert.equal(await runAutoReminders(getDocPdfBuffer, tuesday), 0, 'mode automatique désactivé par défaut');
  await saveReminderSettings({ ...(await getReminderSettings()), autoSend: true });
  assert.equal(await runAutoReminders(getDocPdfBuffer, new Date('2026-10-17T12:00:00Z')), 0, 'pas le week-end');
  const n = await runAutoReminders(getDocPdfBuffer, tuesday);
  assert.ok(n >= 1);
  const rec = await prisma.invoiceReminder.findFirst({ where: { documentId: inv.id } });
  assert.equal(rec?.auto, true);
  assert.equal(await runAutoReminders(getDocPdfBuffer, tuesday), 0, 'une seule passe par jour');
  await saveReminderSettings({ ...DEFAULT_REMINDER_SETTINGS });
});
