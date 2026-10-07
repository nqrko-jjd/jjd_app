import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { peppolAddressFromVat, splitAddress, peppolLines, buildPeppolPayload } from '../src/lib/peppol.js';

const L = (o: Partial<{ label: string; qty: number; unitPriceHt: number; discountPct: number; vatRate: number }> = {}) => ({ kind: 'item', label: 'Pose <b>carrelage</b>', qty: 2, unitPriceHt: 100, discountPct: 0, vatRate: 0.06, ...o });
const baseDoc = (lines = [L()], extra: object = {}) => ({
  kind: 'invoice', number: 'F2026-900', issuedOn: new Date('2026-10-01'), dueOn: new Date('2026-10-31'), structuredComm: '+++123/4567/89012+++', customerRef: 'BC-7',
  billingName: null, billingVat: null, billingAddress: null, totalTtc: 212,
  contact: { name: 'ACP Test', vat: 'BE 1003.823.997', address: 'Rue du Pont 12', box: '3', postalCode: '1000', city: 'Bruxelles' }, worksite: { ref: 'R-1' }, lines, ...extra,
});

test('adresse Peppol belge depuis le numéro de TVA ; étranger ou invalide -> null', () => {
  assert.equal(peppolAddressFromVat('BE 1003.823.997'), '0208:1003823997');
  assert.equal(peppolAddressFromVat('be0123456789'), '0208:0123456789');
  assert.equal(peppolAddressFromVat('BE123456789'), '0208:0123456789'); // ancien format à 9 chiffres
  assert.equal(peppolAddressFromVat('FR12345678901'), null);
  assert.equal(peppolAddressFromVat('BE12'), null);
  assert.equal(peppolAddressFromVat(null), null);
});

test('adresse libre découpée en rue / code postal / ville', () => {
  assert.deepEqual(splitAddress('Rue des Déportés 22, 1332 Rixensart'), { street: 'Rue des Déportés 22', postalZone: '1332', city: 'Rixensart' });
  assert.equal(splitAddress('quelque part'), null);
});

test('lignes Peppol : prix net après remise ; arrondi impossible -> 1 × total ; TVA 0 % = autoliquidation', () => {
  const [a, b, c] = peppolLines({ lines: [L({ qty: 3, unitPriceHt: 10, discountPct: 10 }), L({ qty: 3, unitPriceHt: 33.33, discountPct: 7 }), L({ vatRate: 0 })] });
  assert.equal(a!.quantity, '3.00'); assert.equal(a!.netPriceAmount, '9.00'); assert.equal(a!.vat.percentage, '6.00'); assert.equal(a!.name, 'Pose carrelage');
  assert.equal(b!.quantity, '1.00'); assert.equal(b!.netPriceAmount, '92.99'); assert.match(b!.name, /\(3 × 33.33 €\)/); // l'arrondi unitaire ne retombe pas sur le total de la ligne
  assert.equal(c!.vat.category, 'AE');
});

test('charge utile : facture et note de crédit ; refus clair si TVA, adresse ou totaux manquants', () => {
  const p = buildPeppolPayload(baseDoc(), { iban: 'BE68 5390 0754 7034' });
  assert.equal(p.recipient, '0208:1003823997'); assert.equal(p.documentType, 'invoice');
  const doc = p.document as { invoiceNumber: string; dueDate: string; buyer: { vatNumber: string; street: string }; paymentMeans: { iban: string; reference: string }[]; note: string };
  assert.equal(doc.invoiceNumber, 'F2026-900'); assert.equal(doc.dueDate, '2026-10-31'); assert.equal(doc.buyer.vatNumber, 'BE1003823997'); assert.equal(doc.buyer.street, 'Rue du Pont 12 bte 3');
  assert.equal(doc.paymentMeans[0]!.iban, 'BE68539007547034'); assert.equal(doc.paymentMeans[0]!.reference, '+++123/4567/89012+++'); assert.match(doc.note, /BC-7/);
  assert.equal(buildPeppolPayload(baseDoc([L()], { kind: 'credit_note', number: 'NC2026-1' }), { iban: '' }).documentType, 'creditNote');
  assert.throws(() => buildPeppolPayload(baseDoc([L()], { contact: { name: 'Mme X', vat: null, address: null, box: null, postalCode: null, city: null } }), { iban: '' }), { status: 422, message: /TVA du client manquant/ });
  assert.throws(() => buildPeppolPayload(baseDoc([L()], { contact: { name: 'X', vat: 'BE0123456789', address: null, box: null, postalCode: null, city: null } }), { iban: '' }), { status: 422, message: /Adresse du client incomplète/ });
  assert.throws(() => buildPeppolPayload(baseDoc([L()], { totalTtc: 999 }), { iban: '' }), { status: 422, message: /Totaux incohérents/ });
});

