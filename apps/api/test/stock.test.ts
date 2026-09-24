import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let worksiteId = '';
let itemId = '';

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

  const stale = await prisma.stockItem.findMany({ where: { name: 'Sac de ciment 25kg — test' }, select: { id: true } });
  for (const it of stale) {
    await prisma.stockMovement.deleteMany({ where: { stockItemId: it.id } });
    await prisma.stockItem.delete({ where: { id: it.id } });
  }
  await prisma.worksite.deleteMany({ where: { ref: 'R-STOCK-TEST' } });

  const ws = await prisma.worksite.create({ data: { ref: 'R-STOCK-TEST', title: 'Stock — test', source: 'test' } });
  worksiteId = ws.id;
});

after(async () => {
  if (itemId) {
    await prisma.stockMovement.deleteMany({ where: { stockItemId: itemId } });
    await prisma.stockItem.delete({ where: { id: itemId } }).catch(() => {});
  }
  await prisma.worksite.delete({ where: { id: worksiteId } }).catch(() => {});
  server.close();
});

test('création article + entrée : quantité et coût moyen pondéré posés', async () => {
  const created = await jf<{ item: { id: string; qty: number } }>('/api/stock/items', {
    method: 'POST',
    body: JSON.stringify({ name: 'Sac de ciment 25kg — test', unit: 'sac', minQty: 10 }),
  });
  assert.equal(created.status, 201);
  itemId = created.body.item.id;
  assert.equal(created.body.item.qty, 0);

  const in1 = await jf<{ item: { qty: number; avgCost: number } }>('/api/stock/movements', {
    method: 'POST',
    body: JSON.stringify({ stockItemId: itemId, type: 'in', qty: 100, unitCost: 5 }),
  });
  assert.equal(in1.status, 201);
  assert.equal(in1.body.item.qty, 100);
  assert.equal(in1.body.item.avgCost, 5);
});

test('coût moyen pondéré recalculé sur une 2e entrée à prix différent', async () => {
  const in2 = await jf<{ item: { qty: number; avgCost: number } }>('/api/stock/movements', {
    method: 'POST',
    body: JSON.stringify({ stockItemId: itemId, type: 'in', qty: 50, unitCost: 6.5 }),
  });
  assert.equal(in2.status, 201);
  assert.equal(in2.body.item.qty, 150);
  // (100*5 + 50*6.5) / 150 = 5.5
  assert.equal(in2.body.item.avgCost, 5.5);
});

test('sortie chantier : quantité diminue, coût moyen inchangé, chantier obligatoire', async () => {
  const noWs = await jf('/api/stock/movements', {
    method: 'POST',
    body: JSON.stringify({ stockItemId: itemId, type: 'out', qty: 20 }),
  });
  assert.equal(noWs.status, 422);

  const out1 = await jf<{ item: { qty: number; avgCost: number } }>('/api/stock/movements', {
    method: 'POST',
    body: JSON.stringify({ stockItemId: itemId, type: 'out', qty: 20, worksiteId, requestedByName: 'Julien' }),
  });
  assert.equal(out1.status, 201);
  assert.equal(out1.body.item.qty, 130);
  assert.equal(out1.body.item.avgCost, 5.5);
});

test('inventaire (adjustment) : pose la quantité réelle, enregistre le delta signé', async () => {
  const adj = await jf<{ item: { qty: number }; movement: { qty: number; type: string } }>('/api/stock/movements', {
    method: 'POST',
    body: JSON.stringify({ stockItemId: itemId, type: 'adjustment', qty: 120, note: 'inventaire de septembre' }),
  });
  assert.equal(adj.status, 201);
  assert.equal(adj.body.item.qty, 120);
  assert.equal(adj.body.movement.qty, -10); // 120 - 130
});

test('liste des articles : valeur et seuil bas calculés', async () => {
  const r = await jf<{ items: { id: string; qty: number; avgCost: number; value: number; low: boolean }[] }>('/api/stock/items');
  assert.equal(r.status, 200);
  const it = r.body.items.find((x) => x.id === itemId)!;
  assert.equal(it.qty, 120);
  assert.equal(it.value, 660); // 120 * 5.5
  assert.equal(it.low, false); // minQty = 10, largement au-dessus
});

