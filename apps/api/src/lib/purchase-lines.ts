/**
 * Lecture des lignes d'article des PDF d'achat, par LOTS (jamais tout d'un coup : une requête web ne doit pas dépasser une minute) et
 * enregistrée en base (PurchaseLine) pour ne pas relire les PDF à chaque affichage. Voir purchase-line-parse.ts pour la lecture d'une ligne.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { UPLOADS_DIR } from './media.js';
import { pdfToRawText, pdftotextAvailable } from './bank-pdf.js';
import { HttpError } from './http.js';
import { insensitive } from './search.js';
import { parseLineItems, articleKey } from './purchase-line-parse.js';

const DIRECTIONS = ['purchase', 'delivery_slip'];
const resolveUpload = (rel: string) => path.join(UPLOADS_DIR, path.normalize(rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/')));
const READABLE_MIN_CHARS = 60;  // en dessous : PDF scanné / photo, pas de texte à lire

export interface ScanResult { scanned: number; linesFound: number; unreadable: number; remaining: number; total: number }

/** Lit les lignes du PDF d'UNE écriture et remplace ce qui avait été lu avant. */
export async function scanEntryLines(entry: { id: string; contactId: string | null; pdfPath: string | null }): Promise<{ status: 'lines' | 'none' | 'unreadable' | 'missing'; lines: number }> {
  let status: 'lines' | 'none' | 'unreadable' | 'missing' = 'unreadable';
  let rows: ReturnType<typeof parseLineItems> = [];
  const file = entry.pdfPath ? resolveUpload(entry.pdfPath) : null;
  if (!file || !existsSync(file)) status = 'missing';
  else {
    try {
      const text = await pdfToRawText(await readFile(file));
      if (text.replace(/\s+/g, '').length >= READABLE_MIN_CHARS) {
        rows = parseLineItems(text);
        status = rows.length ? 'lines' : 'none';
      }
    } catch { status = 'unreadable'; }
  }
  await prisma.$transaction([
    prisma.purchaseLine.deleteMany({ where: { ledgerEntryId: entry.id } }),
    ...(rows.length ? [prisma.purchaseLine.createMany({
      data: rows.map((r, i) => ({
        ledgerEntryId: entry.id, position: i, code: r.code, label: r.label, articleKey: articleKey(r, entry.contactId),
        qty: r.qty, unit: r.unit, unitPriceHt: r.unitPriceHt, discountPct: r.discountPct, totalHt: r.totalHt,
      })),
    })] : []),
    prisma.ledgerEntry.update({ where: { id: entry.id }, data: { linesScannedAt: new Date(), linesScanStatus: status } }),
  ]);
  return { status, lines: rows.length };
}

const toScan = { direction: { in: DIRECTIONS }, pdfPath: { not: null }, source: { not: 'demo' } } as const;

/** Traite des PDF pas encore lus jusqu'à épuisement du temps imparti (≈ 20 s) ; à rappeler tant que `remaining` > 0. */
export async function scanLinesBatch(opts: { timeBudgetMs?: number; rescan?: boolean } = {}): Promise<ScanResult> {
  if (!(await pdftotextAvailable())) throw new HttpError(503, 'La lecture des PDF n’est pas disponible sur le serveur (pdftotext manquant).');
  if (opts.rescan) {
    await prisma.purchaseLine.deleteMany({});
    await prisma.ledgerEntry.updateMany({ where: toScan, data: { linesScannedAt: null, linesScanStatus: null } });
  }
  const budget = Math.min(40_000, Math.max(2_000, opts.timeBudgetMs ?? 20_000));
  const t0 = Date.now();
  let scanned = 0, linesFound = 0, unreadable = 0;
  while (Date.now() - t0 < budget) {
    const batch = await prisma.ledgerEntry.findMany({ where: { ...toScan, linesScannedAt: null }, select: { id: true, contactId: true, pdfPath: true }, orderBy: { date: 'desc' }, take: 25 });
    if (!batch.length) break;
    for (const e of batch) {
      const r = await scanEntryLines(e);
      scanned++; linesFound += r.lines; if (r.status === 'unreadable' || r.status === 'missing') unreadable++;
      if (Date.now() - t0 >= budget) break;
    }
  }
  const [remaining, total] = await Promise.all([prisma.ledgerEntry.count({ where: { ...toScan, linesScannedAt: null } }), prisma.ledgerEntry.count({ where: toScan })]);
  return { scanned, linesFound, unreadable, remaining, total };
}

