/**
 * Lecture des lignes d'article d'une facture / d'un bordereau d'achat à partir du TEXTE du PDF (pdftotext -raw).
 *
 * Principe : les mises en page des fournisseurs sont trop différentes pour un motif par fournisseur. On cherche donc, ligne par ligne,
 * « description + quantité + prix unitaire (+ remise) + total » et on n'accepte la ligne QUE si l'arithmétique tombe juste :
 * quantité × prix × (1 − remise) = total de la ligne (à quelques centimes près). Une ligne dont les chiffres ne se recoupent pas est
 * ignorée plutôt que lue de travers. Pur (aucun accès base ni fichier) : testable avec du texte.
 */

export interface ParsedLine {
  code: string | null;
  label: string;
  qty: number;
  unit: string | null;
  /** prix unitaire net (remise déduite) = total / quantité */
  unitPriceHt: number;
  discountPct: number | null;
  totalHt: number;
}

const UNITS = new Set([
  'P', 'PC', 'PCE', 'PCS', 'U', 'UN', 'KG', 'L', 'M', 'M2', 'M²', 'M3', 'M³', 'ML', 'MC', 'SAC', 'H', 'ROU', 'BTE', 'PAQ', 'JEU', 'SET', 'FORF', 'LOT', 'ST', 'PAL', 'PCES',
]);
const NOT_AN_ITEM = /^(total|sous-?total|tva|t\.v\.a|montant|solde|acompte|base|net\s+à|à\s+payer|reste|report|escompte|port\b|frais\s+de\s+port)/i;

/** « 15 000,00 » → « 15000,00 » (séparateur de milliers par espace), sans coller une quantité à un prix (« 7 € 200,00 » garde son « € »). */
function normalizeLine(raw: string, joinThousands: boolean): string {
  let s = raw.replace(/[−–—]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (joinThousands) s = s.replace(/(?<![\d.,])(\d{1,3}) (\d{3}[.,]\d{2})(?!\d)/g, '$1$2');
  return s.replace(/€/g, ' ').replace(/\s+/g, ' ').trim();
}

function toNumber(tok: string): number | null {
  let t = tok.replace(/%$/, '');
  if (!/^-?\d[\d.,]*$/.test(t)) return null;
  const neg = t.startsWith('-');
  t = t.replace(/^-/, '').replace(/\.$/, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const v = Number(t);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const close = (expected: number, actual: number) => Math.abs(expected - actual) <= Math.max(0.02, 0.006 * Math.abs(actual));
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Entry { idx: number; value: number; kind: 'pos' | 'neg' | 'pct' }

/**
 * « 1 139,68 » est-il « quantité 1, prix 139,68 » ou « 1 139,68 € » (milliers) ? On essaie d'abord avec milliers regroupés, puis sans :
 * l'arithmétique (quantité × prix = total) tranche, et une lecture qui ne se recoupe pas est écartée.
 */
export function parseLine(raw: string): ParsedLine | null {
  return parseWith(raw, true) ?? parseWith(raw, false);
}

function parseWith(raw: string, joinThousands: boolean): ParsedLine | null {
  const toks = normalizeLine(raw, joinThousands).split(' ').filter(Boolean);
  if (toks.length < 4) return null;
  // suffixe de la ligne fait de nombres / unités / « % »
  let start = toks.length;
  while (start > 0) {
    const t = toks[start - 1]!;
    if (toNumber(t) !== null || t === '%' || UNITS.has(t.toUpperCase())) start--; else break;
  }
  if (start === toks.length) return null;
  const entries: Entry[] = [];
  for (let i = start; i < toks.length; i++) {
    const t = toks[i]!;
    const v = toNumber(t);
    if (v === null) continue;
    const isPct = t.endsWith('%') || toks[i + 1] === '%';
    entries.push({ idx: i, value: v, kind: isPct && v >= 0 ? 'pct' : v < 0 ? 'neg' : 'pos' });
  }
  const pos = entries.filter((e) => e.kind === 'pos');
  const discount = entries.find((e) => e.kind === 'neg');
  const d = discount ? Math.abs(discount.value) : null;
  if (pos.length < 3 && !(pos.length === 2 && d !== null)) return null;

  for (let a = 0; a + 1 < pos.length; a++) {
    const q = pos[a]!, p = pos[a + 1]!;
    if (q.value <= 0 || p.value <= 0 || q.value > 1_000_000) continue;
    for (let c = a + 2; c < pos.length; c++) {
      const t = pos[c]!.value;
      if (t <= 0) continue;
      const withDiscount = d !== null && close(q.value * p.value * (1 - d / 100), t);
      const plain = close(q.value * p.value, t);
      if (!withDiscount && !plain) continue;
      // description = tout ce qui précède la quantité (sans l'unité qui la précède)
      let end = q.idx;
      let unit: string | null = null;
      if (end > 0 && UNITS.has(toks[end - 1]!.toUpperCase())) { unit = toks[end - 1]!.toUpperCase(); end--; }
      else if (UNITS.has((toks[q.idx + 1] ?? '').toUpperCase())) unit = toks[q.idx + 1]!.toUpperCase();
      let desc = toks.slice(0, end);
      let code: string | null = null;
      if (desc.length > 1 && /^\d{3,8}$/.test(desc[0]!)) { code = desc[0]!; desc = desc.slice(1); }
      else if (desc.length > 1 && /^\d{1,3}$/.test(desc[0]!)) desc = desc.slice(1); // simple n° de ligne
      const label = desc.join(' ').trim();
      if ((label.match(/[A-Za-zÀ-ÿ]/g) ?? []).length < 3 || NOT_AN_ITEM.test(label)) continue;
      return {
        code, label: label.slice(0, 200), qty: q.value, unit,
        unitPriceHt: round2(t / q.value), discountPct: withDiscount && !plain ? d : null, totalHt: round2(t),
      };
    }
  }
  return null;
}

export function parseLineItems(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of text.split('\n')) {
    const l = parseLine(raw);
    if (l) out.push(l);
  }
  return out;
}

/** Clé de regroupement d'un article : code fournisseur (propre à chaque fournisseur) sinon libellé normalisé (même produit chez plusieurs fournisseurs). */
export function articleKey(line: Pick<ParsedLine, 'code' | 'label'>, contactId: string | null): string {
  if (line.code) return `C:${contactId ?? '-'}:${line.code}`;
  const norm = line.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().slice(0, 80);
  return `L:${norm}`;
}
