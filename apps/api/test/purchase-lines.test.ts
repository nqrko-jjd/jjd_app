import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { UPLOADS_DIR } from '../src/lib/media.js';
import { pdftotextAvailable } from '../src/lib/bank-pdf.js';

/** PDF minimal (une page, texte Helvetica) : une ligne de texte par entrée. */
function textPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = 'BT /F1 10 Tf 40 780 Td 14 TL\n' + lines.map((l) => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

let server: Server; let base = ''; let token = '';
const ids: { c?: string; e: string[] } = { e: [] };
const FILES = ['test-lines-a.pdf', 'test-lines-b.pdf', 'test-lines-c.pdf'];
const get = async (p: string) => (await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (p: string, body: object = {}) => (await fetch(`${base}${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'melvina@jjd-consult.be', password: 'jjd' }) })).json()).token;
  ids.c = (await prisma.contact.create({ data: { name: 'Grossiste Lignes Test', normalizedName: 'grossiste lignes test', type: 'supplier' } })).id;
  mkdirSync(path.join(UPLOADS_DIR, 'expenses'), { recursive: true });
  const header = ['FACTURE FOURNISSEUR', 'Adresse : Rue de la Loi 16 1000 Bruxelles'];
  writeFileSync(path.join(UPLOADS_DIR, 'expenses', FILES[0]!), textPdf([...header, '2 PINCEAU ROND N 8 P 1 100,00 -15 85,00 21%', '3 RACLETTE METAL 45CM P 4 2,50 10,00 21%', 'Total HTVA 95,00']));
  writeFileSync(path.join(UPLOADS_DIR, 'expenses', FILES[1]!), textPdf([...header, '2 PINCEAU ROND N 8 P 2 110,00 220,00 21%', 'Total HTVA 220,00']));
  writeFileSync(path.join(UPLOADS_DIR, 'expenses', FILES[2]!), textPdf(['x'])); // trop peu de texte : « illisible » (scan)
  const mk = async (file: string, docNumber: string, date: string) => { const e = await prisma.ledgerEntry.create({ data: { source: 'test-lines', year: 2026, direction: 'purchase', docNumber, contactId: ids.c, supplierName: 'Grossiste Lignes Test', ht: 100, ttc: 121, pdfPath: `expenses/${file}`, date: new Date(date) } as never }); ids.e.push(e.id); return e; };
  await mk(FILES[0]!, 'L-1', '2026-03-10'); await mk(FILES[1]!, 'L-2', '2026-05-12'); await mk(FILES[2]!, 'L-3', '2026-05-20');
});
after(async () => {
  await prisma.purchaseLine.deleteMany({ where: { ledgerEntryId: { in: ids.e } } });
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: ids.e } } });
  await prisma.contact.deleteMany({ where: { id: ids.c } });
  for (const f of FILES) rmSync(path.join(UPLOADS_DIR, 'expenses', f), { force: true });
  server.close();
});

test('lecture des PDF d’achat par lots, puis articles regroupés avec prix mini / maxi / dernier prix', async (t) => {
  if (!(await pdftotextAvailable())) return t.skip('pdftotext absent');
  // on ne lit ici que nos 3 PDF : les autres écritures de la base de test n'ont pas de PDF
  const r = await post('/api/finance/expenses/scan-lines', { timeBudgetMs: 5000 });
  assert.ok(r.scanned >= 3, `scanned=${r.scanned}`);
  assert.equal(r.remaining, 0, 'tout est lu');

  const stats = await get('/api/finance/expenses/lines/stats');
  assert.ok(stats.withLines >= 2 && stats.unreadable >= 1, JSON.stringify(stats));
  const L3 = await prisma.ledgerEntry.findFirst({ where: { id: { in: ids.e }, docNumber: 'L-3' }, select: { linesScanStatus: true } });
  assert.equal(L3!.linesScanStatus, 'unreadable', 'PDF sans texte : signalé illisible, pas de ligne inventée');

  const list = await get(`/api/finance/expenses/lines/articles?contactId=${ids.c}`);
  const pinceau = (list.items as { label: string; purchases: number; qty: number; totalHt: number; minPrice: number; maxPrice: number; lastPrice: number; key: string }[]).find((a) => a.label.startsWith('PINCEAU'))!;
  assert.equal(pinceau.purchases, 2); assert.equal(pinceau.qty, 3); assert.equal(pinceau.totalHt, 305);
  assert.equal(pinceau.minPrice, 85, 'premier achat : 100 € − 15 %'); assert.equal(pinceau.maxPrice, 110); assert.equal(pinceau.lastPrice, 110, 'dernier prix = achat le plus récent');
  assert.equal((list.items as unknown[]).length, 2, 'le total, l’adresse et les en-têtes ne sont pas des articles');
  assert.equal(list.totals.spendHt, 315);

  const only = await get(`/api/finance/expenses/lines/articles?contactId=${ids.c}&from=2026-05-01&to=2026-05-31`);
  assert.equal((only.items as unknown[]).length, 1, 'filtre de période');
  const found = await get(`/api/finance/expenses/lines/articles?contactId=${ids.c}&q=raclette`);
  assert.equal((found.items as unknown[]).length, 1, 'recherche sans tenir compte de la casse');

  const occ = await get(`/api/finance/expenses/lines/article?key=${encodeURIComponent(pinceau.key)}&contactId=${ids.c}`);
  assert.equal(occ.items.length, 2); assert.equal(occ.items[0].docNumber, 'L-2', 'du plus récent au plus ancien');

  // relancer ne relit rien : le résultat est conservé
  const again = await post('/api/finance/expenses/scan-lines', { timeBudgetMs: 3000 });
  assert.equal(again.scanned, 0);
});

test('PDF remplacé sur un achat déjà lu : les anciennes lignes sont effacées et le nouveau PDF est relu', async (t) => {
  if (!(await pdftotextAvailable())) return t.skip('pdftotext absent');
  const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: { in: ids.e }, docNumber: 'L-2' } });
  const header = ['FACTURE FOURNISSEUR', 'Adresse : Rue de la Loi 16 1000 Bruxelles'];
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(textPdf([...header, '5 ROULEAU LAINE 18CM P 3 4,00 12,00 21%', 'Total HTVA 12,00']))], { type: 'application/pdf' }), 'nouveau.pdf');
  const up = await fetch(`${base}/api/finance/expenses/${entry.id}/pdf`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  assert.equal(up.status, 201);
  const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { linesScannedAt: true, linesScanStatus: true } });
  assert.equal(after.linesScannedAt, null, 'à relire');
  assert.equal(await prisma.purchaseLine.count({ where: { ledgerEntryId: entry.id } }), 0, 'anciennes lignes effacées');
  const r = await post('/api/finance/expenses/scan-lines', { timeBudgetMs: 5000 });
  assert.ok(r.scanned >= 1);
  const lines = await prisma.purchaseLine.findMany({ where: { ledgerEntryId: entry.id } });
  assert.deepEqual(lines.map((l) => l.label), ['ROULEAU LAINE 18CM']);
  // nettoyage du fichier déposé par l'envoi
  await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { pdfPath: `expenses/${FILES[1]}` } });
});

test('masquer un article, ou tout un fournisseur (forfaits, services…) : il disparaît de la liste, réversible, sans rien supprimer', async (t) => {
  if (!(await pdftotextAvailable())) return t.skip('pdftotext absent');
  await post('/api/finance/expenses/scan-lines', { timeBudgetMs: 5000 });
  const list = async () => (await get(`/api/finance/expenses/lines/articles?contactId=${ids.c}`)).items as { key: string; label: string; supplierRefs: { id: string | null; name: string }[] }[];
  const before = await list();
  const pinceau = before.find((a) => a.label.startsWith('PINCEAU'))!;
  assert.equal(pinceau.supplierRefs[0]!.id, ids.c, 'l’identifiant du fournisseur est fourni pour pouvoir le masquer');

  await post('/api/finance/expenses/lines/hide', { articles: [{ key: pinceau.key, label: pinceau.label }] });
  assert.ok(!(await list()).some((a) => a.key === pinceau.key), 'article masqué');
  assert.equal((await get('/api/finance/expenses/lines/hidden')).articles.length, 1);
  assert.ok(await prisma.purchaseLine.count({ where: { articleKey: pinceau.key } }) > 0, 'les lignes lues sont conservées');

  await post('/api/finance/expenses/lines/hide', { articles: [{ key: pinceau.key, label: pinceau.label }], show: true });
  assert.ok((await list()).some((a) => a.key === pinceau.key), 'article réaffiché');

  await post('/api/finance/expenses/lines/hide', { suppliers: [{ id: ids.c!, name: 'Grossiste Lignes Test' }] });
  assert.equal((await list()).length, 0, 'tous les articles du fournisseur masqué disparaissent');
  await post('/api/finance/expenses/lines/hide', { suppliers: [{ id: ids.c!, name: 'Grossiste Lignes Test' }], show: true });
  assert.ok((await list()).length >= 2, 'fournisseur réaffiché');
  await prisma.setting.deleteMany({ where: { key: 'purchaseLinesHidden' } });
});