export async function linesStats() {
  const [total, remaining, withLines, unreadable, lineCount] = await Promise.all([
    prisma.ledgerEntry.count({ where: toScan }),
    prisma.ledgerEntry.count({ where: { ...toScan, linesScannedAt: null } }),
    prisma.ledgerEntry.count({ where: { ...toScan, linesScanStatus: 'lines' } }),
    prisma.ledgerEntry.count({ where: { ...toScan, linesScanStatus: { in: ['unreadable', 'missing'] } } }),
    prisma.purchaseLine.count(),
  ]);
  return { pdfCount: total, remaining, withLines, unreadable, noLines: Math.max(0, total - remaining - withLines - unreadable), lineCount };
}

export interface ArticleFilters { q?: string; contactId?: string; worksiteId?: string; from?: Date; to?: Date; includeSlips?: boolean }

/* ------------------------------------------------------------------ articles / fournisseurs masqués */

/** Ce qu'on ne veut pas voir (forfaits de sous-traitants, services…) : mémorisé, réversible, conservé quand on relit les PDF. */
export interface HiddenRules { articles: { key: string; label: string }[]; suppliers: { id: string; name: string }[] }
const HIDDEN_KEY = 'purchaseLinesHidden';

export async function getHidden(): Promise<HiddenRules> {
  const row = await prisma.setting.findUnique({ where: { key: HIDDEN_KEY } });
  const v = (row?.value ?? {}) as Partial<HiddenRules>;
  return { articles: Array.isArray(v.articles) ? v.articles : [], suppliers: Array.isArray(v.suppliers) ? v.suppliers : [] };
}

/** Masque (ou réaffiche avec `show`) des articles et / ou des fournisseurs entiers. */
export async function setHidden(input: { articles?: { key: string; label: string }[]; suppliers?: { id: string; name: string }[]; show?: boolean }): Promise<HiddenRules> {
  const cur = await getHidden();
  const articles = new Map(cur.articles.map((a) => [a.key, a]));
  const suppliers = new Map(cur.suppliers.map((s) => [s.id, s]));
  for (const a of input.articles ?? []) { if (input.show) articles.delete(a.key); else articles.set(a.key, { key: a.key, label: a.label.slice(0, 200) }); }
  for (const s of input.suppliers ?? []) { if (input.show) suppliers.delete(s.id); else suppliers.set(s.id, { id: s.id, name: s.name.slice(0, 120) }); }
  const next: HiddenRules = { articles: [...articles.values()], suppliers: [...suppliers.values()] };
  await prisma.setting.upsert({ where: { key: HIDDEN_KEY }, create: { key: HIDDEN_KEY, value: next as never }, update: { value: next as never } });
  return next;
}

