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

test('code-barres du sac + étiquette interne : le scan retrouve l’article et le conditionnement', async () => {
  let id = '';
  try {
    const created = await jf<{ item: { id: string; ref: string } }>('/api/stock/items', {
      method: 'POST', body: JSON.stringify({ name: 'Knauf MP75 scan — test', unit: 'kg', units: [{ name: 'sac', factor: 25 }] }),
    });
    id = created.body.item.id;
    const ref = created.body.item.ref;

    const bc = await jf(`/api/stock/items/${id}/barcodes`, { method: 'POST', body: JSON.stringify({ code: '4003982000123', unitName: 'sac' }) });
    assert.equal(bc.status, 201);
    assert.equal((await jf(`/api/stock/items/${id}/barcodes`, { method: 'POST', body: JSON.stringify({ code: '4003982000123' }) })).status, 409, 'un code est unique');
    assert.equal((await jf(`/api/stock/items/${id}/barcodes`, { method: 'POST', body: JSON.stringify({ code: '999999', unitName: 'camion' }) })).status, 422);

    const byEan = await jf<{ kind: string; item: { id: string }; unitName: string | null }>('/api/stock/scan/4003982000123');
    assert.equal(byEan.body.item.id, id);
    assert.equal(byEan.body.unitName, 'sac');

    const byRef = await jf<{ item: { id: string }; unitName: string | null }>(`/api/stock/scan/${ref}`);
    assert.equal(byRef.body.item.id, id);
    assert.equal(byRef.body.unitName, null);
    const byRefUnit = await jf<{ unitName: string | null }>(`/api/stock/scan/${ref}:sac`);
    assert.equal(byRefUnit.body.unitName, 'sac');
    const lower = await jf<{ item: { id: string } }>(`/api/stock/scan/${ref.toLowerCase()}`);
    assert.equal(lower.body.item.id, id);

    assert.equal((await jf('/api/stock/scan/INCONNU-123')).status, 404);
  } finally {
    if (id) await prisma.stockItem.delete({ where: { id } }).catch(() => {});
  }
});

test('magasinier : accède au stock et aux mouvements, pas aux chantiers ni aux devis/factures', async () => {
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'magasin@jjd-consult.be', password: 'jjd' }),
  });
  assert.equal(login.status, 200);
  const t = (await login.json()).token;
  const get = (p: string) => fetch(base + p, { headers: { authorization: `Bearer ${t}` } });
  assert.equal((await get('/api/stock/items')).status, 200);
  assert.equal((await get('/api/stock/meta')).status, 200);
  assert.equal((await get('/api/materiel/status')).status, 200);
  assert.equal((await get('/api/worksites')).status, 403);
  assert.equal((await get('/api/documents')).status, 403);
  assert.equal((await get('/api/finance/consolidated')).status, 403);
  const created = await fetch(base + '/api/stock/items', {
    method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Article magasinier — test', unit: 'u' }),
  });
  assert.equal(created.status, 201, 'le magasinier crée et gère ses articles');
  await prisma.stockItem.deleteMany({ where: { name: 'Article magasinier — test' } });
});

test('article : nom complet + marque + réf. fabricant, retrouvés par la recherche', async () => {
  let id = '';
  try {
    const c = await jf<{ item: { id: string; brand: string; model: string } }>('/api/stock/items', {
      method: 'POST', body: JSON.stringify({ name: 'KNAUF MP75 25KG — test', unit: 'sac', brand: 'Knauf', model: 'MP75' }),
    });
    assert.equal(c.status, 201);
    id = c.body.item.id;
    assert.equal(c.body.item.brand, 'Knauf');
    assert.equal(c.body.item.model, 'MP75');
    const byModel = await jf<{ items: { id: string }[] }>('/api/stock/items?q=MP75');
    assert.ok(byModel.body.items.some((i) => i.id === id));
    const upd = await jf<{ item: { model: string | null } }>('/api/stock/items/' + id, { method: 'PATCH', body: JSON.stringify({ model: null }) });
    assert.equal(upd.body.item.model, null);
  } finally {
    if (id) await prisma.stockItem.delete({ where: { id } }).catch(() => {});
  }
});

