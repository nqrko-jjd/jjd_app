import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { descriptionPoints } from '../src/lib/quote-detail.js';
import { estimateLots, scheduleLots, type QuoteLine } from '../src/lib/quote-plan.js';

test('points de travail tirés de la description HTML d’un poste de devis', () => {
  const html = 'Démontage plafond hall/mezzanine<br />Démontage de la mezzanine<br /><br />Création d&#39;une baie pour accès au grenier<br />- Fourniture et pose de 2 portes&nbsp;à peindre<br />Démontage de la mezzanine';
  assert.deepEqual(descriptionPoints(html), ['Démontage plafond hall/mezzanine', 'Démontage de la mezzanine', "Création d'une baie pour accès au grenier", 'Fourniture et pose de 2 portes à peindre']);
  assert.deepEqual(descriptionPoints(null), []);
  assert.deepEqual(descriptionPoints('<p>Un</p><ul><li>Deux</li><li>Trois</li></ul>'), ['Un', 'Deux', 'Trois']);
});

const item = (label: string, totalHt: number, description: string | null = null): QuoteLine => ({ kind: 'item', label, description, qty: 1, unit: null, totalHt });
test('planning proposé : un devis rédigé par pièces (une seule section) donne un lot par poste, pas deux énormes barres', () => {
  const lines: QuoteLine[] = [
    item('Installation de chantier', 4270), item('Grenier', 74680, 'Démontage plafond<br />Pose de 2 portes'), item('Hall', 13505), item('Chambre', 4850), item('SDB', 5980),
    { kind: 'section', label: 'Extérieur', qty: 1, unit: null, totalHt: 0 }, item('Isolation par l’extérieur', 16960), item('Terrasse', 3685),
  ];
  const lots = estimateLots(lines, { startDate: '2026-11-02', teamSize: 2, dayRate: 380, labourShare: 0.5 });
  assert.deepEqual(lots.map((l) => l.title), ['Installation de chantier', 'Grenier', 'Hall', 'Chambre', 'SDB', 'Isolation par l’extérieur', 'Terrasse']);
  assert.deepEqual(lots[1]!.items, ['Démontage plafond', 'Pose de 2 portes'], 'le détail du créneau vient de la description');
  assert.ok(scheduleLots(lots, '2026-11-02').length > 7);
});
test('planning proposé : un devis structuré en sections reste découpé par section', () => {
  const sec = (t: string): QuoteLine => ({ kind: 'section', label: t, qty: 1, unit: null, totalHt: 0 });
  const lines = [sec('Démolition'), item('a', 1000), item('b', 1000), sec('Gros œuvre'), item('c', 1000), item('d', 1000), sec('Finitions'), item('e', 1000), sec('Extérieur'), item('f', 1000)];
  assert.deepEqual(estimateLots(lines, { startDate: '2026-11-02', teamSize: 2, dayRate: 380, labourShare: 0.5 }).map((l) => l.title), ['Démolition', 'Gros œuvre', 'Finitions', 'Extérieur']);
});

let server: Server; let base = ''; let token = ''; const ids: { ws?: string; doc?: string } = {};
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-QDET', title: 'Chantier détail devis', source: 'test' } })).id;
  const d = await prisma.document.create({ data: { kind: 'quote', direction: 'sale', number: 'D9999-QD', status: 'accepted', worksiteId: ids.ws, totalHt: 100, totalVat: 0, totalTtc: 100, source: 'test-qd',
    lines: { create: [
      { kind: 'item', position: 0, label: 'Grenier', description: 'Démontage plafond<br />Pose de 2 portes', qty: 1, unitPriceHt: 50, totalHt: 50 },
      { kind: 'section', position: 1, label: 'Extérieur', qty: 1, unitPriceHt: 0, totalHt: 0 },
      { kind: 'item', position: 2, label: 'Terrasse', description: null, qty: 1, unitPriceHt: 50, totalHt: 50 },
    ] } }, include: { lines: true } });
  ids.doc = d.id;
});
after(async () => {
  await prisma.worksiteTask.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.worksiteTaskPhase.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.document.deleteMany({ where: { id: ids.doc } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  server.close();
});

test('tâches depuis le devis : liste à cocher issue de la description, phase = section, et une 2e fois complète sans dupliquer', async () => {
  const lines = await prisma.documentLine.findMany({ where: { documentId: ids.doc! } });
  const call = async (lineIds: string[]) => (await fetch(`${base}/api/documents/${ids.doc}/tasks-from-lines`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ lineIds }) })).json();
  // une tâche existe déjà pour « Grenier » (créée avant), sans liste
  await prisma.worksiteTask.create({ data: { worksiteId: ids.ws!, title: 'Grenier', source: 'quote' } });
  const r = await call(lines.map((l) => l.id));
  assert.equal(r.created, 1, 'Terrasse créée');
  assert.equal(r.updated, 1, 'Grenier complétée');
  const tasks = await prisma.worksiteTask.findMany({ where: { worksiteId: ids.ws! }, include: { phase: true } });
  assert.equal(tasks.length, 2, 'aucun doublon');
  const grenier = tasks.find((t) => t.title === 'Grenier')!;
  assert.deepEqual(grenier.checklist, [{ label: 'Démontage plafond', done: false }, { label: 'Pose de 2 portes', done: false }]);
  assert.equal(tasks.find((t) => t.title === 'Terrasse')!.phase?.name, 'Extérieur');
  const again = await call(lines.map((l) => l.id));
  assert.equal(again.created, 0); assert.equal(again.updated, 0);
});
