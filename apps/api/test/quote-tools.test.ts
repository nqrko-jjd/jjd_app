import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { estimateLots, scheduleLots, belgianHolidays, isWorkingDay, brusselsToDate, nextWorkingDay, type QuoteLine } from '../src/lib/quote-plan.js';
import { buildInternalItems, buildClientItems } from '../src/lib/purchase-list.js';

const L = (o: Partial<QuoteLine> & { label: string; totalHt: number }): QuoteLine => ({ kind: 'item', qty: 1, unit: 'ff', ...o });
const lines: QuoteLine[] = [
  { kind: 'section', label: 'Salle de bain', qty: 1, unit: null, totalHt: 0 },
  L({ label: 'Carrelage sol et mur', qty: 12, unit: 'm²', totalHt: 3800 }),  // 50 % main-d'œuvre = 1900 € = 5 j-homme
  L({ label: 'Main d’œuvre plomberie', qty: 16, unit: 'h', totalHt: 1000 }),   // 16 h = 2 j-homme
  L({ label: 'Option : meuble vasque', totalHt: 600 }),
  { kind: 'section', label: 'Toiture', qty: 1, unit: null, totalHt: 0 },
  L({ label: 'Étanchéité bicouche', qty: 40, unit: 'm²', totalHt: 760 }),     // 380 € main-d'œuvre = 1 j-homme
];
const P = { startDate: '2026-10-05', teamSize: 2, dayRate: 380, labourShare: 0.5 }; // lundi

test('estimation : part main-d’œuvre -> journées d’ouvrier -> jours d’équipe ; heures prises telles quelles ; options exclues', () => {
  const lots = estimateLots(lines, P);
  assert.equal(lots.length, 2);
  assert.equal(lots[0]!.title, 'Salle de bain');
  assert.equal(lots[0]!.manDays, 7);      // 5 + 2
  assert.equal(lots[0]!.days, 3.5);       // 7 j-homme / 2 ouvriers
  assert.equal(lots[0]!.budgetHt, 4800);  // option exclue
  assert.equal(lots[0]!.materialHt, 1900);
  assert.equal(lots[1]!.days, 0.5);       // 1 j-homme / 2 ouvriers = ½ jour
  assert.equal(estimateLots(lines, { ...P, teamSize: 1 })[0]!.days, 7);
});

test('planning : jours ouvrables, demi-journées, le lot suivant reprend l’après-midi', () => {
  const slots = scheduleLots(estimateLots(lines, P), P.startDate);
  assert.deepEqual(slots.map((s) => `${s.lot}|${s.date}|${s.start}-${s.end}`), [
    '1|2026-10-05|08:30-17:00', '1|2026-10-06|08:30-17:00', '1|2026-10-07|08:30-17:00', '1|2026-10-08|08:30-12:30',
    '2|2026-10-08|13:00-17:00',
  ]);
  // week-end sauté
  const long = scheduleLots([{ title: 'X', budgetHt: 1, labourHt: 1, materialHt: 0, manDays: 6, days: 6, items: [] }], '2026-10-05');
  assert.deepEqual(long.map((s) => s.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']);
});

test('jours fériés belges et heure de Bruxelles', () => {
  const h = belgianHolidays(2026);
  assert.ok(h.has('2026-04-06') && h.has('2026-05-14') && h.has('2026-05-25') && h.has('2026-07-21') && h.has('2026-11-11')); // lundi de Pâques, Ascension, lundi de Pentecôte
  assert.equal(isWorkingDay('2026-07-21'), false);
  assert.equal(isWorkingDay('2026-10-10'), false); // samedi
  assert.equal(nextWorkingDay('2026-07-21'), '2026-07-22');
  assert.equal(brusselsToDate('2026-10-05', '08:30').toISOString(), '2026-10-05T06:30:00.000Z'); // été : UTC+2
  assert.equal(brusselsToDate('2026-12-07', '08:30').toISOString(), '2026-12-07T07:30:00.000Z'); // hiver : UTC+1
});

test('listes : interne = fournitures (sans main-d’œuvre ni options), client = choix de produits par corps de métier', () => {
  const internal = buildInternalItems(lines);
  assert.deepEqual(internal.map((i) => i.label), ['Carrelage sol et mur', 'Étanchéité bicouche']);
  assert.equal(internal[0]!.estCostHt, 1900);
  assert.ok(internal.every((i) => i.status === 'todo' && i.supplier === ''));
  const client = buildClientItems(lines);
  assert.ok(client.some((c) => c.lot === 'Salle de bain' && c.label === 'Carrelage / faïence'));
  assert.ok(client.some((c) => c.lot === 'Toiture' && c.label === 'Toiture / étanchéité'));
  assert.ok(client.every((c) => c.clientChoice === null));
});

let server: Server;
let base = '';
let token = '';
const ids: { ws?: string; quote?: string; orphan?: string } = {};
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-QTTEST', title: 'Quote tools test', source: 'test' } })).id;
});
after(async () => {
  await prisma.planningEvent.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.purchaseList.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: ids.ws } } });
  await prisma.document.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});
