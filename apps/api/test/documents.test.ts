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
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId: wsId } });
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

test('brouillon : coordonnées de facturation, réf. client et acompte réglés directement — respectés à l’émission', async () => {
  const created = await (
    await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 1000, vatRate: 0.21 }] }) })
  ).json();
  const id = created.document.id;

  const patched = await (
    await fetch(`${base}/api/documents/${id}`, {
      method: 'PATCH', headers: auth(),
      body: JSON.stringify({
        billingName: 'Facturation SA', billingVat: 'BE0123456789', billingAddress: 'Rue Facturée 3, 1000 Bruxelles',
        billingEmail: 'compta@exemple.be', customerRef: 'BC-2026-042', paidAmount: 250,
      }),
    })
  ).json();
  assert.equal(patched.document.billingName, 'Facturation SA');
  assert.equal(patched.document.billingVat, 'BE0123456789');
  assert.equal(patched.document.billingEmail, 'compta@exemple.be');
  assert.equal(patched.document.customerRef, 'BC-2026-042');
  assert.equal(patched.document.paidAmount, 250);

  // effacer une coordonnée (null explicite) doit bien la vider, pas juste ignorer
  const cleared = await (
    await fetch(`${base}/api/documents/${id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ billingEmail: null }) })
  ).json();
  assert.equal(cleared.document.billingEmail, null);
  assert.equal(cleared.document.billingName, 'Facturation SA', 'les autres champs ne doivent pas être touchés');

  // l'émission ne doit pas écraser une coordonnée déjà saisie manuellement (cf. issueDocument : `doc.billingName ?? …`)
  const issued = await (await fetch(`${base}/api/documents/${id}/issue`, { method: 'POST', headers: auth(), body: '{}' })).json();
  assert.equal(issued.document.billingName, 'Facturation SA');
  assert.equal(issued.document.customerRef, 'BC-2026-042');
  assert.equal(issued.document.paidAmount, 250);
});

test('émission facture : écriture du grand livre créée automatiquement (source document-sync)', async () => {
  const created = await (
    await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 1000, vatRate: 0.21 }] }) })
  ).json();
  const id = created.document.id;

  // brouillon : pas encore d'écriture
  assert.equal(await prisma.ledgerEntry.findUnique({ where: { documentId: id } }), null);

  const issued = await (await fetch(`${base}/api/documents/${id}/issue`, { method: 'POST', headers: auth(), body: '{}' })).json();
  const entry = await prisma.ledgerEntry.findUnique({ where: { documentId: id } });
  assert.ok(entry, 'une écriture doit exister après émission');
  assert.equal(entry!.direction, 'sale');
  assert.equal(entry!.docNumber, issued.document.number);
  assert.equal(entry!.worksiteId, wsId);
  assert.equal(entry!.ht, 1000);
  assert.equal(entry!.ttc, 1210);
  assert.equal(entry!.paymentStatus, 'Non payé');
  assert.equal(entry!.source, 'document-sync');

  // encaissement -> l'écriture (même id, pas de doublon) passe "Payé"
  await fetch(`${base}/api/documents/${id}/mark-paid`, { method: 'POST', headers: auth(), body: JSON.stringify({ amount: 1210 }) });
  const paid = await prisma.ledgerEntry.findUnique({ where: { documentId: id } });
  assert.equal(paid!.id, entry!.id, 'même écriture mise à jour, pas une nouvelle');
  assert.equal(paid!.paymentStatus, 'Payé');
  assert.ok(paid!.paidOn);

  const count = await prisma.ledgerEntry.count({ where: { documentId: id } });
  assert.equal(count, 1, 'jamais plus d’une écriture par document');
});

test('devis émis : aucune écriture du grand livre (ce n’est pas du CA)', async () => {
  const created = await (
    await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'quote', worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 500, vatRate: 0.21 }] }) })
  ).json();
  await fetch(`${base}/api/documents/${created.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });
  const entry = await prisma.ledgerEntry.findUnique({ where: { documentId: created.document.id } });
  assert.equal(entry, null);
});

test('note de crédit émise : écriture "vente" (réduit le CA, pas un achat)', async () => {
  const inv = await (
    await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 200, vatRate: 0.21 }] }) })
  ).json();
  await fetch(`${base}/api/documents/${inv.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });
  const cn = await (await fetch(`${base}/api/documents/${inv.document.id}/credit-note`, { method: 'POST', headers: auth(), body: '{}' })).json();
  await fetch(`${base}/api/documents/${cn.document.id}/issue`, { method: 'POST', headers: auth(), body: '{}' });

  const entry = await prisma.ledgerEntry.findUnique({ where: { documentId: cn.document.id } });
  assert.ok(entry);
  assert.equal(entry!.direction, 'credit_note');
  assert.match(entry!.categoryRaw ?? '', /vente/i);
});

test('paidAmount corrigé à la main après émission (PATCH) : écriture resynchronisée', async () => {
  const created = await (
    await fetch(`${base}/api/documents`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'invoice', worksiteId: wsId, lines: [{ label: 'Poste', qty: 1, unitPriceHt: 100, vatRate: 0 }] }) })
  ).json();
  const id = created.document.id;
  await fetch(`${base}/api/documents/${id}/issue`, { method: 'POST', headers: auth(), body: '{}' });

  await fetch(`${base}/api/documents/${id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ paidAmount: 100 }) });
  const entry = await prisma.ledgerEntry.findUnique({ where: { documentId: id } });
  assert.equal(entry!.paymentStatus, 'Payé');
});
