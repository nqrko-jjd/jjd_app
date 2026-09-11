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
  token = (
    await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  // repart d'un état propre : purge les brouillons manuels laissés par un run précédent
  await prisma.documentLine.deleteMany({ where: { document: { source: 'manual', number: null } } });
  await prisma.document.deleteMany({ where: { source: 'manual', number: null } });
  await prisma.counter.deleteMany({ where: { name: { startsWith: 'doc:' } } });
  const ws = await prisma.worksite.create({ data: { ref: 'R-DOCTEST', title: 'Doc test', source: 'test' } });
  wsId = ws.id;
});

after(async () => {
  await prisma.document.deleteMany({ where: { source: 'manual', worksiteId: wsId } });
  // scopé par id (pas par source:'test', qui matcherait aussi les chantiers créés
  // par d'autres fichiers de test tournant en parallèle)
  await prisma.worksite.deleteMany({ where: { id: wsId } });
  await prisma.counter.deleteMany({ where: { name: { startsWith: 'doc:' } } });
  server.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

test('devis : création brouillon -> totaux TVA ventilés', async () => {
  const r = await fetch(`${base}/api/documents`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({
      kind: 'quote',
      worksiteId: wsId,
      title: 'Rénovation salle de bain',
      lines: [
        { kind: 'section', label: 'Sanitaire' },
        { label: 'Douche italienne', qty: 1, unit: 'forfait', unitPriceHt: 2500, vatRate: 0.06 },
        { label: 'Robinetterie', qty: 3, unitPriceHt: 180, discountPct: 10, vatRate: 0.21 },
      ],
    }),
  });
  assert.equal(r.status, 201);
  const { document } = await r.json();
  assert.match(document.draftRef, /^BROUILLON-/);
  assert.equal(document.number, null);
  assert.equal(document.totalHt, 2986); // 2500 + 486
  assert.equal(document.totalVat, 252.06); // 150 + 102.06
  assert.equal(document.lines.length, 3);
});

test('devis : émission attribue un numéro continu et verrouille', async () => {
  const created = await (
    await fetch(`${base}/api/documents`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ kind: 'quote', worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 1000, vatRate: 0.21 }] }),
    })
  ).json();

  const issued = await fetch(`${base}/api/documents/${created.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });
  assert.equal(issued.status, 200);
  const { document } = await issued.json();
  assert.match(document.number, /^D\d{4}-\d{3}$/);
  assert.ok(document.lockedAt);
  assert.equal(document.draftRef, null);

  // le type reste verrouillé après émission…
  const badKind = await fetch(`${base}/api/documents/${document.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ kind: 'invoice' }),
  });
  assert.equal(badKind.status, 409);

  // …mais les lignes restent modifiables (phase de test), et c'est tracé dans l'audit log
  const patch = await fetch(`${base}/api/documents/${document.id}`, {
    method: 'PATCH',
    headers: auth(),
    body: JSON.stringify({ lines: [{ label: 'Poste corrigé', qty: 1, unitPriceHt: 1200, vatRate: 0.21 }] }),
  });
  assert.equal(patch.status, 200);
  const patched = await patch.json();
  assert.equal(patched.document.lines.length, 1);
  assert.equal(patched.document.totalHt, 1200);
  assert.equal(patched.document.number, document.number, 'le numéro déjà émis ne change pas');

  const log = await prisma.auditLog.findFirst({ where: { entity: 'document', entityId: document.id, action: 'edit_issued_lines' } });
  assert.ok(log, 'la modification post-émission est tracée dans l’audit log');
});

