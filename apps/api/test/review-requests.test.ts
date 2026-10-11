import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { setMailTransportForTests } from '../src/lib/doc-mail.js';
import { computeReviewProposals, saveReviewSettings, getReviewSettings, sendReviewRequest, skipReviewRequest, runAutoReviewRequests, DEFAULT_REVIEW_SETTINGS } from '../src/lib/review-requests.js';

const sent: Record<string, unknown>[] = [];
const created = { docs: [] as string[], contacts: [] as string[] };
const DAY = 86_400_000;
const URL_AVIS = 'https://g.page/r/test-jjd/review';

async function paidInvoice(contactId: string, paidDaysAgo: number, o: { total?: number; kind?: string } = {}) {
  const d = await prisma.document.create({ data: {
    kind: o.kind ?? 'invoice', direction: 'sale', number: `F8${Math.floor(Math.random() * 1e6)}`, status: 'paid', title: 'Test avis', contactId, lockedAt: new Date(), issuedOn: new Date(Date.now() - (paidDaysAgo + 20) * DAY),
    paidOn: new Date(Date.now() - paidDaysAgo * DAY), totalHt: 2000, totalVat: 420, totalTtc: o.total ?? 2420, paidAmount: o.total ?? 2420, source: 'test-review',
  } });
  created.docs.push(d.id);
  return d;
}
function arm() {
  env.smtp.host = 'smtp.test'; env.smtp.user = 'info@jjd-consult.be'; env.smtp.password = 'x';
  setMailTransportForTests({ sendMail: async (opts: Record<string, unknown>) => { sent.push(opts); return {}; } } as never);
}
before(async () => { await prisma.setting.deleteMany({ where: { key: { in: ['reviewRequests', 'reviewRequests:lastRun'] } } }); });
after(async () => {
  setMailTransportForTests(null); env.smtp.host = ''; env.smtp.user = ''; env.smtp.password = '';
  await prisma.reviewRequest.deleteMany({ where: { documentId: { in: created.docs } } });
  await prisma.auditLog.deleteMany({ where: { entity: 'document', entityId: { in: created.docs } } });
  await prisma.document.deleteMany({ where: { id: { in: created.docs } } });
  await prisma.contact.deleteMany({ where: { id: { in: created.contacts } } });
  await prisma.setting.deleteMany({ where: { key: { in: ['reviewRequests', 'reviewRequests:lastRun'] } } });
});

test('demande d’avis : délai, montant, client exclu, note de crédit, un seul envoi par client', async () => {
  await saveReviewSettings({ ...DEFAULT_REVIEW_SETTINGS, reviewUrl: URL_AVIS });
  const c = await prisma.contact.create({ data: { name: 'Client Avis SA', normalizedName: 'client avis sa', type: 'client', email: 'avis@client.be' } });
  const off = await prisma.contact.create({ data: { name: 'Client Off SA', normalizedName: 'client off sa', type: 'client', email: 'off@client.be', reminderMode: 'off' } });
  const cn = await prisma.contact.create({ data: { name: 'Client Credit SA', normalizedName: 'client credit sa', type: 'client', email: 'cn@client.be' } });
  const small = await prisma.contact.create({ data: { name: 'Petit Client', normalizedName: 'petit client', type: 'client', email: 'p@client.be' } });
  const fresh = await prisma.contact.create({ data: { name: 'Client Tout Frais', normalizedName: 'client tout frais', type: 'client', email: 'f@client.be' } });
  const old = await prisma.contact.create({ data: { name: 'Client Ancien', normalizedName: 'client ancien', type: 'client', email: 'o@client.be' } });
  created.contacts.push(c.id, off.id, cn.id, small.id, fresh.id, old.id);

  const ok = await paidInvoice(c.id, 5);
  const dup = await paidInvoice(c.id, 8); // même client : une seule proposition
  const excluded = await paidInvoice(off.id, 5);
  const credited = await paidInvoice(cn.id, 5);
  await prisma.document.create({ data: { kind: 'credit_note', direction: 'sale', number: `NC8${Math.floor(Math.random() * 1e6)}`, status: 'sent', title: 'NC', contactId: cn.id, parentId: credited.id, totalHt: -100, totalVat: -21, totalTtc: -121, source: 'test-review' } }).then((d) => created.docs.push(d.id));
  const tiny = await paidInvoice(small.id, 5, { total: 200 });
  const tooFresh = await paidInvoice(fresh.id, 1);
  const tooOld = await paidInvoice(old.id, 60);

  const props = await computeReviewProposals();
  const ids = props.map((p) => p.documentId);
  assert.ok(ids.includes(ok.id), 'facture payée depuis 5 j : proposée');
  assert.ok(!ids.includes(dup.id), 'une seule demande par client');
  for (const d of [excluded, credited, tiny, tooFresh, tooOld]) assert.ok(!ids.includes(d.id), `exclue : ${d.id}`);
  const p = props.find((x) => x.documentId === ok.id)!;
  assert.ok(p.body.includes(URL_AVIS) && !p.blocked);
});

test('demande d’avis : envoi, une seule fois par client, « ne pas demander », envoi auto', async () => {
  arm(); sent.length = 0;
  const c = await prisma.contact.create({ data: { name: 'Client Envoi Avis', normalizedName: 'client envoi avis', type: 'client', email: 'envoi@client.be' } });
  const c2 = await prisma.contact.create({ data: { name: 'Client Skip Avis', normalizedName: 'client skip avis', type: 'client', email: 'skip@client.be' } });
  created.contacts.push(c.id, c2.id);
  const d1 = await paidInvoice(c.id, 5);
  const d2 = await paidInvoice(c.id, 10);
  const d3 = await paidInvoice(c2.id, 5);

  await assert.rejects(() => sendReviewRequest(d1.id, { body: 'Bonjour sans lien' }), /lien/);
  assert.equal(sent.length, 0);
  await sendReviewRequest(d1.id, {});
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { to: string[] }).to[0], 'envoi@client.be');
  assert.equal(sent[0]!.attachments, undefined, 'aucune pièce jointe');
  const after = (await computeReviewProposals()).map((p) => p.documentId);
  assert.ok(!after.includes(d1.id) && !after.includes(d2.id), 'client déjà sollicité : plus de proposition');
  await assert.rejects(() => sendReviewRequest(d2.id, {}), /plus à faire/);

  await skipReviewRequest(d3.id, null);
  assert.ok(!(await computeReviewProposals()).some((p) => p.documentId === d3.id));

  // auto : désactivé par défaut
  assert.equal(await runAutoReviewRequests(new Date('2026-10-12T09:00:00+02:00')), 0);
  const s = await getReviewSettings();
  await assert.rejects(() => saveReviewSettings({ ...s, reviewUrl: '', autoSend: true }), /lien/);
});
