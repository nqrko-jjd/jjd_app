import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';
let storeToken = '';
let wsId = '';
let sacId = '';
let vracId = '';
let sacRef = '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jf<T = any>(path: string, init?: RequestInit & { as?: string }): Promise<{ status: number; body: T }> {
  const { as, ...rest } = init ?? {};
  const r = await fetch(base + path, {
    ...rest,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${as ?? token}`, ...(rest.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}
const login = async (email: string) =>
  (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'jjd' }) })).json()).token as string;
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = await login('david@jjd-consult.be');
  storeToken = await login('magasin@jjd-consult.be');
  await prisma.worksite.deleteMany({ where: { ref: 'R-PREP-TEST' } });
  wsId = (await prisma.worksite.create({ data: { ref: 'R-PREP-TEST', title: 'Prépa — test', source: 'test' } })).id;
  const sac = await jf('/api/stock/items', post({ name: 'MP75 prépa — test', unit: 'kg', units: [{ name: 'sac', factor: 25 }] }));
  sacId = sac.body.item.id;
  sacRef = sac.body.item.ref;
  vracId = (await jf('/api/stock/items', post({ name: 'Sable prépa — test', unit: 'kg' }))).body.item.id;
  await jf('/api/stock/movements', post({ stockItemId: sacId, type: 'in', qty: 10, unit: 'sac' })); // 250 kg
  await jf('/api/stock/movements', post({ stockItemId: vracId, type: 'in', qty: 500 }));
});

after(async () => {
  await prisma.stockOrder.deleteMany({ where: { worksiteId: wsId } });
  await prisma.stockMovement.deleteMany({ where: { stockItemId: { in: [sacId, vracId] } } });
  await prisma.stockItem.deleteMany({ where: { id: { in: [sacId, vracId] } } });
  await prisma.worksite.delete({ where: { id: wsId } }).catch(() => {});
  server.close();
});

let orderId = '';
let vracLineId = '';

test('préparation : le bureau crée la liste pour un chantier (réf PREP-…)', async () => {
  const r = await jf('/api/stock-orders', post({ worksiteId: wsId, note: 'Pour lundi', lines: [{ stockItemId: sacId, unitName: 'sac', qty: 3 }, { stockItemId: vracId, qty: 100 }] }));
  assert.equal(r.status, 201);
  assert.match(r.body.order.ref, /^PREP-\d{4}-\d{3}$/);
  assert.equal(r.body.order.status, 'to_prepare');
  orderId = r.body.order.id;
  vracLineId = r.body.order.lines[1].id;
  assert.equal((await jf('/api/stock-orders', post({ worksiteId: wsId, lines: [] }))).status, 422);
  assert.equal((await jf('/api/stock-orders', post({ worksiteId: wsId, lines: [{ stockItemId: sacId, unitName: 'camion', qty: 1 }] }))).status, 422);
});

test('le magasinier voit les préparations à faire', async () => {
  const r = await jf('/api/stock-orders', { as: storeToken });
  assert.equal(r.status, 200);
  const mine = r.body.items.find((o: { id: string }) => o.id === orderId);
  assert.ok(mine);
  assert.equal(mine.lineCount, 2);
  assert.equal(mine.doneLines, 0);
});

test('picking : scan = 1 sac imputé à la ligne ; article non demandé et dépassement refusés', async () => {
  await prisma.stockBarcode.deleteMany({ where: { code: 'EAN-PREP-TEST' } });
  await prisma.stockBarcode.create({ data: { stockItemId: sacId, code: 'EAN-PREP-TEST', unitName: 'sac' } });
  const scan = (code: string, qty?: number) => jf(`/api/stock-orders/${orderId}/scan`, { ...post({ code, qty }), as: storeToken });

  const s1 = await scan('EAN-PREP-TEST');
  assert.equal(s1.status, 200);
  assert.equal(s1.body.order.status, 'preparing');
  assert.equal(s1.body.order.lines[0].pickedQty, 1);
  // étiquette interne en unité de base : 25 kg = 1 sac de plus
  const s2 = await scan(sacRef, 25);
  assert.equal(s2.body.order.lines[0].pickedQty, 2);
  assert.equal((await scan('INCONNU')).status, 404);

  const other = await jf('/api/stock/items', post({ name: 'Hors liste — test', unit: 'u' }));
  assert.equal((await scan(other.body.item.ref)).status, 422, 'article non demandé');
  await prisma.stockItem.delete({ where: { id: other.body.item.id } });

  assert.equal((await scan('EAN-PREP-TEST')).status, 200); // 3e sac
  assert.equal((await scan('EAN-PREP-TEST')).status, 409, '4e sac : déjà complet');
});

test('validation : refusée s’il manque du vrac (sauf « livrer partiel »), puis sorties de stock vers le chantier', async () => {
  const picked = (n: number) => jf(`/api/stock-orders/${orderId}/lines/${vracLineId}/picked`, { ...post({ pickedQty: n }), as: storeToken });
  assert.equal((await picked(60)).status, 200);
  assert.equal((await picked(999)).status, 422);

  const refused = await jf(`/api/stock-orders/${orderId}/complete`, { ...post({}), as: storeToken });
  assert.equal(refused.status, 409);
  // rien n'a bougé dans le stock tant que la préparation n'est pas validée
  assert.equal((await prisma.stockItem.findUnique({ where: { id: sacId } }))!.qty, 250);

  const ok = await jf(`/api/stock-orders/${orderId}/complete`, { ...post({ allowShort: true }), as: storeToken });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.order.status, 'prepared');
  assert.equal((await prisma.stockItem.findUnique({ where: { id: sacId } }))!.qty, 175); // 250 − 3 sacs
  assert.equal((await prisma.stockItem.findUnique({ where: { id: vracId } }))!.qty, 440); // 500 − 60
  const mv = await prisma.stockMovement.findMany({ where: { worksiteId: wsId, type: 'out' } });
  assert.equal(mv.length, 2);
  assert.ok(mv.every((m) => m.note?.startsWith('Préparation PREP-')));

  // pas de double validation
  assert.equal((await jf(`/api/stock-orders/${orderId}/complete`, { ...post({}), as: storeToken })).status, 409);
  assert.equal((await prisma.stockItem.findUnique({ where: { id: sacId } }))!.qty, 175);
});

test('annulation : impossible après validation ; un ouvrier ne peut pas créer de préparation', async () => {
  assert.equal((await jf(`/api/stock-orders/${orderId}/cancel`, post({}))).status, 409);
  const w = await login('ouvrier@jjd-consult.be');
  assert.equal((await jf('/api/stock-orders', { ...post({ worksiteId: wsId, lines: [{ stockItemId: sacId, qty: 1 }] }), as: w })).status, 403);
  const draft = await jf('/api/stock-orders', post({ worksiteId: wsId, lines: [{ stockItemId: vracId, qty: 5 }] }));
  const c = await jf(`/api/stock-orders/${draft.body.order.id}/cancel`, post({}));
  assert.equal(c.body.order.status, 'cancelled');
});