/** Par défaut, seules les factures d'achat comptent : un bordereau (enlèvement) est repris par la facture qui le suit, donc les compter aussi doublerait tout. */
function entryWhere(f: ArticleFilters) {
  return {
    direction: { in: f.includeSlips ? DIRECTIONS : ['purchase'] },
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.worksiteId ? { worksiteId: f.worksiteId } : {}),
    ...((f.from || f.to) ? { date: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}
const search = (q: string | undefined) => (q?.trim() ? { OR: [{ label: { contains: q.trim(), ...insensitive } }, { code: { contains: q.trim(), ...insensitive } }] } : {});

export interface ArticleRow {
  key: string; label: string; code: string | null; unit: string | null; purchases: number; qty: number; totalHt: number;
  minPrice: number; maxPrice: number; lastPrice: number; lastDate: string | null; suppliers: string[];
  /** fournisseurs avec leur identifiant (pour « masquer ce fournisseur ») */
  supplierRefs: { id: string | null; name: string }[];
}

/** Articles regroupés : quantité totale, montant, nombre d'achats, prix mini / maxi / dernier prix, fournisseurs. */
export async function articleSummary(f: ArticleFilters): Promise<ArticleRow[]> {
  const hidden = await getHidden();
  const hiddenKeys = new Set(hidden.articles.map((a) => a.key));
  const lines = await prisma.purchaseLine.findMany({
    where: { ledgerEntry: { ...entryWhere(f), ...(hidden.suppliers.length ? { NOT: { contactId: { in: hidden.suppliers.map((s) => s.id) } } } : {}) }, ...search(f.q) },
    select: { articleKey: true, code: true, label: true, unit: true, qty: true, unitPriceHt: true, totalHt: true, ledgerEntryId: true, ledgerEntry: { select: { date: true, supplierName: true, contactId: true, contact: { select: { name: true } } } } },
  });
  const groups = new Map<string, { row: ArticleRow; entries: Set<string>; lastTs: number }>();
  for (const l of lines) {
    if (hiddenKeys.has(l.articleKey)) continue;
    const ts = l.ledgerEntry.date?.getTime() ?? 0;
    const supplier = l.ledgerEntry.contact?.name ?? l.ledgerEntry.supplierName ?? '—';
    let g = groups.get(l.articleKey);
    if (!g) { g = { row: { key: l.articleKey, label: l.label, code: l.code, unit: l.unit, purchases: 0, qty: 0, totalHt: 0, minPrice: l.unitPriceHt, maxPrice: l.unitPriceHt, lastPrice: l.unitPriceHt, lastDate: null, suppliers: [], supplierRefs: [] }, entries: new Set(), lastTs: -1 }; groups.set(l.articleKey, g); }
    g.entries.add(l.ledgerEntryId);
    g.row.qty += l.qty; g.row.totalHt += l.totalHt;
    g.row.minPrice = Math.min(g.row.minPrice, l.unitPriceHt); g.row.maxPrice = Math.max(g.row.maxPrice, l.unitPriceHt);
    if (!g.row.suppliers.includes(supplier)) { g.row.suppliers.push(supplier); g.row.supplierRefs.push({ id: l.ledgerEntry.contactId, name: supplier }); }
    if (ts >= g.lastTs) { g.lastTs = ts; g.row.lastPrice = l.unitPriceHt; g.row.lastDate = l.ledgerEntry.date?.toISOString() ?? null; g.row.label = l.label; g.row.unit = l.unit ?? g.row.unit; }
  }
  return [...groups.values()].map(({ row, entries }) => ({
    ...row, purchases: entries.size, qty: Math.round(row.qty * 100) / 100, totalHt: Math.round(row.totalHt * 100) / 100,
    minPrice: Math.round(row.minPrice * 100) / 100, maxPrice: Math.round(row.maxPrice * 100) / 100, lastPrice: Math.round(row.lastPrice * 100) / 100,
    suppliers: row.suppliers.slice(0, 4), supplierRefs: row.supplierRefs.slice(0, 4),
  }));
}

/** Où et quand un article a été acheté (une ligne par achat), du plus récent au plus ancien. */
export async function articleOccurrences(key: string, f: ArticleFilters) {
  const lines = await prisma.purchaseLine.findMany({
    where: { articleKey: key, ledgerEntry: entryWhere(f) },
    select: { id: true, qty: true, unit: true, unitPriceHt: true, discountPct: true, totalHt: true, label: true, ledgerEntry: { select: { id: true, contactId: true, date: true, docNumber: true, direction: true, worksiteRef: true, worksite: { select: { ref: true } }, supplierName: true, contact: { select: { name: true } } } } },
    take: 500,
  });
  return lines
    .map((l) => ({ id: l.id, entryId: l.ledgerEntry.id, contactId: l.ledgerEntry.contactId, date: l.ledgerEntry.date?.toISOString() ?? null, docNumber: l.ledgerEntry.docNumber, slip: l.ledgerEntry.direction === 'delivery_slip', supplier: l.ledgerEntry.contact?.name ?? l.ledgerEntry.supplierName ?? '—', worksiteRef: l.ledgerEntry.worksite?.ref ?? l.ledgerEntry.worksiteRef, label: l.label, qty: l.qty, unit: l.unit, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct, totalHt: l.totalHt }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}
