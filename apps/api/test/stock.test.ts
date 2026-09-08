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
