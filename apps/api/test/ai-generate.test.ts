import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { env } from '../src/env.js';
import { saveConfig, quota, EURO } from '../src/lib/assistant-quota.js';

let server: Server; let base = ''; let tokenDavid = ''; let tokenOffice = '';
const ids: { ws?: string; quote?: string } = {};
let creates = 0;
let nextText = '';
// on ne défait QUE nos propres simulations : la suite complète tourne en un seul processus (mock.restoreAll() casserait celles des autres fichiers)
let mine: { mock: { restore(): void } }[] = [];
const unmock = () => { for (const m of mine) m.mock.restore(); mine = []; };
const reply = (text: string) => ({ id: 'fake', type: 'message', role: 'assistant', model: 'claude-test', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const login = async (email: string) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'jjd' }) })).json()).token as string;
  tokenDavid = await login('david@jjd-consult.be');
  tokenOffice = await login('melvina@jjd-consult.be');
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-AITEST', title: 'IA test', source: 'test' } })).id;
  const q = await call(tokenDavid, 'POST', '/api/documents', { kind: 'quote', worksiteId: ids.ws, lines: [
    { kind: 'section', label: 'Salle de bain', qty: 1, unitPriceHt: 0, vatRate: 0.06 },
    { kind: 'item', label: 'Carrelage sol et mur', description: '<ul><li>Dépose</li><li>Pose</li></ul>', qty: 12, unit: 'm²', unitPriceHt: 316.67, vatRate: 0.06 },
    { kind: 'item', label: 'Main d’œuvre plomberie', qty: 16, unit: 'h', unitPriceHt: 62.5, vatRate: 0.06 },
    { kind: 'section', label: 'Toiture', qty: 1, unitPriceHt: 0, vatRate: 0.06 },
    { kind: 'item', label: 'Étanchéité bicouche', qty: 40, unit: 'm²', unitPriceHt: 19, vatRate: 0.06 },
  ] });
  ids.quote = q.body.document.id;
});
after(async () => {
  unmock();
  env.anthropicApiKey = '';
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'assistant:v1:' } } });
  await prisma.auditLog.deleteMany({ where: { entity: { in: ['scopeDoc', 'AssistantRequest'] } } });
  await prisma.scopeDoc.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.purchaseList.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: ids.ws } } });
  await prisma.document.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
async function arm() {
  env.anthropicApiKey = 'test-not-a-real-key';
  const david = await prisma.user.findUniqueOrThrow({ where: { email: 'david@jjd-consult.be' } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'assistant:v1:' } } });
  await saveConfig(david as never, { enabled: true, globalMonthlyMicro: 5 * EURO, directionMonthlyMicro: 5 * EURO, pricing: { model: 'claude-test', inputUsdPerMillion: 3, outputUsdPerMillion: 15, eurPerUsd: 1 } });
  unmock();
  mine = [
    mock.method(Anthropic.Messages.prototype, 'countTokens', async () => ({ input_tokens: 1000 })),
    mock.method(Anthropic.Messages.prototype, 'create', async () => { creates++; return reply(nextText) as never; }),
  ];
  return david;
}
const cdcAi = (lots = 2) => JSON.stringify({
  context: 'Rénovation de la salle de bain et de la toiture, à la demande du maître d’ouvrage, selon le devis.',
  hypotheses: ['Le support est sain.', 'Accès libre au chantier.'],
  lots: [
    { description: 'Salle de bain complète.', works: [{ id: '1.1', details: ['Dépose de l’ancien carrelage', 'Pose en quinconce, joints époxy'] }, { id: '1.2', details: ['Remplacement des alimentations'] }], products: [{ item: 'Carrelage sol', spec: 'Prévu au devis ; à choisir : format et teinte' }], included: ['Dépose et évacuation', 'Fourniture et pose du carrelage', 'Joints', 'Nettoyage'], excluded: ['Meuble vasque'] },
    { description: 'Étanchéité de la toiture plate.', works: [{ id: '2.1', details: ['Nettoyage du support', 'Pose de deux couches'] }], products: [], included: ['Fourniture et pose de l’étanchéité', 'Relevés', 'Évacuation'], excluded: ['Isolation'] },
  ].slice(0, lots),
  generalExclusions: ['Permis d’urbanisme'], execution: ['Protection des sols des pièces voisines'], planning: 'La salle de bain d’abord, puis la toiture.',
});
const purchaseAi = () => JSON.stringify({
  items: [
    { lot: 1, label: 'Carrelage grès cérame 60×60', qty: 13, unit: 'm²', estCostHt: 1500, note: '' },
    { lot: 1, label: 'Colle flexible', qty: 6, unit: 'sac', estCostHt: 400, note: '' },
    { lot: 1, label: 'Joints époxy', qty: 4, unit: 'kg', estCostHt: 300, note: 'quantité à confirmer sur place' },
  ],
  client: [{ lot: 1, label: 'Carrelage sol et mur', detail: 'Prévu au devis. À choisir : format, teinte, joints.' }],
});

