import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { worksiteMargin } from '../src/lib/worksite-margin.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';
let txId = '';

async function jf<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}

async function jfUpload<T>(path: string, filename: string, content: string): Promise<{ status: number; body: T }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), filename);
  const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
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

  // nettoie d'éventuels restes d'un run précédent interrompu
  const stale = await prisma.worksite.findMany({ where: { ref: 'R-EXP-TEST' }, select: { id: true } });
  for (const w of stale) {
    await prisma.bankTransaction.updateMany({ where: { matchedLedgerId: { in: (await prisma.ledgerEntry.findMany({ where: { worksiteId: w.id }, select: { id: true } })).map((x) => x.id) } }, data: { matchedLedgerId: null } });
    await prisma.ledgerEntry.deleteMany({ where: { worksiteId: w.id } });
    await prisma.worksite.delete({ where: { id: w.id } });
  }

  const ws = await prisma.worksite.create({ data: { ref: 'R-EXP-TEST', title: 'Dépenses — test', source: 'test' } });
  worksiteId = ws.id;
  const tx = await prisma.bankTransaction.create({
    data: { externalId: 'exp-test-tx', bookingDate: new Date('2026-09-05'), amount: -121, side: 'out', source: 'test' },
  });
  txId = tx.id;
});

after(async () => {
  await prisma.bankTransaction.deleteMany({ where: { OR: [{ id: txId }, { source: 'test' }] } });
  await prisma.ledgerEntry.deleteMany({ where: { worksiteId } });
  await prisma.worksite.deleteMany({ where: { id: worksiteId } });
  server.close();
});

test("création d'une dépense -> alimente le coût matériaux du chantier", async () => {
  const { status, body } = await jf<{ expense: { id: string; source: string; direction: string } }>(
    '/api/finance/expenses',
    { method: 'POST', body: JSON.stringify({ date: '2026-09-05', supplierName: 'Test Fournisseur', worksiteId, ht: 100, ttc: 121, paymentStatus: 'Non payé' }) },
  );
  assert.equal(status, 201);
  assert.equal(body.expense.source, 'manual');
  assert.equal(body.expense.direction, 'purchase');

  const m = await worksiteMargin(worksiteId);
  assert.equal(m!.materialCost, 100);
});

test('bascule payé / non payé', async () => {
  const list = await jf<{ items: { id: string }[] }>(`/api/finance/expenses?worksiteId=${worksiteId}`);
  const id = list.body.items[0]!.id;

  const paid = await jf<{ expense: { paymentStatus: string; paidOn: string | null } }>(`/api/finance/expenses/${id}/paid`, {
    method: 'POST', body: JSON.stringify({ paid: true }),
  });
  assert.equal(paid.body.expense.paymentStatus, 'Payé');
  assert.ok(paid.body.expense.paidOn);

  const back = await jf<{ expense: { paymentStatus: string; paidOn: string | null } }>(`/api/finance/expenses/${id}/paid`, {
    method: 'POST', body: JSON.stringify({ paid: false }),
  });
  assert.equal(back.body.expense.paymentStatus, 'Non payé');
  assert.equal(back.body.expense.paidOn, null);
});

test('modification puis suppression (manuel uniquement)', async () => {
  const list = await jf<{ items: { id: string }[] }>(`/api/finance/expenses?worksiteId=${worksiteId}`);
  const id = list.body.items[0]!.id;

  const patched = await jf<{ expense: { ht: number } }>(`/api/finance/expenses/${id}`, {
    method: 'PATCH', body: JSON.stringify({ ht: 150 }),
  });
  assert.equal(patched.body.expense.ht, 150);

  const del = await jf<{ ok: boolean }>(`/api/finance/expenses/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('suppression refusée sur une écriture importée', async () => {
  const imported = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', worksiteId, ht: 50, date: new Date('2026-08-01'), source: 'xlsx' },
  });
  const del = await jf(`/api/finance/expenses/${imported.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});

test('rapprochement bancaire -> facture d\'achat passe « payé », défaire la repasse « non payé »', async () => {
  const exp = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', worksiteId, ht: 100, ttc: 121, date: new Date('2026-09-04'), source: 'manual', paymentStatus: 'Non payé' },
  });

  const m = await jf<{ transaction: { matchedLedgerId: string | null } }>(`/api/finance/bank/${txId}/match`, {
    method: 'POST', body: JSON.stringify({ ledgerId: exp.id }),
  });
  assert.equal(m.body.transaction.matchedLedgerId, exp.id);
  const afterMatch = await prisma.ledgerEntry.findUnique({ where: { id: exp.id } });
  assert.equal(afterMatch!.paymentStatus, 'Payé');
  assert.ok(afterMatch!.paidOn);

  await jf(`/api/finance/bank/${txId}/match`, { method: 'POST', body: JSON.stringify({ ledgerId: null }) });
  const afterUnmatch = await prisma.ledgerEntry.findUnique({ where: { id: exp.id } });
  assert.equal(afterUnmatch!.paymentStatus, 'Non payé');
  assert.equal(afterUnmatch!.paidOn, null);
});

