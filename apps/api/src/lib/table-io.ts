/**
 * Lecture/écriture unifiée d'un tableau pour les exports/imports Excel de l'app
 * (horaires, ouvriers, achats, ventes…) et pour les scripts d'import ponctuels.
 *
 * Lecture : .xlsx / .csv / .tsv -> lignes { [enTêteNormalisé]: valeur }.
 * Écriture : lignes -> CSV (BOM UTF-8 + délimiteur ';', convention Excel FR/BE).
 */
import { readFileSync } from 'node:fs';
import { readXlsxBuffer } from './xlsx-read.js';

export type TableRow = Record<string, string>;

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Compte `,` vs `;` sur la 1re ligne non vide pour deviner le délimiteur réel
 *  (Excel FR/BE sauvegarde en ';' car ',' est le séparateur décimal). */
function guessDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

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

function readXlsxRows(buf: Uint8Array): TableRow[] {
  const sheets = readXlsxBuffer(buf);
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

/** Lit un fichier disque (.xlsx/.csv/.tsv) — utilisé par les scripts d'import ponctuels. */
export function readTable(path: string): TableRow[] {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) { const t = readFileSync(path, 'utf8'); return parseDelimited(t, guessDelimiter(t)); }
  if (lower.endsWith('.tsv')) return parseDelimited(readFileSync(path, 'utf8'), '\t');
  return readXlsxRows(readFileSync(path));
}

/** Lit un buffer uploadé (routes API) — détecte .xlsx (signature zip "PK") vs texte délimité. */
export function readTableBuffer(buf: Buffer, originalName?: string): TableRow[] {
  const lower = (originalName ?? '').toLowerCase();
  const isXlsx = lower.endsWith('.xlsx') || (buf[0] === 0x50 && buf[1] === 0x4b); // "PK" = zip
  if (isXlsx) return readXlsxRows(buf);
  const text = buf.toString('utf8');
  if (lower.endsWith('.tsv')) return parseDelimited(text, '\t');
  return parseDelimited(text, guessDelimiter(text));
}

/** Première valeur trouvée parmi plusieurs en-têtes possibles. */
export function pick(row: TableRow, ...headers: string[]): string | null {
  for (const h of headers) {
    const v = row[norm(h)];
    if (v != null && v.trim() !== '') return v.trim();
  }
  return null;
}

export interface CsvColumn {
  key: string;
  label: string;
}

function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v).replace('.', ',') : '';
  else if (v instanceof Date) s = Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  else s = String(v);
  if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Génère un CSV (BOM UTF-8 + ';') éditable dans Excel puis ré-importable. */
export function toCsv(columns: CsvColumn[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => csvField(c.label)).join(';');
  const lines = rows.map((r) => columns.map((c) => csvField(r[c.key])).join(';'));
  const BOM = String.fromCharCode(0xfeff);
  return BOM + [header, ...lines].join('\r\n') + '\r\n';
}
