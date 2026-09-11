import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let contactId = '';
const ledgerIds: string[] = [];

async function jf<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }),
  });
  token = (await login.json()).token;

  await prisma.contact.deleteMany({ where: { name: 'Sanimat — test' } });
  const contact = await prisma.contact.create({
    data: { name: 'Sanimat — test', normalizedName: 'sanimat test', type: 'supplier', source: 'manual' },
  });
  contactId = contact.id;
});

after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: ledgerIds } } });
  await prisma.contact.delete({ where: { id: contactId } }).catch(() => {});
  server.close();
});

test('solde fournisseur : les notes de crédit viennent en déduction des factures non payées', async () => {
  // en compte chez ce fournisseur : pas payé à l'enlèvement -> les 2 factures restent "Non payé"
  const rows = await prisma.ledgerEntry.createMany({
    data: [
      { contactId, direction: 'purchase', docNumber: 'FA-1', date: new Date('2026-07-01'), ht: 100, ttc: 121, paymentStatus: 'Non payé', source: 'test' },
      { contactId, direction: 'purchase', docNumber: 'FA-2', date: new Date('2026-07-10'), ht: 200, ttc: 242, paymentStatus: 'Non payé', source: 'test' },
      { contactId, direction: 'credit_note', docNumber: 'NC-1', date: new Date('2026-07-15'), ht: 50, ttc: 60.5, paymentStatus: null, source: 'test' },
      // déjà réglée (rapprochement bancaire) -> ne pèse plus dans le solde ouvert
      { contactId, direction: 'purchase', docNumber: 'FA-3', date: new Date('2026-06-01'), ht: 80, ttc: 96.8, paymentStatus: 'Payé', source: 'test' },
    ],
  });
  assert.equal(rows.count, 4);
  const created = await prisma.ledgerEntry.findMany({ where: { contactId }, select: { id: true } });
  ledgerIds.push(...created.map((r) => r.id));

  const r = await jf<{
    contact: {
      purchaseSummary: { count: number; ht: number; ttc: number; balance: number };
      purchaseBalance: { docNumber: string | null; direction: string; balance: number }[];
    };
  }>(`/api/contacts/${contactId}`);
  assert.equal(r.status, 200);

  // solde = (121 + 242) - 60.5 = 302.5 — la facture payée (FA-3) n'y entre pas,
  // et la note de crédit vient bien en déduction plutôt que d'être ignorée
  assert.equal(r.body.contact.purchaseSummary.balance, 302.5);
  assert.equal(r.body.contact.purchaseSummary.count, 4);
  // total net TTC sur tout l'historique (factures - notes de crédit), payées incluses
  assert.equal(r.body.contact.purchaseSummary.ttc, 121 + 242 + 96.8 - 60.5);

  // relevé du solde : uniquement les lignes ouvertes (factures non payées + notes de crédit),
  // la facture payée FA-3 est absente
  const docs = r.body.contact.purchaseBalance.map((b) => b.docNumber);
  assert.deepEqual(docs, ['NC-1', 'FA-2', 'FA-1']); // le plus récent en premier
  assert.ok(!docs.includes('FA-3'));

  const last = r.body.contact.purchaseBalance[0];
  assert.equal(last.balance, 302.5); // solde cumulé le plus récent = solde final
});

test('DELETE /api/contacts/:id : refusé si des données y sont encore liées', async () => {
  await prisma.contact.deleteMany({ where: { name: 'Contact lié — test' } });
  const linked = await prisma.contact.create({
    data: { name: 'Contact lié — test', normalizedName: 'contact lie test', type: 'client', source: 'manual' },
  });
  try {
    await prisma.worksite.create({ data: { ref: 'R-CTLINK', title: 'Chantier lié', clientId: linked.id, source: 'test' } });
    const r = await jf(`/api/contacts/${linked.id}`, { method: 'DELETE' });
    assert.equal(r.status, 409);
    assert.ok(await prisma.contact.findUnique({ where: { id: linked.id } }), 'le contact ne doit pas être supprimé');
  } finally {
    await prisma.worksite.deleteMany({ where: { ref: 'R-CTLINK' } });
    await prisma.contact.delete({ where: { id: linked.id } }).catch(() => {});
  }
});

test('DELETE /api/contacts/:id : supprime un contact sans données liées (et son compte portail éventuel)', async () => {
  await prisma.contact.deleteMany({ where: { name: 'Contact orphelin — test' } });
  const orphan = await prisma.contact.create({
    data: { name: 'Contact orphelin — test', normalizedName: 'contact orphelin test', type: 'client', source: 'manual' },
  });
  await prisma.user.create({
    data: { email: 'orphelin-test@jjd-consult.be', passwordHash: 'x', role: 'client', contactId: orphan.id },
  });
  const r = await jf(`/api/contacts/${orphan.id}`, { method: 'DELETE' });
  assert.equal(r.status, 204);
  assert.equal(await prisma.contact.findUnique({ where: { id: orphan.id } }), null);
  assert.equal(await prisma.user.findUnique({ where: { email: 'orphelin-test@jjd-consult.be' } }), null);
});

test('kind "developer" (promoteur) : accepté par le schéma, distinct d\'une ACP', async () => {
  const r = await jf<{ contact: { id: string; kind: string } }>('/api/contacts', {
    method: 'POST',
    body: JSON.stringify({ name: 'NV MATEXI BRUSSEL — test', type: 'client', kind: 'developer' }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.contact.kind, 'developer');
  await prisma.contact.deleteMany({ where: { id: r.body.contact.id } });
});

test('immeuble/projet créé "à la volée" puis lié à un contact ACP (flux chercher-ou-créer)', async () => {
  const building = await jf<{ building: { id: string; name: string } }>('/api/buildings', {
    method: 'POST',
    body: JSON.stringify({ name: 'ACP Nouvelle Demande — test' }),
  });
  assert.equal(building.status, 201);

  const contact = await jf<{ contact: { id: string; buildingId: string | null } }>('/api/contacts', {
    method: 'POST',
    body: JSON.stringify({ name: 'ACP Nouvelle Demande — test', type: 'client', kind: 'acp', buildingId: building.body.building.id }),
  });
  assert.equal(contact.status, 201);
  assert.equal(contact.body.contact.buildingId, building.body.building.id);

  await prisma.contact.deleteMany({ where: { id: contact.body.contact.id } });
  await prisma.building.deleteMany({ where: { id: building.body.building.id } });
});