test('note de crédit fournisseur : créable, et vient en déduction des totaux (pas en plus)', async () => {
  const before = await jf<{ totals: { ht: number; ttc: number; unpaidTtc: number } }>(`/api/finance/expenses?worksiteId=${worksiteId}`);

  const created = await jf<{ expense: { id: string; direction: string; docType: string } }>(
    '/api/finance/expenses',
    { method: 'POST', body: JSON.stringify({ date: '2026-09-06', direction: 'credit_note', supplierName: 'Test Fournisseur NC', worksiteId, ht: 30, ttc: 36.3, paymentStatus: 'Non payé' }) },
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.expense.direction, 'credit_note');
  assert.equal(created.body.expense.docType, 'Note de crédit');

  const after = await jf<{ totals: { ht: number; ttc: number; unpaidTtc: number } }>(`/api/finance/expenses?worksiteId=${worksiteId}`);
  assert.equal(Math.round((after.body.totals.ht - before.body.totals.ht) * 100) / 100, -30);
  assert.equal(Math.round((after.body.totals.ttc - before.body.totals.ttc) * 100) / 100, -36.3);
  // une note de crédit n'est jamais "payée" : elle réduit le reste à payer immédiatement
  assert.equal(Math.round((after.body.totals.unpaidTtc - before.body.totals.unpaidTtc) * 100) / 100, -36.3);

  await prisma.ledgerEntry.delete({ where: { id: created.body.expense.id } });
});

test('export CSV puis réimport : met à jour par id, crée les nouvelles lignes, avertit sur chantier inconnu', async () => {
  const toUpdate = await prisma.ledgerEntry.create({
    data: { direction: 'purchase', worksiteId, ht: 10, ttc: 12.1, date: new Date('2026-09-01'), source: 'manual', supplierName: 'Avant import', paymentStatus: 'Non payé' },
  });

  const csv = [
    'id;Date;Échéance;Type;Fournisseur;N° document;Chantier;Catégorie;HT;TVA récup;TTC;Statut;Notes',
    `${toUpdate.id};2026-09-08;;Achat;Fournisseur MAJ;INV-MAJ;R-EXP-TEST;;200,5;;242,6;Payé;maj via import`,
    ';2026-09-09;;Achat;Nouveau Fournisseur;INV-NEW;R-EXP-TEST;;50;;60,5;Non payé;créé via import',
    ';2026-09-10;;Achat;Fournisseur Inconnu Chantier;INV-BADREF;R-INEXISTANT;;20;;24,2;Non payé;',
  ].join('\r\n');

  const r = await jfUpload<{ created: number; updated: number; warnings: { row: number; message: string }[] }>(
    '/api/finance/expenses/import', 'achats.csv', csv,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 2);
  assert.equal(r.body.updated, 1);
  assert.equal(r.body.warnings.length, 1);
  assert.match(r.body.warnings[0]!.message, /R-INEXISTANT/);

  const updated = await prisma.ledgerEntry.findUnique({ where: { id: toUpdate.id } });
  assert.equal(updated!.ht, 200.5);
  assert.equal(updated!.ttc, 242.6);
  assert.equal(updated!.docNumber, 'INV-MAJ');
  assert.equal(updated!.paymentStatus, 'Payé');

  const created = await prisma.ledgerEntry.findFirst({ where: { docNumber: 'INV-NEW', worksiteId } });
  assert.ok(created);
  assert.equal(created!.ht, 50);
  assert.equal(created!.worksiteId, worksiteId);

  const badRef = await prisma.ledgerEntry.findFirst({ where: { docNumber: 'INV-BADREF' }, orderBy: { createdAt: 'desc' } });
  assert.ok(badRef, 'la ligne est quand même créée malgré le chantier introuvable');
  assert.equal(badRef!.worksiteId, null);

  // nettoyage immédiat : ces lignes ne sont pas liées à worksiteId (ou plus, pour INV-BADREF),
  // donc pas couvertes par le nettoyage global du fichier
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: [created.id, badRef.id] } } });
});
