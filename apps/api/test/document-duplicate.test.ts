import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let wsId = '';

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  wsId = (await prisma.worksite.create({ data: { ref: 'R-DUPTEST', title: 'Duplication test', source: 'test' } })).id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: wsId } } });
  await prisma.document.deleteMany({ where: { worksiteId: wsId } });
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  server.close();
});

const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('dupliquer reprend toute la fiche : textes, coordonnées, lignes avec descriptions ; un document importé sans lignes reporte son budget', async () => {
  const mk = await post('/api/documents', { kind: 'quote', worksiteId: wsId, title: 'Rénovation', lines: [{ label: 'Peinture', description: '<ul><li>Salon</li></ul>', qty: 1, unit: 'forfait', unitPriceHt: 5950, vatRate: 0.06 }] });
  const id = mk.body.document.id as string;
  await prisma.document.update({ where: { id }, data: { intro: 'Bonjour, voici notre offre', terms: 'Acompte 50 %', note: 'Note interne', customerRef: 'BC-12', billingName: 'Nelson D.', billingVat: 'BE0123456789', billingAddress: 'Rue 1, 1000 Bruxelles', billingEmail: 'n@example.com' } });
  for (const body of [{}, { kind: 'invoice' }]) {
    const d = (await post(`/api/documents/${id}/duplicate`, body)).body.document;
    assert.equal(d.intro, 'Bonjour, voici notre offre');
    assert.equal(d.terms, 'Acompte 50 %');
    assert.match(d.note, /Note interne/);
    assert.equal(d.customerRef, 'BC-12');
    assert.equal(d.billingName, 'Nelson D.');
    assert.equal(d.billingEmail, 'n@example.com');
    assert.equal(d.lines[0].description, '<ul><li>Salon</li></ul>');
    assert.equal(d.totalHt, 5950);
  }
  // importé sans lignes : seul le total est stocké
  const bare = await prisma.document.create({ data: { kind: 'quote', direction: 'sale', status: 'sent', number: 'D-DUPBARE', worksiteId: wsId, totalHt: 20200, totalVat: 1212, totalTtc: 21412, source: 'import' } });
  const copy = (await post(`/api/documents/${bare.id}/duplicate`, {})).body.document;
  assert.equal(copy.lines.length, 1);
  assert.equal(copy.totalHt, 20200);
  assert.equal(copy.totalTtc, 21412);
});

test('dupliquer dans un autre type : facture -> devis (brouillon indépendant) -> facture ; même type ; note de crédit sur facture émise refusée ici', async () => {
  const mk = await post('/api/documents', { kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Travaux', qty: 2, unitPriceHt: 100, vatRate: 0.06 }] });
  const inv = mk.body.document as { id: string };
  const asQuote = await post(`/api/documents/${inv.id}/duplicate`, { kind: 'quote' });
  assert.equal(asQuote.status, 201);
  assert.equal(asQuote.body.document.kind, 'quote');
  assert.equal(asQuote.body.document.status, 'draft');
  assert.equal(asQuote.body.document.totalHt, 200);
  assert.equal(asQuote.body.document.parentId ?? null, null);
  assert.match(asQuote.body.document.note, /Copie du/);
  const back = await post(`/api/documents/${asQuote.body.document.id}/duplicate`, { kind: 'invoice' });
  assert.equal(back.body.document.kind, 'invoice');
  assert.equal((await post(`/api/documents/${inv.id}/duplicate`, {})).body.document.kind, 'invoice');
  await post(`/api/documents/${inv.id}/issue`);
  assert.equal((await post(`/api/documents/${inv.id}/duplicate`, { kind: 'credit_note' })).status, 422, 'une facture émise passe par « Note de crédit… »');
  assert.equal((await post(`/api/documents/${inv.id}/duplicate`, { kind: 'bidon' })).status, 422);
  // devis -> note de crédit libre (brouillon, sans lien)
  const free = await post(`/api/documents/${asQuote.body.document.id}/duplicate`, { kind: 'credit_note' });
  assert.equal(free.status, 201);
  assert.equal(free.body.document.kind, 'credit_note');
  assert.equal(free.body.document.parentId ?? null, null);
});