let server: Server; let base = ''; let token = '';
const real = globalThis.fetch;
let verifyValid = true; let sendResponse: { status: number; json: unknown } = { status: 200, json: { success: true, id: 'doc_TEST1', deliveryStatus: 'pending' } }; let docStatus = 'pending';
const calls: string[] = [];
const ids: { ws?: string; contact?: string; docs: string[] } = { docs: [] };
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await real(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes('recommand.test')) return real(url as string, init);
    calls.push(`${init?.method} ${u.replace('https://recommand.test/api/v1', '')}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/verify')) return json(200, { isValid: verifyValid });
    if (u.endsWith('/send')) return json(sendResponse.status, sendResponse.json);
    if (u.includes('/documents/')) return json(200, { success: true, document: { id: 'doc_TEST1', deliveryStatus: docStatus } });
    return json(404, {});
  });
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-PEPPOL', title: 'Peppol test', source: 'test' } })).id;
  ids.contact = (await prisma.contact.create({ data: { name: 'Client Peppol SA', normalizedName: 'client peppol sa', type: 'client', vat: 'BE0123456789', address: 'Rue du Test 1', postalCode: '1000', city: 'Bruxelles' } })).id;
});
after(async () => {
  mock.restoreAll();
  env.peppol.apiKey = ''; env.peppol.apiSecret = ''; env.peppol.companyId = '';
  await prisma.auditLog.deleteMany({ where: { entity: 'document', entityId: { in: ids.docs } } });
  await prisma.documentLine.deleteMany({ where: { documentId: { in: ids.docs } } });
  await prisma.document.deleteMany({ where: { id: { in: ids.docs } } });
  await prisma.contact.deleteMany({ where: { id: ids.contact } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});
const post = async (path: string, body: unknown = {}) => {
  const r = await real(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
async function mkInvoice(number: string) {
  const d = await prisma.document.create({ data: { kind: 'invoice', direction: 'sale', number, status: 'draft', worksiteId: ids.ws, contactId: ids.contact, totalHt: 200, totalVat: 12, totalTtc: 212, issuedOn: new Date('2026-10-01'), dueOn: new Date('2026-10-31'), lockedAt: new Date('2026-10-01'), source: 'test' } });
  await prisma.documentLine.create({ data: { documentId: d.id, position: 0, kind: 'item', label: 'Travaux', qty: 2, unit: 'u', unitPriceHt: 100, vatRate: 0.06, totalHt: 200 } });
  ids.docs.push(d.id);
  return d.id;
}

test('Peppol : sans clé configurée -> 503 et rien n’est marqué envoyé', async () => {
  const id = await mkInvoice('FP-1');
  const r = await post(`/api/documents/${id}/send`, { peppol: true });
  assert.equal(r.status, 503);
  const d = await prisma.document.findUnique({ where: { id } });
  assert.equal(d?.sentAt, null); assert.equal(d?.peppolId, null);
});

test('Peppol : client non joignable, refus du point d’accès, puis envoi réussi, double envoi refusé, statut livré', async () => {
  env.peppol.apiKey = 'k'; env.peppol.apiSecret = 's'; env.peppol.companyId = 'cmp_1'; env.peppol.baseUrl = 'https://recommand.test/api/v1';
  const id = await mkInvoice('FP-2');

  verifyValid = false;
  assert.equal((await post(`/api/documents/${id}/send`, { peppol: true })).status, 422);
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.sentAt, null, 'client injoignable : rien d’enregistré');

  verifyValid = true; sendResponse = { status: 400, json: { success: false, errors: { 'document.buyer.vatNumber': ['Required'] } } };
  const refused = await post(`/api/documents/${id}/send`, { peppol: true });
  assert.equal(refused.status, 422); assert.match(JSON.stringify(refused.body), /refusé/);
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.peppolId, null, 'refus : rien d’enregistré');

  sendResponse = { status: 200, json: { success: true, id: 'doc_TEST1', deliveryStatus: 'pending' } };
  const ok = await post(`/api/documents/${id}/send`, { peppol: true });
  assert.equal(ok.status, 200);
  const sent = await prisma.document.findUnique({ where: { id } });
  assert.equal(sent?.peppolId, 'doc_TEST1'); assert.equal(sent?.peppolStatus, 'sent'); assert.ok(sent?.sentAt); assert.equal(sent?.status, 'sent');
  assert.ok(calls.some((c) => c.startsWith('POST /cmp_1/send')));

  assert.equal((await post(`/api/documents/${id}/send`, { peppol: true })).status, 409, 'déjà transmis');

  docStatus = 'delivered';
  const refreshed = await post(`/api/documents/${id}/peppol/refresh`);
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.peppol.status, 'delivered');
  assert.equal((await prisma.document.findUnique({ where: { id } }))?.peppolStatus, 'delivered');
});

test('Peppol : un devis ne se transmet pas par Peppol', async () => {
  const q = await prisma.document.create({ data: { kind: 'quote', direction: 'sale', number: 'DP-1', status: 'draft', worksiteId: ids.ws, contactId: ids.contact, lockedAt: new Date(), source: 'test' } });
  ids.docs.push(q.id);
  assert.equal((await post(`/api/documents/${q.id}/send`, { peppol: true })).status, 422);
});