test('IA : cahier des charges rédigé par l’IA, coût comptabilisé, structure conservée', async () => {
  const david = await arm();
  nextText = cdcAi();
  const r = await call(tokenDavid, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(r.status, 201); assert.equal(r.body.ai.used, true); assert.ok(r.body.ai.costEuro > 0);
  const sec = r.body.cdc.content.sections as { title: string; blocks: { type: string; items?: string[]; text?: string; rows?: string[][] }[] }[];
  const lot1 = sec.find((s) => s.title.startsWith('Lot 1'))!;
  const flat = JSON.stringify(lot1);
  assert.match(flat, /Pose en quinconce, joints époxy/); assert.match(flat, /Dépose et évacuation/); assert.match(flat, /Meuble vasque/);
  assert.ok(sec.find((s) => s.title === 'Planning prévisionnel')!.blocks.some((b) => b.type === 'table'), 'durées estimées par lot');
  assert.match(JSON.stringify(sec.find((s) => s.title === 'Ce qui n’est pas compris dans l’offre')), /Permis d’urbanisme/);
  assert.doesNotMatch(JSON.stringify(sec), /Cuisine : meubles/, 'plus de choix de produits hors devis');
  const q = await quota(david as never);
  assert.ok(q.spentEuro > 0, 'le coût réel est enregistré sur le budget');
});

test('IA : réponse qui ne correspond pas au devis, JSON illisible, réservé à la direction -> génération de base, jamais d’échec', async () => {
  await arm();
  nextText = cdcAi(1); // 1 lot au lieu de 2
  const wrong = await call(tokenDavid, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(wrong.status, 201); assert.equal(wrong.body.ai.used, false); assert.match(wrong.body.ai.reason, /lots du devis/);
  assert.ok(wrong.body.cdc.content.sections.length > 5, 'cahier de base créé quand même');

  nextText = 'Désolé, voici le texte sans JSON {';
  const bad = await call(tokenDavid, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(bad.status, 201); assert.equal(bad.body.ai.used, false); assert.match(bad.body.ai.reason, /illisible|format/);

  const before = creates;
  nextText = cdcAi();
  const office = await call(tokenOffice, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(office.status, 201); assert.equal(office.body.ai.used, false); assert.match(office.body.ai.reason, /réservée à la direction/);
  assert.equal(creates, before, 'aucun appel payant pour un compte hors direction');

  const off = await call(tokenDavid, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true, ai: false });
  assert.equal(off.body.ai.used, false);
});

test('IA : sans clé ou budgets non confirmés -> génération de base avec la raison', async () => {
  env.anthropicApiKey = '';
  const a = await call(tokenDavid, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(a.status, 201); assert.match(a.body.ai.reason, /pas configurée/);
  env.anthropicApiKey = 'x';
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'assistant:v1:' } } });
  const b = await call(tokenDavid, 'POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(b.status, 201); assert.match(b.body.ai.reason, /attente d’activation/);
  env.anthropicApiKey = '';
});

test('IA : liste d’achats concrète, ramenée au budget du devis par lot, repli sur la base pour un lot sans réponse', async () => {
  await arm();
  nextText = purchaseAi();
  const r = await call(tokenDavid, 'POST', `/api/purchase-lists/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(r.status, 201); assert.equal(r.body.ai.used, true);
  const items = r.body.list.internalItems as { lot: string; label: string; estCostHt: number; note: string }[];
  const lot1 = items.filter((i) => i.lot === 'Salle de bain');
  assert.equal(lot1.length, 3, 'articles concrets au lieu d’une ligne recopiée');
  const sum = lot1.reduce((s, i) => s + i.estCostHt, 0);
  assert.ok(sum <= 1900.02 && sum > 1899.9, `somme du lot ramenée exactement au budget fournitures (1 900,02 €) : ${sum}`);
  assert.ok(lot1.every((i) => /ajustée au budget/.test(i.note)));
  assert.ok(items.some((i) => i.lot === 'Toiture' && i.label === 'Étanchéité bicouche'), 'lot sans réponse IA : ligne de base conservée');
  assert.equal(r.body.list.clientItems.length, 1); assert.equal(r.body.list.clientItems[0].label, 'Carrelage sol et mur');

  nextText = 'pas de json';
  const bad = await call(tokenDavid, 'POST', `/api/purchase-lists/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(bad.status, 201); assert.equal(bad.body.ai.used, false); assert.ok(bad.body.list.internalItems.length >= 2);
});
