/**
 * Lecture unifiée d'un tableau : .xlsx (1re feuille) ou .csv / .tsv.
 * Renvoie des lignes { [enTêteNormalisé]: valeur }.
 */
import { readFileSync } from 'node:fs';
import { readXlsx } from './xlsx-read.js';

export type TableRow = Record<string, string>;

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseDelimited(text: string, delim: string): TableRow[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const header = (rows.shift() ?? []).map((h) => norm(h));
  return rows
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const o: TableRow = {};
      header.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').trim(); });
      return o;
    });
}

export function readTable(path: string): TableRow[] {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return parseDelimited(readFileSync(path, 'utf8'), ',');
  if (lower.endsWith('.tsv')) return parseDelimited(readFileSync(path, 'utf8'), '\t');

  const sheets = readXlsx(path);
  const sh = sheets[0];
  if (!sh) return [];
  const headerByCol = sh.headers;
  return sh.rows
    .filter((r) => r.r > 1)
    .map((r) => {
      const o: TableRow = {};
      for (const [col, v] of Object.entries(r.cells)) {
        const h = headerByCol[col];
        if (h) o[norm(h)] = String(v);
      }
      return o;
    })
    .filter((o) => Object.keys(o).length > 0);
}

/** Première valeur trouvée parmi plusieurs en-têtes possibles. */
export function pick(row: TableRow, ...headers: string[]): string | null {
  for (const h of headers) {
    const v = row[norm(h)];
    if (v != null && v.trim() !== '') return v.trim();
  }
  return null;
}