const call = async (method: string, path: string, body?: unknown, auth = true) => {
  const r = await fetch(base + path, { method, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('API planning : aperçu, création « à confirmer », refus du doublon, remplacement, suppression', async () => {
  const q = await call('POST', '/api/documents', { kind: 'quote', worksiteId: ids.ws, lines: [
    { kind: 'section', label: 'Façade', qty: 1, unitPriceHt: 0, vatRate: 0.06 },
    { kind: 'item', label: 'Crépi de façade', qty: 50, unit: 'm²', unitPriceHt: 76, vatRate: 0.06 }, // 3800 € -> 1900 € main-d’œuvre -> 5 j-homme -> 2,5 j à deux
  ] });
  ids.quote = q.body.document.id;
  const pv = await call('POST', `/api/quote-tools/${ids.quote}/plan/preview`, { startDate: '2026-10-05' });
  assert.equal(pv.status, 200);
  assert.equal(pv.body.totalDays, 2.5);
  assert.equal(pv.body.slots.length, 3);
  assert.equal(pv.body.existing, 0);
  assert.equal(await prisma.planningEvent.count({ where: { worksiteId: ids.ws } }), 0, 'l’aperçu ne crée rien');

  const cr = await call('POST', `/api/quote-tools/${ids.quote}/plan/create`, { startDate: '2026-10-05' });
  assert.equal(cr.status, 201);
  const evs = await prisma.planningEvent.findMany({ where: { fromQuoteId: ids.quote }, orderBy: { startAt: 'asc' } });
  assert.equal(evs.length, 3);
  assert.ok(evs.every((e) => e.status === 'tentative' && e.kind === 'intervention' && e.googleEventId === null));
  assert.equal(evs[0]!.startAt.toISOString(), '2026-10-05T06:30:00.000Z');
  assert.match(evs[0]!.tasksNote ?? '', /Crépi de façade/);

  assert.equal((await call('POST', `/api/quote-tools/${ids.quote}/plan/create`, { startDate: '2026-10-05' })).status, 409);
  const again = await call('POST', `/api/quote-tools/${ids.quote}/plan/create`, { startDate: '2026-10-12', replace: true });
  assert.equal(again.status, 201);
  assert.equal(await prisma.planningEvent.count({ where: { fromQuoteId: ids.quote } }), 3, 'remplacé, pas doublé');
  assert.equal((await call('DELETE', `/api/quote-tools/${ids.quote}/plan`)).body.deleted, 3);
  assert.equal((await call('POST', `/api/quote-tools/${ids.quote}/plan/preview`, { teamSize: 0 })).status, 422);
});

test('API liste d’achats : génération, édition (réponses du client conservées), lien public sans fuite de prix, réponse du client', async () => {
  const g = await call('POST', `/api/purchase-lists/from-quote/${ids.quote}`, {});
  assert.equal(g.status, 201);
  const list = g.body.list;
  assert.equal(list.internalItems[0].label, 'Crépi de façade');
  assert.equal(list.internalItems[0].estCostHt, 1900);
  assert.equal((await call('POST', `/api/purchase-lists/from-quote/${ids.quote}`, {})).body.existing, true);

  // édition : produit proposé + fournisseur interne
  const client = list.clientItems.map((c: { id: string }, i: number) => ({ ...c, proposal: i === 0 ? 'Knauf Komfort-Wall — crépi gratté 1,5 mm' : '', priceTtc: i === 0 ? 62.5 : null, clientChoice: 'ok' }));
  const internal = list.internalItems.map((i: object) => ({ ...i, supplier: 'Bouwmat Wavre', status: 'ordered' }));
  const saved = await call('PUT', `/api/purchase-lists/${list.id}`, { internalItems: internal, clientItems: client });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.list.clientItems[0].clientChoice, null, 'le bureau ne peut pas répondre à la place du client');

  // lien public
  const sh = await call('POST', `/api/purchase-lists/${list.id}/share`, {});
  const tok = sh.body.token as string;
  assert.ok(tok.length >= 20);
  const pub = await call('GET', `/api/public/purchase-list/${tok}`, undefined, false);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.items.length, 1, 'seuls les produits réellement proposés sont visibles');
  const text = JSON.stringify(pub.body);
  assert.doesNotMatch(text, /Bouwmat|estCostHt|supplier|1900/, 'aucun prix de revient ni fournisseur côté client');
  const itemId = pub.body.items[0].id;
  assert.equal((await call('POST', `/api/public/purchase-list/${tok}/answer`, { itemId, choice: 'other' }, false)).status, 422, 'il faut préciser sa préférence');
  assert.equal((await call('POST', `/api/public/purchase-list/${tok}/answer`, { itemId, choice: 'other', comment: 'Plutôt blanc cassé' }, false)).status, 200);
  const back = await call('GET', `/api/purchase-lists/${list.id}`);
  assert.equal(back.body.list.clientItems[0].clientChoice, 'other');
  assert.equal(back.body.list.clientItems[0].clientComment, 'Plutôt blanc cassé');
  // une nouvelle édition par le bureau garde la réponse du client
  const re = await call('PUT', `/api/purchase-lists/${list.id}`, { clientItems: back.body.list.clientItems.map((c: object) => ({ ...c, detail: 'Détail relu' })) });
  assert.equal(re.body.list.clientItems[0].clientComment, 'Plutôt blanc cassé');
  // lien révoqué / jeton inconnu
  assert.equal((await call('GET', '/api/public/purchase-list/jetoninconnujetoninconnu', undefined, false)).status, 404);
  await call('DELETE', `/api/purchase-lists/${list.id}/share`);
  assert.equal((await call('GET', `/api/public/purchase-list/${tok}`, undefined, false)).status, 404);
});