test('facture depuis devis : lignes copiées + communication structurée belge', async () => {
  const quote = await (
    await fetch(`${base}/api/documents`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ kind: 'quote', worksiteId: wsId, lines: [{ label: 'Chantier complet', qty: 1, unitPriceHt: 8000, vatRate: 0.06 }] }),
    })
  ).json();
  await fetch(`${base}/api/documents/${quote.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });

  const conv = await fetch(`${base}/api/documents/${quote.document.id}/convert`, { method: 'POST', headers: auth(), body: '{}' });
  assert.equal(conv.status, 201);
  const invDraft = (await conv.json()).document;
  assert.equal(invDraft.kind, 'invoice');
  assert.equal(invDraft.totalHt, 8000);
  assert.equal(invDraft.parent.id, quote.document.id);

  const issued = await (await fetch(`${base}/api/documents/${invDraft.id}/issue`, { method: 'POST', headers: auth(), body: '{}' })).json();
  assert.match(issued.document.number, /^F\d{4}-\d{3}$/);
  assert.match(issued.document.structuredComm, /^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
  assert.ok(issued.document.dueOn);

  // devis marqué accepté
  const q = await (await fetch(`${base}/api/documents/${quote.document.id}`, { headers: auth() })).json();
  assert.equal(q.document.status, 'accepted');
});

test('facture : encaissement partiel puis complet', async () => {
  const inv = await (
    await fetch(`${base}/api/documents`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ kind: 'invoice', worksiteId: wsId, lines: [{ label: 'X', qty: 1, unitPriceHt: 100, vatRate: 0 }] }),
    })
  ).json();
  await fetch(`${base}/api/documents/${inv.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });

  let r = await (await fetch(`${base}/api/documents/${inv.document.id}/mark-paid`, { method: 'POST', headers: auth(), body: JSON.stringify({ amount: 40 }) })).json();
  assert.equal(r.document.status, 'partial');
  r = await (await fetch(`${base}/api/documents/${inv.document.id}/mark-paid`, { method: 'POST', headers: auth(), body: JSON.stringify({ amount: 60 }) })).json();
  assert.equal(r.document.status, 'paid');
});

test('worker ne voit pas les documents', async () => {
  const wt = (
    await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ouvrier@jjd-consult.be', password: 'jjd' }),
      })
    ).json()
  ).token;
  const r = await fetch(`${base}/api/documents`, { headers: { authorization: `Bearer ${wt}` } });
  assert.equal(r.status, 403);
});

test('émission : adresse de facturation "c/o syndic" quand le contact (ACP) a un syndic lié', async () => {
  const syndic = await prisma.syndic.create({ data: { name: 'Baltimo', normalizedName: 'baltimo', address: 'Rue du Siège 1', city: '1000 Bruxelles' } });
  const acp = await prisma.contact.create({
    data: { name: 'ACP Les Tilleuls', normalizedName: 'acp les tilleuls', type: 'client', kind: 'acp', address: 'Avenue du Chantier 5', city: '1050 Ixelles', syndicId: syndic.id, source: 'test' },
  });
  try {
    const created = await (
      await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'quote', worksiteId: wsId, contactId: acp.id, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 100 }] }) })
    ).json();
    const issued = await (await fetch(`${base}/api/documents/${created.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' })).json();
    assert.equal(issued.document.billingName, 'ACP Les Tilleuls');
    assert.match(issued.document.billingAddress, /^c\/o Baltimo/);
    assert.match(issued.document.billingAddress, /Rue du Siège 1/);
    assert.doesNotMatch(issued.document.billingAddress, /Avenue du Chantier/, 'ne doit pas utiliser l’adresse du chantier (ACP), mais celle du siège du syndic');
  } finally {
    await prisma.contact.deleteMany({ where: { id: acp.id } });
    await prisma.syndic.deleteMany({ where: { id: syndic.id } });
  }
});

test('émission : sans syndic lié, adresse de facturation = adresse du contact (comportement inchangé)', async () => {
  const client = await prisma.contact.create({
    data: { name: 'Client Sans Syndic', normalizedName: 'client sans syndic', type: 'client', address: 'Rue Directe 9', city: '1200 Woluwe', source: 'test' },
  });
  try {
    const created = await (
      await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'quote', worksiteId: wsId, contactId: client.id, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 100 }] }) })
    ).json();
    const issued = await (await fetch(`${base}/api/documents/${created.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' })).json();
    assert.doesNotMatch(issued.document.billingAddress ?? '', /^c\/o/);
    assert.match(issued.document.billingAddress, /Rue Directe 9/);
  } finally {
    await prisma.contact.deleteMany({ where: { id: client.id } });
  }
});
