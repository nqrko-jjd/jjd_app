import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { worksiteMargin } from '../src/lib/worksite-margin.js';

let server: Server; let base = ''; let token = '';
const ids: { c?: string; a?: string; b?: string; e: string[]; tx: string[] } = { e: [], tx: [] };
/* eslint-disable @typescript-eslint/no-explicit-any */
const call = async (method: string, p: string, body?: object) => {
  const r = await fetch(`${base}/api/finance/expenses${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
};
const mk = async (data: Record<string, unknown>) => { const e = await prisma.ledgerEntry.create({ data: { source: 'xlsx', year: 2026, direction: 'purchase', contactId: ids.c, supplierName: 'Sous-traitant Répartition Test', categoryRaw: 'Matériel', paymentStatus: 'Non payé', date: new Date('2026-06-10'), ...data } as never }); ids.e.push(e.id); return e; };
const material = async (w: string) => (await worksiteMargin(w))!.materialCost;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.c = (await prisma.contact.create({ data: { name: 'Sous-traitant Répartition Test', normalizedName: 'sous-traitant repartition test', type: 'supplier' } })).id;
  ids.a = (await prisma.worksite.create({ data: { ref: 'R-ALLOCA', title: 'Chantier A', source: 'test' } })).id;
  ids.b = (await prisma.worksite.create({ data: { ref: 'R-ALLOCB', title: 'Chantier B', source: 'test' } })).id;
});
after(async () => {
  await prisma.bankTransaction.deleteMany({ where: { id: { in: ids.tx } } });
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids.e } } });
  await prisma.worksite.deleteMany({ where: { id: { in: [ids.a!, ids.b!] } } });
  await prisma.contact.deleteMany({ where: { id: ids.c } });
  server.close();
});

test('une fiche (même import Excel) répartie entre deux chantiers : coûts par chantier, vue du chantier, et refus d’un montant incohérent', async () => {
  const e = await mk({ docNumber: '110/2026', ht: 1000, ttc: 1210, worksiteId: ids.a });
  assert.equal(await material(ids.a!), 1000);

  assert.equal((await call('PATCH', `/${e.id}`, { allocations: [{ worksiteId: ids.a, ht: 600 }, { worksiteId: ids.b, ht: 300 }] })).status, 422, 'somme ≠ HT refusée');
  const ok = await call('PATCH', `/${e.id}`, { allocations: [{ worksiteId: ids.a, ht: 600 }, { worksiteId: ids.b, ht: 400 }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.expense.allocations.length, 2);
  assert.equal(ok.body.expense.worksiteId, ids.a, 'chantier principal = la plus grosse part');

  assert.equal(await material(ids.a!), 600, 'chantier A : sa part');
  assert.equal(await material(ids.b!), 400, 'chantier B : sa part');

  const forB = await call('GET', `?worksiteId=${ids.b}`);
  const row = forB.body.items.find((x: any) => x.id === e.id);
  assert.equal(row.ht, 400, 'vue du chantier B : la part de B'); assert.equal(row.partOfHt, 1000);
  assert.equal(forB.body.totals.ht, 400, 'total du chantier B : sa part seulement');
  assert.equal(row.splittable, true, 'répartition possible aussi sur une ligne de l’import Excel');

  assert.equal((await call('PATCH', `/${e.id}`, { ht: 1500 })).status, 422, 'on ne change pas le montant d’une facture répartie sans refaire la répartition');
  assert.equal((await call('PATCH', `/${e.id}`, { ht: 1500, allocations: [{ worksiteId: ids.a, ht: 900 }, { worksiteId: ids.b, ht: 600 }] })).status, 200);
  assert.equal(await material(ids.b!), 600);

  const cleared = await call('PATCH', `/${e.id}`, { ht: 1500, worksiteId: ids.b, allocations: [] });
  assert.equal(cleared.body.expense.allocations.length, 0);
  assert.equal(await material(ids.a!), 0, 'plus de répartition : tout sur un seul chantier');
  assert.equal(await material(ids.b!), 1500);
});

test('création d’une fiche répartie en une seule requête (un PDF, un paiement)', async () => {
  const r = await call('POST', '', { date: '2026-07-01', direction: 'purchase', contactId: ids.c, docNumber: 'NEW-1', ht: 200, ttc: 242, paymentStatus: 'Non payé', allocations: [{ worksiteId: ids.a, ht: 50 }, { worksiteId: ids.b, ht: 150 }] });
  assert.equal(r.status, 201); ids.e.push(r.body.expense.id);
  assert.equal(r.body.expense.allocations.length, 2);
  assert.equal(await prisma.ledgerEntry.count({ where: { docNumber: 'NEW-1' } }), 1, 'une seule fiche');
});

test('fusion de deux lignes d’une même facture (import Excel) : une fiche, deux parts, le paiement rapproché est conservé', async () => {
  const baseA = await material(ids.a!), baseB = await material(ids.b!); // les fiches des tests précédents comptent déjà
  const l1 = await mk({ docNumber: 'MERGE-1', ht: 300, ttc: 363, worksiteId: ids.a });
  const l2 = await mk({ docNumber: 'MERGE-1', ht: 700, ttc: 847, worksiteId: ids.b });
  const other = await mk({ docNumber: 'AUTRE-N', ht: 10, ttc: 12, worksiteId: ids.a });
  const tx = await prisma.bankTransaction.create({ data: { amount: -1210, bookingDate: new Date('2026-06-20'), side: 'out', counterpartyName: 'Sous-traitant Répartition Test', source: 'test' } });
  ids.tx.push(tx.id);
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, ledgerEntryId: l2.id, amount: 847 } });

  assert.equal((await call('POST', '/merge', { ids: [l1.id, other.id] })).status, 422, 'n° de facture différent');
  const list = await call('GET', `?contactId=${ids.c}`);
  assert.deepEqual(list.body.items.find((x: any) => x.id === l1.id).siblingIds, [l2.id], 'la liste signale la ligne sœur à fusionner');

  const dry = await call('POST', '/merge', { ids: [l1.id, l2.id], dryRun: true });
  assert.equal(dry.body.preview.ht, 1000); assert.equal(dry.body.preview.ttc, 1210);
  assert.equal(dry.body.preview.survivorId, l2.id, 'la ligne rapprochée à un paiement est conservée');
  assert.equal(await prisma.ledgerEntry.count({ where: { id: { in: [l1.id, l2.id] } } }), 2, 'dryRun ne modifie rien');

  const done = await call('POST', '/merge', { ids: [l1.id, l2.id] });
  assert.equal(done.status, 200);
  const merged = done.body.expense;
  assert.equal(merged.ht, 1000); assert.equal(merged.ttc, 1210);
  assert.deepEqual(merged.allocations.map((a: any) => [a.worksite.ref, a.ht]).sort(), [['R-ALLOCA', 300], ['R-ALLOCB', 700]]);
  assert.equal(await prisma.ledgerEntry.count({ where: { id: l1.id } }), 0, 'l’autre ligne a disparu');
  assert.equal(await prisma.bankTransactionMatch.count({ where: { ledgerEntryId: merged.id } }), 1, 'le rapprochement bancaire suit la fiche');
  assert.equal(Math.round((await material(ids.a!) - baseA) * 100) / 100, 310, 'chantier A : +300 (facture fusionnée) +10 (autre facture), sans doublon');
  assert.equal(Math.round((await material(ids.b!) - baseB) * 100) / 100, 700, 'chantier B : +700');
});

test('suppression d’une ligne de l’import Excel : confirmation exigée sans doublon, jamais si un paiement y est rapproché', async () => {
  const lonely = await mk({ docNumber: 'SEUL-1', ht: 40, ttc: 48, worksiteId: ids.a });
  assert.equal((await call('DELETE', `/${lonely.id}`)).status, 409, 'sans confirmation');
  assert.equal((await call('DELETE', `/${lonely.id}?force=1`)).status, 200, 'avec confirmation');
  assert.equal(await prisma.ledgerEntry.count({ where: { id: lonely.id } }), 0);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'expense.delete', entityId: lonely.id } }), 'la ligne supprimée est conservée dans le journal');

  const paid = await mk({ docNumber: 'PAYE-1', ht: 90, ttc: 108, worksiteId: ids.a });
  const tx = await prisma.bankTransaction.create({ data: { amount: -108, bookingDate: new Date('2026-06-21'), side: 'out', counterpartyName: 'Sous-traitant Répartition Test', source: 'test' } });
  ids.tx.push(tx.id);
  await prisma.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, ledgerEntryId: paid.id, amount: 108 } });
  assert.equal((await call('DELETE', `/${paid.id}?force=1`)).status, 409, 'rapprochée à un paiement : jamais supprimée');
});

test('lignes d’une même facture portant chacune un suffixe de bordereau (« 23/999001 - 111111 ») : détectées et fusionnables', async () => {
  const mkv = (suffix: string, ws: string, ht: number) => mk({ docNumber: `23/999001 - ${suffix}`, ht, ttc: Math.round(ht * 1.21 * 100) / 100, worksiteId: ws });
  const a = await mkv('111111', ids.a!, 100), b = await mkv('222222', ids.b!, 250);
  const autre = await mk({ docNumber: '23/999002 - 333333', ht: 40, ttc: 48.4, worksiteId: ids.a }); // une AUTRE facture
  const carte = await mk({ docNumber: '526548 - Carte 707881005600000001', ht: 10, ttc: 12, worksiteId: ids.a });
  const carte2 = await mk({ docNumber: '526548 - Carte 707881005600000001', ht: 12, ttc: 14.5, worksiteId: ids.b });

  const list = await call('GET', `?contactId=${ids.c}`);
  const sib = (id: string) => list.body.items.find((x: any) => x.id === id).siblingIds;
  assert.deepEqual(sib(a.id), [b.id], 'les deux lignes de la facture 23/999001 se reconnaissent malgré leur suffixe différent');
  assert.deepEqual(sib(autre.id), [], 'une autre facture n’est pas mélangée');
  assert.deepEqual(sib(carte.id).sort(), [carte2.id].sort(), 'même n° exact : toujours reconnu comme avant');

  assert.equal((await call('POST', '/merge', { ids: [a.id, autre.id] })).status, 422, 'deux factures différentes ne se fusionnent pas');
  const done = await call('POST', '/merge', { ids: [a.id, b.id] });
  assert.equal(done.status, 200);
  assert.equal(done.body.expense.docNumber, '23/999001', 'la fiche porte le n° de la facture');
  assert.match(done.body.expense.notes, /23\/999001 - 111111 \| 23\/999001 - 222222/, 'les n° d’origine restent lisibles dans les notes');
  assert.equal(done.body.expense.ht, 350);
  assert.equal(done.body.expense.allocations.length, 2);
});
