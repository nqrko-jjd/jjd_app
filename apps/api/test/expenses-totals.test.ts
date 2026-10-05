import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let server: Server;
let base = '';
let token = '';

type Totals = { count: number; ttc: number; ht: number; unpaidTtc: number };
async function list(q: string) {
  const r = await fetch(`${base}/api/finance/expenses?q=${q}&pageSize=100`, { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as { items: { id: string; direction: string; supplier: string | null }[]; totals: Totals };
}
const mk = (data: Record<string, unknown>) => prisma.ledgerEntry.create({ data: { source: 'test', supplierName: 'ZZTOT Fournisseur', date: new Date('2026-04-01'), ...data } as never });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'david@jjd-consult.be', password: 'jjd' }) });
  token = (await login.json()).token;
  await mk({ direction: 'purchase', ht: 100, ttc: 100, paymentStatus: 'Non payé', docNumber: 'ZT-1' }); // dû
  await mk({ direction: 'purchase', ht: 50, ttc: 50, paymentStatus: 'Payé', docNumber: 'ZT-2' }); // payé
  await mk({ direction: 'credit_note', ht: -30, ttc: -30, paymentStatus: 'Payé', categoryRaw: 'Note de crédit', docNumber: 'ZT-NC1' }); // NC saisie en négatif, déjà réglée
  await mk({ direction: 'credit_note', ht: 20, ttc: 20, paymentStatus: 'Non payé', categoryRaw: 'Note de crédit', docNumber: 'ZT-NC2' }); // NC saisie en positif, non réglée
  await mk({ direction: 'credit_note', ht: 1000, ttc: 1000, paymentStatus: 'Payé', categoryRaw: 'Crédit auto', docNumber: 'ZT-LOAN' }); // emprunt : hors de la vue Achats
});
after(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { supplierName: 'ZZTOT Fournisseur' } });
  server.close();
});

test('Achats : les lignes « Crédit auto » (emprunts) sortent de la vue et des totaux', async () => {
  const r = await list('ZZTOT');
  assert.equal(r.totals.count, 4);
  const nums = await prisma.ledgerEntry.findMany({ where: { id: { in: r.items.map((i) => i.id) } }, select: { docNumber: true } });
  assert.ok(!nums.some((n) => n.docNumber === 'ZT-LOAN'), 'la ligne Crédit auto n’apparaît pas');
});

test('Achats : une note de crédit réduit toujours le total (positive ou négative), le reste à payer ne déduit que les non réglées', async () => {
  const r = await list('ZZTOT');
  // total = 100 + 50 − |−30| − |20| = 100
  assert.equal(r.totals.ttc, 100);
  assert.equal(r.totals.ht, 100);
  // reste à payer = 100 (facture due) − 20 (NC non réglée) ; la NC de 30 déjà payée n'est pas déduite
  assert.equal(r.totals.unpaidTtc, 80);
});
