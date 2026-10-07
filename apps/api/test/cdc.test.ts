import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { buildCdc, cdcToDocx, cdcToHtml, htmlToText, todoCount, type CdcInput } from '../src/lib/cdc.js';

const input: CdcInput = {
  worksite: { ref: 'R-999', title: 'Tervuren - Test', address: 'Rue Haute 1', postalCode: '3080', city: 'Tervuren' },
  client: { name: 'Jean Test', address: 'Rue Basse 2', postalCode: '1000', city: 'Bruxelles' },
  quote: {
    number: 'D2026-123', issuedOn: new Date('2026-09-01T10:00:00Z'), totalHt: 18500, title: 'Rénovation',
    lines: [
      { kind: 'section', label: 'Salle de bain', description: null, qty: 1, unit: null, totalHt: 0 },
      { kind: 'item', label: 'Carrelage sol et mur', description: '<p>Pose de carrelage 60x60<br>joints gris</p>', qty: 12, unit: 'm²', totalHt: 1200 },
      { kind: 'item', label: 'Installation douche italienne', description: null, qty: 1, unit: 'forfait', totalHt: 1800 },
      { kind: 'item', label: 'Option : meuble vasque', description: null, qty: 1, unit: 'pce', totalHt: 600 },
      { kind: 'section', label: 'Toiture', description: null, qty: 1, unit: null, totalHt: 0 },
      { kind: 'text', label: 'Remarque', description: 'Toiture plate en deux zones', qty: 1, unit: null, totalHt: 0 },
      { kind: 'item', label: 'Étanchéité bicouche', description: null, qty: 40, unit: 'm²', totalHt: 4400 },
    ],
  },
};

test('génération : sections standard, un lot par section du devis, produits à valider et exclusions par métier', () => {
  const c = buildCdc(input);
  const titles = c.sections.map((s) => s.title);
  assert.deepEqual(titles.slice(0, 4), ['Contexte et objet du dossier', 'Documents de référence', 'Bases techniques et règles de mise en œuvre', 'Prise en compte de l’existant et hypothèses']);
  assert.ok(titles.includes('Lot 1 — Salle de bain') && titles.includes('Lot 2 — Toiture'));
  assert.deepEqual(titles.slice(-5), ['Ce qui n’est pas compris dans l’offre', 'Choix des produits et finitions à valider', 'Conditions d’exécution et limites', 'Planning prévisionnel', 'Validation']);
  const lot1 = JSON.stringify(c.sections.find((s) => s.title === 'Lot 1 — Salle de bain'));
  assert.match(lot1, /Carrelage sol et mur/);
  assert.match(lot1, /joints gris/, 'les précisions saisies au devis sont reprises');
  assert.match(lot1, /au-delà du prix au m²/, 'exclusion carrelage');
  assert.match(lot1, /Sanitaire : marque, modèle/, 'choix sanitaire à valider');
  const lot2 = JSON.stringify(c.sections.find((s) => s.title === 'Lot 2 — Toiture'));
  assert.match(lot2, /Toiture plate en deux zones/);
  assert.match(lot2, /charpente, panneaux de support/);
  // l'option n'est pas « comprise » : elle est listée dans les exclusions
  assert.doesNotMatch(JSON.stringify(c.sections.find((s) => s.title === 'Lot 1 — Salle de bain')!.blocks.filter((b) => b.type === 'table')), /meuble vasque/);
  assert.match(JSON.stringify(c.sections.find((s) => s.title === 'Ce qui n’est pas compris dans l’offre')), /Option non retenue.*meuble vasque/);
  assert.ok(todoCount(c) >= 5, 'des points à compléter sont signalés');
  assert.equal(c.meta.reference, 'R-999');
  assert.match(c.meta.quoteRef, /D2026-123/);
});

test('devis sans section : un lot « Travaux » unique', () => {
  const c = buildCdc({ ...input, quote: { ...input.quote, lines: [{ kind: 'item', label: 'Peinture murs', description: null, qty: 30, unit: 'm²', totalHt: 600 }] } });
  assert.ok(c.sections.some((s) => s.title === 'Lot 1 — Travaux'));
});

test('htmlToText : paragraphes et sauts de ligne conservés, balises retirées', () => {
  assert.equal(htmlToText('<p>Un</p><p>Deux<br>Trois &amp; quatre</p>'), 'Un\nDeux\nTrois & quatre');
  assert.equal(htmlToText(null), '');
});

