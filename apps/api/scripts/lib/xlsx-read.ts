/**
 * Lecteur XLSX minimal, zéro dépendance lourde (unzip via fflate).
 * Suffisant pour l'import : renvoie chaque feuille sous forme de lignes
 * indexées par lettre de colonne, plus un mappage en-tête -> lettre.
 */
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

export interface SheetData {
  name: string;
  headers: Record<string, string>; // "A" -> "Nom"
  headerIndex: Record<string, string>; // "nom" (normalisé) -> "A"
  rows: Array<{ r: number; cells: Record<string, string | number | null> }>;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#9;/g, '\t')
    .replace(/&#xA;/g, '\n').replace(/&amp;/g, '&');
}

function colLetters(ref: string): string {
  const m = ref.match(/^[A-Z]+/);
  return m ? m[0] : '';
}

export function readXlsx(path: string): SheetData[] {
  const zip = unzipSync(readFileSync(path));
  const get = (p: string) => (zip[p] ? strFromU8(zip[p]!) : '');

  // shared strings
  const shared: string[] = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ss))) {
      let txt = '';
      const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tre.exec(m[1]!))) txt += tm[1];
      shared.push(decode(txt));
    }
  }

  // workbook : ordre + noms des feuilles
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const relMap: Record<string, string> = {};
  for (const rm of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[rm[1]!] = rm[2]!.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets: { name: string; file: string }[] = [];
  for (const sm of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = relMap[sm[2]!];
    if (target) sheets.push({ name: decode(sm[1]!), file: `xl/${target}` });
  }

  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const out: SheetData[] = [];
  for (const { name, file } of sheets) {
    const xml = get(file);
    if (!xml) continue;
    const rows: SheetData['rows'] = [];
    for (const rowM of xml.matchAll(/<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const r = Number(rowM[1]);
      const cells: Record<string, string | number | null> = {};
      for (const cM of rowM[2]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cM[1]!;
        const inner = cM[2] ?? '';
        const refM = attrs.match(/r="([A-Z]+\d+)"/);
        if (!refM) continue;
        const col = colLetters(refM[1]!);
        const t = attrs.match(/t="([^"]+)"/)?.[1];
        const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
        const isM = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        let val: string | number | null = null;
        if (t === 's' && vM) val = shared[Number(vM[1])] ?? null;
        else if (t === 'inlineStr' && isM) val = decode(isM[1]!);
        else if (t === 'str' && vM) val = decode(vM[1]!);
        else if (vM) {
          const n = Number(vM[1]);
          val = Number.isFinite(n) ? n : decode(vM[1]!);
        }
        if (val !== null && val !== '') cells[col] = val;
      }
      if (Object.keys(cells).length) rows.push({ r, cells });
    }

    const headerRow = rows.find((x) => x.r === 1)?.cells ?? {};
    const headers: Record<string, string> = {};
    const headerIndex: Record<string, string> = {};
    for (const [col, v] of Object.entries(headerRow)) {
      const label = String(v).trim();
      headers[col] = label;
      if (label) headerIndex[norm(label)] = col;
    }
    out.push({ name, headers, headerIndex, rows });
  }
  return out;
}

/** Valeur d'une ligne par nom d'en-tête (normalisé). */
export function cell(
  sheet: SheetData,
  row: { cells: Record<string, string | number | null> },
  header: string,
): string | number | null {
  const norm = header.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const col = sheet.headerIndex[norm];
  return col ? (row.cells[col] ?? null) : null;
}
