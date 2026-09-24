/**
 * Lecture d'un tarif fournisseur (Excel ou CSV) : repère tout seul la ligne d'en-têtes et les colonnes
 * « n° d'article », « libellé », « unité de vente », « prix » — les fichiers de tarif ont souvent un titre
 * avant l'en-tête et un jeu de colonnes différent selon le fournisseur (prix brut / remise / net…).
 */
import { readXlsxBuffer } from './xlsx-read.js';
import { readTableBuffer } from './table-io.js';

export interface TariffRow {
  ref: string;
  label: string;
  unit: string | null;
  priceHt: number;
  grossPrice: number | null;
  discountPct: number | null;
}

type Cells = Record<string, string | number | null>;
interface Grid { name: string; rows: { r: number; cells: Cells }[] }

const norm = (v: unknown) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();

interface ColMap { ref?: string; label: string; unit?: string; net?: string; gross?: string; price?: string; discount?: string }

/** Cherche les colonnes utiles dans une ligne d'en-têtes ; null si ce n'en est pas une. */
function detectColumns(cells: Cells): ColMap | null {
  const map: Partial<ColMap> = {};
  for (const [col, raw] of Object.entries(cells)) {
    const h = norm(raw);
    if (!h) continue;
    if (!map.ref && /^(no|n°|num|numero)?\s*-?\s*(art|article)|^ref|^code( article)?$/.test(h)) map.ref = col;
    else if (!map.label && /(libelle|designation|description|produit|intitule|^nom$)/.test(h)) map.label = col;
    else if (!map.unit && /^(u\.?\s?v|unite|un\.?$|u\.?v\.?)/.test(h)) map.unit = col;
    else if (!map.discount && /remise|rabais|discount/.test(h)) map.discount = col;
    else if (!map.net && /net/.test(h) && /(htva|ht|prix|p\.?u)/.test(h)) map.net = col;
    else if (!map.gross && /brut/.test(h)) map.gross = col;
    else if (!map.price && /^(p\.?\s?u|prix)/.test(h)) map.price = col;
  }
  if (!map.label || !(map.net || map.price || map.gross)) return null;
  return map as ColMap;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, '').replace('€', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const str = (v: string | number | null | undefined) => (v == null ? '' : String(v).trim());

/** Clé stable d'un article quand le fournisseur n'a pas de n° (« / », vide) : le libellé abrégé. */
function refKey(ref: string, label: string): string {
  const r = ref.trim();
  if (r && r !== '/' && r !== '-') return r;
  return `-${norm(label).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
}

function parseGrid(grid: Grid): TariffRow[] {
  let cols: ColMap | null = null;
  let start = -1;
  for (let i = 0; i < Math.min(grid.rows.length, 15); i++) {
    const c = detectColumns(grid.rows[i]!.cells);
    if (c) { cols = c; start = i + 1; break; }
  }
  if (!cols) return [];
  const out = new Map<string, TariffRow>();
  for (const { cells } of grid.rows.slice(start)) {
    const label = str(cells[cols.label]);
    if (!label) continue;
    const net = num(cols.net ? cells[cols.net] : null);
    const gross = num(cols.gross ? cells[cols.gross] : null);
    const plain = num(cols.price ? cells[cols.price] : null);
    const priceHt = net ?? plain ?? gross;
    if (priceHt == null) continue;
    let discount = num(cols.discount ? cells[cols.discount] : null);
    if (discount != null && discount > 0 && discount <= 1) discount = Math.round(discount * 10000) / 100; // 0,5 -> 50 %
    const ref = refKey(cols.ref ? str(cells[cols.ref]) : '', label);
    out.set(ref, { ref, label, unit: str(cols.unit ? cells[cols.unit] : '') || null, priceHt, grossPrice: gross, discountPct: discount });
  }
  return [...out.values()];
}

/**
 * Lit le fichier. Pour un classeur Excel à plusieurs feuilles (une par fournisseur), choisit la feuille dont
 * le nom contient `hint` (nom du fournisseur ou feuille demandée), sinon la première feuille qui ressemble à un tarif.
 */
export function parseTariff(buf: Buffer, filename: string, hint?: string): { rows: TariffRow[]; sheet: string | null; sheets: string[] } {
  const lower = filename.toLowerCase();
  const isXlsx = lower.endsWith('.xlsx') || (buf[0] === 0x50 && buf[1] === 0x4b);
  if (!isXlsx) {
    const table = readTableBuffer(buf, filename);
    const keys = table[0] ? Object.keys(table[0]) : [];
    const head: Cells = Object.fromEntries(keys.map((k, i) => [String(i), k]));
    const rows = table.map((row, r) => ({ r: r + 2, cells: Object.fromEntries(keys.map((k, i) => [String(i), row[k] ?? null])) as Cells }));
    return { rows: parseGrid({ name: filename, rows: [{ r: 1, cells: head }, ...rows] }), sheet: null, sheets: [] };
  }
  const sheets = readXlsxBuffer(buf);
  const grids: Grid[] = sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => ({ r: r.r, cells: r.cells as Cells })) }));
  const h = norm(hint);
  const preferred = h ? grids.filter((g) => norm(g.name).includes(h) || h.includes(norm(g.name))) : [];
  for (const g of [...preferred, ...grids]) {
    const rows = parseGrid(g);
    if (rows.length) return { rows, sheet: g.name, sheets: grids.map((x) => x.name) };
  }
  return { rows: [], sheet: null, sheets: grids.map((x) => x.name) };
}

/** « KNAUF MP75 25KG 45/PAL » -> { base: 'kg', pack: { name: 'sac', factor: 25 } } ; sinon pièce. */
export function guessPacking(label: string, uv: string | null): { unit: string; pack: { name: string; factor: number } | null } {
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*KG\b/i);
  if (m) {
    const factor = Number(m[1]!.replace(',', '.'));
    if (factor > 1) return { unit: 'kg', pack: { name: 'sac', factor } };
  }
  const u = (uv ?? '').trim().toLowerCase();
  return { unit: !u || u === 'pc' || u === 'pce' ? 'pce' : u, pack: null };
}
