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
  const headers = splitLine(lines[0]!, delim);
  const idx = mapHeaders(headers);
  if (idx.bookingDate === undefined && idx.valueDate !== undefined) idx.bookingDate = idx.valueDate;
  if (idx.amount === undefined || idx.bookingDate === undefined) {
    return { rows: [], headers, mapped: Object.keys(idx), skipped: lines.length - 1 };
  }

  const at = (cells: string[], f: keyof ParsedBankRow) => (idx[f] !== undefined ? cells[idx[f]!] ?? null : null);
  const rows: ParsedBankRow[] = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
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
