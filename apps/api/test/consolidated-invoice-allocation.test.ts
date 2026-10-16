import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { worksiteMargin, slipCostShift } from '../src/lib/worksite-margin.js';

const ids: string[] = []; const ws: string[] = [];
after(async () => { await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids } } }); await prisma.worksite.deleteMany({ where: { id: { in: ws } } }); });
const site = async (ref: string) => { const w = await prisma.worksite.create({ data: { ref, title: ref, source: 'test' } }); ws.push(w.id); return w.id; };
const entry = async (data: Record<string, unknown>) => { const e = await prisma.ledgerEntry.create({ data: { source: 'test-alloc', year: 2026, ...data } as never }); ids.push(e.id); return e; };

test('facture consolidée : le coût de chaque bordereau va sur son chantier, le reste sur celui de la facture', async () => {
  const a = await site('R-ALLOC-A'), b = await site('R-ALLOC-B'), c = await site('R-ALLOC-C');
  const inv = await entry({ direction: 'purchase', docNumber: 'FC-1', supplierName: 'Lambert Test', ht: 100, ttc: 121, worksiteId: a });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-1', supplierName: 'Lambert Test', ht: 40, ttc: 48.4, worksiteId: b, linkedInvoiceId: inv.id });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-2', supplierName: 'Lambert Test', ht: 20, ttc: 24.2, worksiteId: c, linkedInvoiceId: inv.id });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-3', supplierName: 'Lambert Test', ht: 10, ttc: 12.1, worksiteId: a, linkedInvoiceId: inv.id }); // même chantier que la facture : déjà comptée dedans
  assert.equal((await worksiteMargin(a))!.materialCost, 40, '100 − 40 − 20 : reste sur le chantier de la facture');
  assert.equal((await worksiteMargin(b))!.materialCost, 40);
  assert.equal((await worksiteMargin(c))!.materialCost, 20);
  const total = (await worksiteMargin(a))!.materialCost + (await worksiteMargin(b))!.materialCost + (await worksiteMargin(c))!.materialCost;
  assert.equal(total, 100, 'rien de compté en double ni perdu');
});

test('facture sans chantier : chaque bordereau porte son coût ; bordereaux > facture : plafonnés au montant de la facture', async () => {
  const d = await site('R-ALLOC-D'), e = await site('R-ALLOC-E');
  const inv = await entry({ direction: 'purchase', docNumber: 'FC-2', supplierName: 'Lambert Test', ht: 50, ttc: 60.5 });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-4', ht: 60, ttc: 72.6, worksiteId: d, linkedInvoiceId: inv.id });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-5', ht: 40, ttc: 48.4, worksiteId: e, linkedInvoiceId: inv.id });
  assert.equal(await slipCostShift(d), 30);
  assert.equal(await slipCostShift(e), 20);
  assert.equal((await worksiteMargin(d))!.materialCost + (await worksiteMargin(e))!.materialCost, 50, 'jamais plus que la facture');
});

test('facture déjà répartie par chantier à la saisie (une écriture par chantier) : les bordereaux ne déplacent rien en plus', async () => {
  const f = await site('R-ALLOC-F'), g = await site('R-ALLOC-G');
  const partF = await entry({ direction: 'purchase', docNumber: 'FC-3', supplierName: 'Lambert Test', ht: 60, ttc: 72.6, worksiteId: f });
  await entry({ direction: 'purchase', docNumber: 'FC-3', supplierName: 'Lambert Test', ht: 40, ttc: 48.4, worksiteId: g });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-6', supplierName: 'Lambert Test', ht: 40, ttc: 48.4, worksiteId: g, linkedInvoiceId: partF.id });
  assert.equal((await worksiteMargin(f))!.materialCost, 60);
  assert.equal((await worksiteMargin(g))!.materialCost, 40);
});

test('la facture expose sa répartition par chantier (calculée d’après les bordereaux reliés), sans rien saisir', async () => {
  const { createApp } = await import('../src/app.js');
  const h = await site('R-ALLOC-H'), i = await site('R-ALLOC-I'), j = await site('R-ALLOC-J');
  const inv = await entry({ direction: 'purchase', docNumber: 'FC-9', supplierName: 'Lambert Alloc', ht: 619.85, ttc: 750.02, worksiteId: h });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-9a', supplierName: 'Lambert Alloc', ht: 75.66, ttc: 91.55, worksiteId: i, linkedInvoiceId: inv.id });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-9b', supplierName: 'Lambert Alloc', ht: 98.74, ttc: 119.47, worksiteId: i, linkedInvoiceId: inv.id });
  await entry({ direction: 'delivery_slip', docNumber: 'BC-9c', supplierName: 'Lambert Alloc', ht: 34.23, ttc: 41.42, worksiteId: j, linkedInvoiceId: inv.id });
  const server = createApp().listen(0); await new Promise((r) => server.once('listening', r));
  try {
    const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
    const r = await (await fetch(`${base}/api/finance/expenses/${inv.id}`, { headers: { authorization: `Bearer ${token}` } })).json();
    const alloc = r.expense.worksiteAllocation as { ref: string; ht: number }[];
    assert.deepEqual(alloc.map((a) => [a.ref, a.ht]), [['R-ALLOC-H', 411.22], ['R-ALLOC-I', 174.4], ['R-ALLOC-J', 34.23]]);
    assert.equal(alloc.reduce((s, a) => s + a.ht, 0).toFixed(2), '619.85');
  } finally { server.close(); }
});