test('création d’un article avec plusieurs fournisseurs : prix à l’unité et à la palette chez le même fournisseur', async () => {
  const a = await prisma.contact.create({ data: { name: 'Four. A création — test', normalizedName: 'four a creation test', type: 'supplier' } });
  const b = await prisma.contact.create({ data: { name: 'Four. B création — test', normalizedName: 'four b creation test', type: 'supplier' } });
  let id = '';
  try {
    const body = {
      name: 'KNAUF MP75 25KG — création test', unit: 'kg', model: 'MP75',
      units: [{ name: 'sac', factor: 25 }, { name: 'palette', factor: 1125 }],
      suppliers: [
        { contactId: a.id, supplierRef: '100057', unitName: 'sac', price: 9.6 },
        { contactId: a.id, supplierRef: '100057', unitName: 'palette', price: 410 },
        { contactId: b.id, unitName: 'sac', price: 9.9, preferred: true },
      ],
    };
    const r = await jf<{ item: { id: string; suppliers: { contactId: string; unitName: string | null; price: number; preferred: boolean }[] } }>('/api/stock/items', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(r.status, 201);
    id = r.body.item.id;
    assert.equal(r.body.item.suppliers.length, 3);
    assert.equal(r.body.item.suppliers.filter((x) => x.preferred).length, 1, 'un seul fournisseur préféré');
    assert.ok(r.body.item.suppliers.find((x) => x.contactId === b.id)!.preferred);
    assert.ok(r.body.item.suppliers.some((x) => x.contactId === a.id && x.unitName === 'palette' && x.price === 410));

    const dup = await jf('/api/stock/items', { method: 'POST', body: JSON.stringify({ name: 'Doublon — test', unit: 'kg', suppliers: [{ contactId: a.id, price: 1 }, { contactId: a.id, price: 2 }] }) });
    assert.equal(dup.status, 422);
    const badUnit = await jf('/api/stock/items', { method: 'POST', body: JSON.stringify({ name: 'Unité — test', unit: 'kg', suppliers: [{ contactId: a.id, unitName: 'camion', price: 1 }] }) });
    assert.equal(badUnit.status, 422);
    const noContact = await jf('/api/stock/items', { method: 'POST', body: JSON.stringify({ name: 'Inconnu — test', unit: 'kg', suppliers: [{ contactId: 'nope', price: 1 }] }) });
    assert.equal(noContact.status, 422);
  } finally {
    if (id) await prisma.stockItem.delete({ where: { id } }).catch(() => {});
    await prisma.stockItem.deleteMany({ where: { name: { in: ['Doublon — test', 'Unité — test', 'Inconnu — test'] } } });
    await prisma.contact.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  }
});

test('stock : photo produit — upload puis suppression, visible dans la fiche', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const created = await jf<{ item: { id: string } }>('/api/stock/items', { method: 'POST', body: JSON.stringify({ name: 'Photo — test', unit: 'u' }) });
  assert.equal(created.status, 201);
  const id = created.body.item.id;
  try {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
    const up = await fetch(`${base}/api/stock/items/${id}/photo`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    assert.equal(up.status, 201);
    const fiche = await jf<{ item: { photoUrl: string | null; photoThumbUrl: string | null } }>(`/api/stock/items/${id}`);
    assert.match(fiche.body.item.photoUrl ?? '', /^\/uploads\/media\/.+\.webp$/);
    assert.ok(fiche.body.item.photoThumbUrl);
    const del = await fetch(`${base}/api/stock/items/${id}/photo`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    assert.equal(del.status, 200);
    assert.equal((await jf<{ item: { photoUrl: string | null } }>(`/api/stock/items/${id}`)).body.item.photoUrl, null);
  } finally {
    await prisma.stockItem.delete({ where: { id } }).catch(() => {});
  }
});

test('stock : rack — scan d’étiquette, emplacement mémorisé à l’entrée, liste des racks', async () => {
  const scan = await jf<{ kind: string; code: string }>('/api/stock/scan/BRZ-tst-01-a');
  assert.equal(scan.status, 200);
  assert.deepEqual([scan.body.kind, scan.body.code], ['rack', 'TST-01-A']);

  const created = await jf<{ item: { id: string } }>('/api/stock/items', { method: 'POST', body: JSON.stringify({ name: 'Rack — test', unit: 'u' }) });
  const id = created.body.item.id;
  try {
    const mv = await jf('/api/stock/movements', { method: 'POST', body: JSON.stringify({ stockItemId: id, type: 'in', qty: 3, location: 'BRZ-TST-01-A' }) });
    assert.equal(mv.status, 201);
    assert.equal((await jf<{ item: { location: string | null } }>(`/api/stock/items/${id}`)).body.item.location, 'TST-01-A');

    const out = await jf('/api/stock/movements', { method: 'POST', body: JSON.stringify({ stockItemId: id, type: 'out', qty: 1, worksiteId, location: 'TST-99' }) });
    assert.equal(out.status, 201);
    assert.equal((await jf<{ item: { location: string | null } }>(`/api/stock/items/${id}`)).body.item.location, 'TST-01-A', 'une sortie ne déplace pas le rack');

    const post = await jf('/api/stock/locations', { method: 'POST', body: JSON.stringify({ codes: ['tst-02-b', 'BRZ-TST-02-B'] }) });
    assert.equal(post.status, 201);
    const list = await jf<{ items: { code: string; itemCount: number }[] }>('/api/stock/locations');
    assert.equal(list.body.items.find((l) => l.code === 'TST-01-A')?.itemCount, 1);
    assert.ok(list.body.items.some((l) => l.code === 'TST-02-B'));
  } finally {
    await prisma.stockMovement.deleteMany({ where: { stockItemId: id } });
    await prisma.stockItem.delete({ where: { id } }).catch(() => {});
    await prisma.stockLocation.deleteMany({ where: { code: { startsWith: 'TST-' } } });
  }
});