test('rendus : HTML avec points à compléter surlignés ; DOCX = archive Word bien formée', () => {
  const c = buildCdc(input);
  const html = cdcToHtml(c, { name: 'JJD Consult SRL', email: 'info@jjd-consult.be' });
  assert.match(html, /<mark>\[À compléter/);
  assert.match(html, /CAHIER DES CHARGES/);
  const files = unzipSync(cdcToDocx(c, { name: 'JJD Consult SRL' }));
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  const doc = strFromU8(files['word/document.xml']!);
  assert.match(doc, /Lot 1 — Salle de bain/);
  assert.match(doc, /<w:tbl>/);
  // balises équilibrées (document bien formé)
  const opens = (doc.match(/<w:(p|tbl|tr|tc|r)[ >]/g) ?? []).length;
  const closes = (doc.match(/<\/w:(p|tbl|tr|tc|r)>/g) ?? []).length;
  assert.equal(opens, closes);
});

let server: Server;
let base = '';
let token = '';
const ids: { ws?: string; contact?: string; quote?: string } = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.contact = (await prisma.contact.create({ data: { name: 'Client CDC test', normalizedName: 'client cdc test', type: 'client', address: 'Rue X 1', postalCode: '1000', city: 'Bruxelles' } })).id;
  ids.ws = (await prisma.worksite.create({ data: { ref: 'R-CDCTEST', title: 'CDC test', clientId: ids.contact, address: 'Rue Y 2', postalCode: '1300', city: 'Wavre', source: 'test' } })).id;
});
after(async () => {
  await prisma.scopeDoc.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.documentLine.deleteMany({ where: { document: { worksiteId: ids.ws } } });
  await prisma.document.deleteMany({ where: { worksiteId: ids.ws } });
  await prisma.worksite.deleteMany({ where: { id: ids.ws } });
  await prisma.contact.deleteMany({ where: { id: ids.contact } });
  server.close();
});
const H = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: H(), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('API : génération depuis un devis, réutilisation, nouvelle version, édition, statut, export Word', async () => {
  const q = await call('POST', '/api/documents', { kind: 'quote', worksiteId: ids.ws, contactId: ids.contact, lines: [
    { kind: 'section', label: 'Façade', qty: 1, unitPriceHt: 0, vatRate: 0.06 },
    { kind: 'item', label: 'Crépi de façade', qty: 50, unit: 'm²', unitPriceHt: 60, vatRate: 0.06 },
  ] });
  ids.quote = q.body.document.id;
  // un devis sans chantier est refusé
  const orphan = await call('POST', '/api/documents', { kind: 'quote', lines: [{ label: 'Peinture', qty: 1, unitPriceHt: 100, vatRate: 0.21 }] });
  assert.equal((await call('POST', `/api/cdc/from-quote/${orphan.body.document.id}`, {})).status, 422);

  const g = await call('POST', `/api/cdc/from-quote/${ids.quote}`, {});
  assert.equal(g.status, 201);
  assert.equal(g.body.cdc.content.meta.reference, 'R-CDCTEST');
  assert.ok(g.body.cdc.content.sections.some((s: { title: string }) => s.title === 'Lot 1 — Façade'));
  assert.ok(g.body.cdc.todo > 0);
  const again = await call('POST', `/api/cdc/from-quote/${ids.quote}`, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.existing, true);
  assert.equal(again.body.cdc.id, g.body.cdc.id);
  const fresh = await call('POST', `/api/cdc/from-quote/${ids.quote}`, { fresh: true });
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.cdc.id, g.body.cdc.id);
  assert.equal((await call('GET', `/api/cdc?quoteId=${ids.quote}`)).body.items.length, 2);

  // édition : un paragraphe modifié, statut validé
  const content = g.body.cdc.content;
  content.sections[0].blocks[0] = { type: 'p', text: 'Contexte réécrit à la main.' };
  const saved = await call('PUT', `/api/cdc/${g.body.cdc.id}`, { content, status: 'validated' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.cdc.status, 'validated');
  assert.equal((await call('GET', `/api/cdc/${g.body.cdc.id}`)).body.cdc.content.sections[0].blocks[0].text, 'Contexte réécrit à la main.');
  assert.equal((await call('PUT', `/api/cdc/${g.body.cdc.id}`, { content: { meta: {}, sections: 'x' } })).status, 422);

  const docx = await fetch(`${base}/api/cdc/${g.body.cdc.id}/docx`, { headers: H() });
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get('content-type') ?? '', /wordprocessingml/);
  const files = unzipSync(new Uint8Array(await docx.arrayBuffer()));
  assert.match(strFromU8(files['word/document.xml']!), /Contexte réécrit à la main/);
});

test('règles par métier : mots entiers seulement (« isolation » n’est pas un sol, « reprise » n’est pas une prise électrique)', () => {
  const only = (label: string) => JSON.stringify(buildCdc({ ...input, quote: { ...input.quote, lines: [{ kind: 'item', label, description: null, qty: 1, unit: 'ff', totalHt: 100 }] } }).sections.find((s) => s.title.startsWith('Lot 1')));
  assert.doesNotMatch(only('Isolation de la cave'), /Revêtement de sol/);
  assert.doesNotMatch(only('Reprise de maçonnerie'), /Électricité|appareillage/);
  assert.match(only('Pose de prises et interrupteurs'), /appareillage/);
  assert.match(only('Parquet du séjour'), /Revêtement de sol/);
});
