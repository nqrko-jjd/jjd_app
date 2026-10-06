import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { parseTariff, guessPacking } from '../src/lib/supplier-tariff.js';

let server: Server;
let base = '';
let token = '';
let storeToken = '';
let supplierId = '';
let itemId = '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jf<T = any>(path: string, init?: RequestInit & { as?: string }): Promise<{ status: number; body: T }> {
  const { as, ...rest } = init ?? {};
  const isForm = rest.body instanceof FormData;
  const r = await fetch(base + path, {
    ...rest,
    headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${as ?? token}`, ...(rest.headers ?? {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}
const login = async (email: string) =>
  (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'jjd' }) })).json()).token as string;
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const csv = (text: string, name = 'tarif.csv') => {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'text/csv' }), name);
  fd.append('contactId', supplierId);
  return { method: 'POST', body: fd };
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = await login('david@jjd-consult.be');
  storeToken = await login('magasin@jjd-consult.be');
  supplierId = (await prisma.contact.create({ data: { name: 'Vector Test — achats', normalizedName: 'vector test achats', type: 'supplier', customerNumber: '53370', onAccount: true } })).id;
});

after(async () => {
  await prisma.purchaseOrder.deleteMany({ where: { contactId: supplierId } });
  await prisma.stockMovement.deleteMany({ where: { contactId: supplierId } });
  if (itemId) await prisma.stockItem.deleteMany({ where: { id: itemId } });
  await prisma.contact.deleteMany({ where: { id: supplierId } });
  server.close();
});

test('tarif : colonnes repérées (n° d’article, libellé, U.V, prix), doublons fusionnés, « / » remplacé par le libellé', () => {
  const text = 'No−Art;Fournisseur;Libellé;U.V;P.U Htva\n100057;V3;KNAUF MP75 25KG 45/PAL;PC;9,602\n100057;V3;KNAUF MP75 25KG 45/PAL;PC;9,7\n/;V3;GANTS TAILLE 9;PC;1,5\n';
  const r = parseTariff(Buffer.from(text), 'tarif.csv');
  assert.equal(r.rows.length, 2);
  const mp = r.rows.find((x) => x.ref === '100057')!;
  assert.equal(mp.priceHt, 9.7, 'la dernière ligne d’un même n° gagne');
  assert.equal(mp.unit, 'PC');
  assert.match(r.rows.find((x) => x.ref !== '100057')!.ref, /^-gants-taille-9$/);
});

test('tarif avec prix brut / remise / net (Proshop) : le net est retenu, la remise en %', () => {
  const text = 'No-Art;Libellé;U.V;P.U Brut Htva;Remise;P.U Net Htva\nX1;TAPE MAUVE;PC;9,34;0,5;4,67\nX2;BROSSE;PC;8,93;;8,93\n';
  const r = parseTariff(Buffer.from(text), 'proshop.csv');
  const x1 = r.rows.find((x) => x.ref === 'X1')!;
  assert.equal(x1.priceHt, 4.67);
  assert.equal(x1.grossPrice, 9.34);
  assert.equal(x1.discountPct, 50);
});

test('conditionnement deviné du libellé : 25KG -> kg + sac de 25', () => {
  assert.deepEqual(guessPacking('KNAUF MP75 25KG 45/PAL', 'PC'), { unit: 'kg', pack: { name: 'sac', factor: 25 } });
  assert.deepEqual(guessPacking('BLOC BETON CREUX 39X19X09', 'PC'), { unit: 'pce', pack: null });
});

test('import du tarif : création puis mise à jour (prix modifié), fichier illisible refusé', async () => {
  const first = await jf('/api/purchasing/catalog/import', csv('No-Art;Libellé;U.V;P.U Htva\n100057;KNAUF MP75 25KG 45/PAL;PC;9,602\n100087;CIMENT 32.5N 25KG CCB;PC;4,774\n'));
  assert.equal(first.status, 201);
  assert.equal(first.body.created, 2);

  const second = await jf('/api/purchasing/catalog/import', csv('No-Art;Libellé;U.V;P.U Htva\n100057;KNAUF MP75 25KG 45/PAL;PC;9,9\n100087;CIMENT 32.5N 25KG CCB;PC;4,774\n'));
  assert.equal(second.body.updated, 1);
  assert.equal(second.body.unchanged, 1);

  assert.equal((await jf('/api/purchasing/catalog/import', csv('rien;du;tout\n1;2;3\n'))).status, 422);

  const list = await jf(`/api/purchasing/catalog?contactId=${supplierId}&q=MP75`);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].priceHt, 9.9);
  assert.equal(list.body.items[0].linked, null);
});

test('créer l’article depuis le tarif : kg + sac de 25, fournisseur lié au prix du sac ; le nouveau tarif met le prix à jour', async () => {
  const prod = (await jf(`/api/purchasing/catalog?contactId=${supplierId}&q=MP75`)).body.items[0];
  const made = await jf(`/api/purchasing/catalog/${prod.id}/create-article`, post({ brand: 'Knauf', model: 'MP75' }));
  assert.equal(made.status, 201);
  itemId = made.body.item.id;
  assert.equal(made.body.item.unit, 'kg');
  assert.equal(made.body.item.units[0].name, 'sac');
  assert.equal(made.body.item.suppliers[0].price, 9.9);
  assert.equal((await jf(`/api/purchasing/catalog/${prod.id}/create-article`, post({}))).status, 409, 'déjà lié');

  const re = await jf('/api/purchasing/catalog/import', csv('No-Art;Libellé;U.V;P.U Htva\n100057;KNAUF MP75 25KG 45/PAL;PC;10,2\n'));
  assert.equal(re.body.pricesSynced, 1);
  const item = (await jf(`/api/stock/items/${itemId}`)).body.item;
  assert.equal(item.suppliers[0].price, 10.2);
});

let orderId = '';
let freeOrderId = '';

test('commande fournisseur : prix par défaut = celui du fournisseur pour ce conditionnement ; brouillon → passée', async () => {
  const r = await jf('/api/purchasing/orders', post({ contactId: supplierId, note: 'Pour le chantier', lines: [{ stockItemId: itemId, unitName: 'sac', qty: 10 }] }));
  assert.equal(r.status, 201);
  assert.match(r.body.order.ref, /^CF-\d{4}-\d{3}$/);
  assert.equal(r.body.order.status, 'ordered');
  assert.equal(r.body.order.lines[0].price, 10.2);
  assert.equal(r.body.order.contact.customerNumber, '53370');
  orderId = r.body.order.id;
  assert.equal((await jf('/api/purchasing/orders', post({ contactId: supplierId, lines: [{ stockItemId: itemId, unitName: 'camion', qty: 1 }] }))).status, 422);
  const draft = await jf('/api/purchasing/orders', post({ contactId: supplierId, status: 'draft', lines: [{ stockItemId: itemId, qty: 5 }] }));
  assert.equal(draft.body.order.status, 'draft');
  const placed = await jf(`/api/purchasing/orders/${draft.body.order.id}/place`, post({}));
  assert.equal(placed.body.order.status, 'ordered');
  await jf(`/api/purchasing/orders/${draft.body.order.id}/cancel`, post({}));
});

test('réception par le magasinier : partielle puis complète, entrée en stock avec fournisseur et prix', async () => {
  const lineId = (await jf(`/api/purchasing/orders/${orderId}`, { as: storeToken })).body.order.lines[0].id;
  const r1 = await jf(`/api/purchasing/orders/${orderId}/receive`, { ...post({ lines: [{ lineId, qty: 4 }], deliveryNote: 'BL-123' }), as: storeToken });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.order.status, 'partial');
  assert.equal(r1.body.order.lines[0].receivedQty, 4);
  let item = (await jf(`/api/stock/items/${itemId}`)).body.item;
  assert.equal(item.qty, 100); // 4 sacs × 25 kg
  assert.equal(item.avgCost, 0.41); // 10,20 € / 25 kg = 0,408 -> 0,41

  const mv = await prisma.stockMovement.findFirst({ where: { stockItemId: itemId }, orderBy: { createdAt: 'desc' } });
  assert.equal(mv!.contactId, supplierId);
  assert.match(mv!.note ?? '', /Réception CF-.* · BL BL-123/);
  assert.equal(mv!.enteredQty, 4);

  assert.equal((await jf(`/api/purchasing/orders/${orderId}/receive`, { ...post({ lines: [{ lineId, qty: 0 }] }), as: storeToken })).status, 422);
  const r2 = await jf(`/api/purchasing/orders/${orderId}/receive`, { ...post({ lines: [{ lineId, qty: 6 }] }), as: storeToken });
  assert.equal(r2.body.order.status, 'received');
  item = (await jf(`/api/stock/items/${itemId}`)).body.item;
  assert.equal(item.qty, 250);
  // plus de réception une fois clôturée
  assert.equal((await jf(`/api/purchasing/orders/${orderId}/receive`, { ...post({ lines: [{ lineId, qty: 1 }] }), as: storeToken })).status, 409);
});

test('droits : un ouvrier ne voit pas les commandes ; le magasinier les voit', async () => {
  const w = await login('ouvrier@jjd-consult.be');
  assert.equal((await jf('/api/purchasing/orders', { as: w })).status, 403);
  assert.equal((await jf('/api/purchasing/orders', { as: storeToken })).status, 200);
});

test('ligne libre (produit commandé une seule fois) : sans article de stock, mélangeable avec une ligne de stock ; ligne vide refusée', async () => {
  const bad = await jf('/api/purchasing/orders', post({ contactId: supplierId, lines: [{ qty: 1 }] }));
  assert.equal(bad.status, 422, 'ni article ni description');
  const r = await jf('/api/purchasing/orders', post({
    contactId: supplierId,
    lines: [
      { label: '  Porte vitrée sur mesure 90x210  ', qty: 1, unitName: 'pce', price: 840 },
      { stockItemId: itemId, unitName: 'sac', qty: 2 },
    ],
  }));
  assert.equal(r.status, 201);
  const [free, stock] = r.body.order.lines;
  assert.equal(free.stockItemId, null);
  assert.equal(free.stockItem, null);
  assert.equal(free.label, 'Porte vitrée sur mesure 90x210');
  assert.equal(free.unitName, 'pce');
  assert.equal(free.price, 840);
  assert.equal(stock.stockItemId, itemId);
  const list = await jf('/api/purchasing/orders?status=all');
  const row = list.body.items.find((o: { id: string }) => o.id === r.body.order.id);
  assert.equal(row.totalHt, 840 + 2 * 10.2);
  freeOrderId = r.body.order.id;
});

test('réception d’une ligne libre : marquée reçue, aucune entrée en stock ; la ligne de stock, elle, alimente le stock', async () => {
  const order = (await jf(`/api/purchasing/orders/${freeOrderId}`, { as: storeToken })).body.order;
  const free = order.lines.find((l: { label: string | null }) => l.label);
  const before = await prisma.stockMovement.count({ where: { contactId: supplierId } });
  const r = await jf(`/api/purchasing/orders/${freeOrderId}/receive`, { ...post({ lines: [{ lineId: free.id, qty: 1 }] }), as: storeToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.status, 'partial');
  assert.equal(r.body.order.lines.find((l: { id: string }) => l.id === free.id).receivedQty, 1);
  assert.equal(await prisma.stockMovement.count({ where: { contactId: supplierId } }), before, 'pas de mouvement de stock pour une ligne libre');
  const stock = order.lines.find((l: { stockItemId: string | null }) => l.stockItemId);
  const r2 = await jf(`/api/purchasing/orders/${freeOrderId}/receive`, { ...post({ lines: [{ lineId: stock.id, qty: 2 }] }), as: storeToken });
  assert.equal(r2.body.order.status, 'received');
  assert.equal(await prisma.stockMovement.count({ where: { contactId: supplierId } }), before + 1);
});

test('document joint à la commande : le bureau dépose (PDF), le magasinier ouvre mais ne dépose pas ni ne supprime', async () => {
  const send = (as: string, name: string, content: BlobPart) => {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'application/pdf' }), name);
    return jf(`/api/purchasing/orders/${freeOrderId}/files`, { method: 'POST', body: fd, as });
  };
  assert.equal((await send(storeToken, 'bc.pdf', 'x')).status, 403);
  assert.equal((await send(token, 'virus.exe', 'MZ')).status, 422);
  const up = await send(token, 'Bon de commande porte é.pdf', '%PDF-1.4 commande porte');
  assert.equal(up.status, 201);
  assert.equal(up.body.file.label, 'Bon de commande porte é');
  assert.equal(up.body.file.size, '%PDF-1.4 commande porte'.length);

  const order = (await jf(`/api/purchasing/orders/${freeOrderId}`, { as: storeToken })).body.order;
  assert.equal(order.files.length, 1, 'les documents sont renvoyés avec la commande');
  const list = await jf(`/api/purchasing/orders/${freeOrderId}/files`, { as: storeToken });
  assert.equal(list.body.items.length, 1);
  const dl = await fetch(base + up.body.file.downloadPath, { headers: { authorization: `Bearer ${storeToken}` } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(await dl.text(), /commande porte/);

  const del = (as: string) => fetch(`${base}/api/purchasing/orders/${freeOrderId}/files/${up.body.file.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${as}` } });
  assert.equal((await del(storeToken)).status, 403);
  assert.equal((await del(token)).status, 204);
  assert.equal(await prisma.purchaseOrderFile.count({ where: { orderId: freeOrderId } }), 0);

  const big = await send(token, 'gros.pdf', new Uint8Array(15 * 1024 * 1024));
  assert.equal(big.status, 413);
});
