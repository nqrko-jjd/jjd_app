/**
 * Import d'un relevé bancaire / carte au format CSV.
 *
 * Pensé pour les paiements qui n'apparaissent pas dans le flux Ponto
 * (cartes Visa, Mastercard business…) — l'équivalent de l'ancien collage
 * dans l'onglet « Belfius » du fichier Excel.
 *
 * Détection tolérante : séparateur ; ou , ou tab, en-têtes FR/NL/EN,
 * montants au format belge, dates jj/mm/aaaa ou ISO.
 */
import crypto from 'node:crypto';
import { parseAmount, parseLooseDate } from '@jjd/shared';

export interface ParsedBankRow {
  externalId: string; // hash stable (idempotence)
  bookingDate: Date | null;
  valueDate: Date | null;
  amount: number | null;
  currency: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  description: string | null;
  communication: string | null;
}

/* -------------------------------------------------------------- CSV brut -> lignes */

function detectDelimiter(head: string): string {
  const counts = [';', ',', '\t'].map((d) => [d, head.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 1 ? counts[0]![0] : ';';
}

/** Découpe une ligne CSV en respectant les guillemets. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === delim && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/* -------------------------------------------------------------- mapping colonnes */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const PATTERNS: Record<keyof Omit<ParsedBankRow, 'externalId' | 'currency'>, RegExp[]> = {
  valueDate: [/datevaleur/, /valutadatum/, /valuedate/],
  bookingDate: [/comptab/, /boeking/, /bookingdate/, /transactiondate/, /datetransaction/, /dateoperation/, /dateachat/, /purchasedate/, /^datum$/, /^date$/],
  amount: [/montant/, /bedrag/, /amount/, /^somme$/, /transactionamount/, /debitcredit/],
  counterpartyName: [/nomcontrepartie/, /naamtegenpartij/, /counterpartname/, /tegenpartij/, /beneficiaire/, /begunstigde/, /nomdubeneficiaire/, /commercant/, /merchant/, /libelle/, /naam/],
  counterpartyAccount: [/comptecontrepartie/, /rekeningtegenpartij/, /counterpartaccount/, /ibancontrepartie/, /tegenpartijrekening/],
  description: [/transaction$/, /description/, /omschrijving/, /details/, /nature/, /typetransaction/],
  communication: [/communication/, /mededeling/, /remittance/, /reference/, /gestructureerde/, /freetext/],
};

function mapHeaders(headers: string[]): Partial<Record<keyof ParsedBankRow, number>> {
  const idx: Partial<Record<keyof ParsedBankRow, number>> = {};
  const normed = headers.map(norm);
  for (const [field, regexes] of Object.entries(PATTERNS) as [keyof typeof PATTERNS, RegExp[]][]) {
    for (let i = 0; i < normed.length; i++) {
      if (idx[field] !== undefined) break;
      if (regexes.some((re) => re.test(normed[i]!))) idx[field] = i;
    }
  }
  return idx;
}

const stableId = (parts: (string | number | null)[]) =>
  crypto.createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 24);

/**
 * Les exports bancaires belges (Belfius…) sont souvent en Windows-1252, pas en UTF-8 —
 * un décodage UTF-8 direct remplace chaque caractère accentué par « � » (U+FFFD). On tente
 * l'UTF-8 d'abord (le cas courant) et on ne bascule sur latin1 (identique à cp1252 pour les
 * caractères français usuels : à, é, è, ç…) que si le résultat contient des remplacements.
 */
export function decodeCsvBuffer(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

export interface ParseResult {
  rows: ParsedBankRow[];
  headers: string[];
  mapped: string[]; // champs reconnus
  skipped: number;
}

export function parseBankCsv(raw: string): ParseResult {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], headers: [], mapped: [], skipped: 0 };

  const delim = detectDelimiter(lines[0]!);

  // certains exports (ex. "recherche de transactions" Belfius) font précéder le vrai
  // tableau de quelques lignes de critères de recherche ("Date de comptabilisation à
  // partir de;24/08/2026"…) avant l'en-tête réel -> on cherche, dans les ~20 premières
  // lignes, la première qui ressemble à un vrai en-tête (date ET montant reconnus)
  let headerLine = 0;
  let headers = splitLine(lines[0]!, delim);
  let idx = mapHeaders(headers);
  if (idx.amount === undefined || (idx.bookingDate === undefined && idx.valueDate === undefined)) {
    for (let i = 1; i < Math.min(lines.length, 20); i++) {
      const cand = splitLine(lines[i]!, delim);
      const candIdx = mapHeaders(cand);
      if (candIdx.amount !== undefined && (candIdx.bookingDate !== undefined || candIdx.valueDate !== undefined)) {
        headerLine = i;
        headers = cand;
        idx = candIdx;
        break;
      }
    }
  }
  if (idx.bookingDate === undefined && idx.valueDate !== undefined) idx.bookingDate = idx.valueDate;
  if (idx.amount === undefined || idx.bookingDate === undefined) {
    return { rows: [], headers, mapped: Object.keys(idx), skipped: lines.length - 1 - headerLine };
  }

  const at = (cells: string[], f: keyof ParsedBankRow) => (idx[f] !== undefined ? cells[idx[f]!] ?? null : null);
  const rows: ParsedBankRow[] = [];
  let skipped = 0;

  for (const line of lines.slice(headerLine + 1)) {
    const cells = splitLine(line, delim);
    const amount = parseAmount(at(cells, 'amount'));
    const bookingDate = parseLooseDate(at(cells, 'bookingDate'));
    if (amount === null && !bookingDate) { skipped++; continue; }

    const counterpartyName = at(cells, 'counterpartyName');
    const description = at(cells, 'description');
    const communication = at(cells, 'communication');
    rows.push({
      externalId: `csv-${stableId([
        bookingDate?.toISOString().slice(0, 10) ?? '', amount ?? '', counterpartyName ?? '', communication ?? description ?? '',
      ])}`,
      bookingDate,
      valueDate: parseLooseDate(at(cells, 'valueDate')),
      amount,
      currency: 'EUR',
      counterpartyName: counterpartyName || null,
      counterpartyAccount: at(cells, 'counterpartyAccount') || null,
      description: description || null,
      communication: communication || null,
    });
  }
  return { rows, headers, mapped: Object.keys(idx), skipped };
}