test('historique des mouvements : filtrable par article et par chantier, paginé', async () => {
  const r = await jf<{ items: unknown[]; totalCount: number }>(`/api/stock/movements?stockItemId=${itemId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.totalCount, 4); // 2 entrées + 1 sortie + 1 inventaire

  const byWs = await jf<{ items: { worksiteId: string | null }[] }>(`/api/stock/movements?worksiteId=${worksiteId}`);
  assert.equal(byWs.status, 200);
  assert.ok(byWs.body.items.every((m) => m.worksiteId === worksiteId));
});

test('désactivation d’un article (jamais de suppression)', async () => {
  const r = await jf<{ item: { active: boolean } }>(`/api/stock/items/${itemId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.active, false);
  // ré-activer pour le cleanup normal (after() le supprime pour de bon)
  await jf(`/api/stock/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({}) });
});

test('article multi-unités / multi-fournisseurs : sac = 25 kg, entrée en sacs, prix par fournisseur', async () => {
  const c1 = await prisma.contact.create({ data: { name: 'Fournisseur A — test stock', normalizedName: 'fournisseur a test stock', type: 'supplier' } });
  const c2 = await prisma.contact.create({ data: { name: 'Fournisseur B — test stock', normalizedName: 'fournisseur b test stock', type: 'supplier' } });
  let id = '';
  try {
    const created = await jf<{ item: { id: string; ref: string; units: { name: string; factor: number }[] } }>('/api/stock/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Knauf MP75 — test', unit: 'kg', brand: 'Knauf', units: [{ name: 'sac', factor: 25 }, { name: 'palette', factor: 1500 }] }),
    });
    assert.equal(created.status, 201);
    id = created.body.item.id;
    assert.match(created.body.item.ref, /^ART-\d{4}$/);
    assert.equal(created.body.item.units.length, 2);

    // unité en double / identique à la base : refusé
    const dup = await jf('/api/stock/items/' + id, { method: 'PATCH', body: JSON.stringify({ units: [{ name: 'KG', factor: 1 }] }) });
    assert.equal(dup.status, 422);

    // deux fournisseurs, prix par sac chez A, par kilo chez B
    const a = await jf<{ supplier: { id: string } }>(`/api/stock/items/${id}/suppliers`, { method: 'POST', body: JSON.stringify({ contactId: c1.id, supplierRef: 'MP75-25', unitName: 'sac', price: 12, preferred: true }) });
    assert.equal(a.status, 201);
    const b = await jf<{ supplier: { id: string } }>(`/api/stock/items/${id}/suppliers`, { method: 'POST', body: JSON.stringify({ contactId: c2.id, unitName: 'kg', price: 0.6 }) });
    assert.equal(b.status, 201);
    const badUnit = await jf(`/api/stock/items/${id}/suppliers`, { method: 'POST', body: JSON.stringify({ contactId: c1.id, unitName: 'camion' }) });
    assert.equal(badUnit.status, 422);
    // le fournisseur préféré est unique
    await jf(`/api/stock/items/${id}/suppliers/${b.body.supplier.id}`, { method: 'PATCH', body: JSON.stringify({ preferred: true }) });
    let item = (await jf<{ item: { suppliers: { contactId: string; preferred: boolean; unitName: string | null }[] } }>(`/api/stock/items/${id}`)).body.item;
    assert.equal(item.suppliers.filter((s) => s.preferred).length, 1);
    assert.equal(item.suppliers.find((s) => s.contactId === c2.id)!.unitName, null, 'unité de base = pas d’unité d’achat spécifique');

    // entrée de 4 sacs à 13 €/sac chez A -> 100 kg, coût 0,52 €/kg, prix du fournisseur mis à jour
    const inn = await jf<{ item: { qty: number; avgCost: number }; movement: { qty: number; enteredQty: number; enteredUnit: string; unitCost: number } }>('/api/stock/movements', {
      method: 'POST',
      body: JSON.stringify({ stockItemId: id, type: 'in', qty: 4, unit: 'sac', unitCost: 13, contactId: c1.id }),
    });
    assert.equal(inn.status, 201);
    assert.equal(inn.body.item.qty, 100);
    assert.equal(inn.body.item.avgCost, 0.52);
    assert.equal(inn.body.movement.enteredQty, 4);
    assert.equal(inn.body.movement.enteredUnit, 'sac');
    item = (await jf<{ item: { suppliers: { contactId: string; price: number }[] } }>(`/api/stock/items/${id}`)).body.item as never;
    assert.equal((item.suppliers as { contactId: string; price: number }[]).find((s) => s.contactId === c1.id)!.price, 13);

    // sortie d'1 sac vers le chantier -> 75 kg ; unité inconnue refusée
    const out = await jf<{ item: { qty: number } }>('/api/stock/movements', {
      method: 'POST', body: JSON.stringify({ stockItemId: id, type: 'out', qty: 1, unit: 'sac', worksiteId }),
    });
    assert.equal(out.body.item.qty, 75);
    assert.equal((await jf('/api/stock/movements', { method: 'POST', body: JSON.stringify({ stockItemId: id, type: 'out', qty: 1, unit: 'camion', worksiteId }) })).status, 422);
    // fournisseur uniquement sur une entrée
    assert.equal((await jf('/api/stock/movements', { method: 'POST', body: JSON.stringify({ stockItemId: id, type: 'out', qty: 1, worksiteId, contactId: c1.id }) })).status, 422);

    // inventaire compté en sacs : 2 sacs = 50 kg
    const inv = await jf<{ item: { qty: number } }>('/api/stock/movements', { method: 'POST', body: JSON.stringify({ stockItemId: id, type: 'adjustment', qty: 2, unit: 'sac' }) });
    assert.equal(inv.body.item.qty, 50);

    // on ne peut pas retirer l'unité « sac » tant qu'un fournisseur l'utilise
    const rm = await jf(`/api/stock/items/${id}`, { method: 'PATCH', body: JSON.stringify({ units: [{ name: 'palette', factor: 1500 }] }) });
    assert.equal(rm.status, 409);
  } finally {
    if (id) await prisma.stockItem.delete({ where: { id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { id: { in: [c1.id, c2.id] } } });
  }
});
