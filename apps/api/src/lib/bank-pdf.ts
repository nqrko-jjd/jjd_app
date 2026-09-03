/**
 * Import d'un relevé de carte au format PDF (« État des dépenses » Belfius /
 * Atos Worldline). Les paiements par carte prépayée n'existent pas en CSV et
 * n'arrivent qu'une fois par mois sur ce PDF.
 *
 * Utilise `pdftotext -raw` (poppler / xpdf) — à installer sur le serveur au
 * déploiement (`apt-get install -y poppler-utils`).
 */
import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { parseAmount } from '@jjd/shared';
import type { ParsedBankRow } from './bank-csv.js';

const run = promisify(execFile);

/** Emplacements courants de pdftotext (Linux via PATH, Windows via Git). */
const CANDIDATES = [
  process.env.PDFTOTEXT_BIN,
  'pdftotext',
  'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe',
  'C:\\Program Files\\Git\\usr\\bin\\pdftotext.exe',
  'C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe',
].filter((x): x is string => !!x);

let resolvedBin: string | null | undefined;

async function probe(bin: string): Promise<boolean> {
  // `pdftotext -v` sort la version mais quitte avec un code != 0 (xpdf : 99).
  // On considère l'exécutable présent tant que l'erreur n'est pas ENOENT.
  try {
    await run(bin, ['-v']);
    return true;
  } catch (e) {
    const err = e as { code?: string | number; stderr?: string };
    if (err.code === 'ENOENT') return false;
    // a bien tourné mais quitté avec un code numérique -> l'exécutable existe
    return typeof err.code === 'number' || /pdftotext|version/i.test(err.stderr ?? '');
  }
}

async function findBin(): Promise<string | null> {
  if (resolvedBin !== undefined) return resolvedBin;
  for (const bin of CANDIDATES) {
    if (bin.includes(path.sep)) {
      if (existsSync(bin)) { resolvedBin = bin; return bin; }
      continue;
    }
    if (await probe(bin)) { resolvedBin = bin; return bin; }
  }
  resolvedBin = null;
  return null;
}

export async function pdftotextAvailable(): Promise<boolean> {
  return (await findBin()) !== null;
}

export async function pdfToRawText(buf: Buffer): Promise<string> {
  const bin = await findBin();
  if (!bin) throw new Error('pdftotext introuvable');
  const tmp = path.join(tmpdir(), `jjd-${nanoid(10)}.pdf`);
  await writeFile(tmp, buf);
  try {
    const { stdout } = await run(bin, ['-raw', '-enc', 'UTF-8', tmp, '-'], { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const stableId = (parts: (string | number | null)[]) =>
  'pdf-' + crypto.createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 22);

/** DD/MM + année du relevé -> Date UTC (gère le passage d'année). */
function dmToDate(dm: string, closeYear: number, closeMonth: number): Date | null {
  const m = dm.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = Number(m[2]);
  const year = mon > closeMonth ? closeYear - 1 : closeYear;
  const d = new Date(Date.UTC(year, mon - 1, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

const COUNTRY = /\s+(BE|NL|FR|LU|DE|GB|US|ES|IT)\s*$/;

export interface CardStatement {
  cardRef: string | null;
  period: string | null;
  rows: ParsedBankRow[];
  total: number | null;
}

/**
 * Parse le texte `-raw`. Ne garde que la section « Transactions » (pas les
 * « Chargements & Déchargements », qui sont des virements depuis le compte
 * courant et feraient double emploi).
 */
export function parseCardStatement(text: string): CardStatement {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());

  const closeM = text.match(/cl[oôòö]ture\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const closeMonth = closeM ? Number(closeM[2]) : new Date().getUTCMonth() + 1;
  const closeYear = closeM ? Number(closeM[3]) : new Date().getUTCFullYear();
  const cardRef = text.match(/client\s+(\d{6,})/i)?.[1] ?? null;
  const period = text.match(/Transactions du (\d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4})/)?.[1] ?? null;
  const totalM = text.match(/Total des d[eé]penses.*?([\d.]+,\d{2})\s*EUR\s*-/i);
  const total = totalM ? -(parseAmount(totalM[1]) ?? 0) : null;

  // borne : depuis la 2e occurrence de « Numéro de carte » (section Transactions) jusqu'à « Total des dépenses »
  const cardHeaders = lines.map((l, i) => (/Num[eé]ro de carte/i.test(l) ? i : -1)).filter((i) => i >= 0);
  const start = cardHeaders.length > 1 ? cardHeaders[1]! : cardHeaders[0] ?? 0;
  const end = lines.findIndex((l, i) => i > start && /Total des d[eé]penses/i.test(l));

  const LINE = /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+([\d.]+,\d{2})\s+EUR\s*([+-])\s*$/;
  const rows: ParsedBankRow[] = [];
  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, dTx, dBook, descRaw, amtRaw, sign] = m;
    const magnitude = parseAmount(amtRaw) ?? 0;
    const amount = sign === '-' ? -magnitude : magnitude;
    const desc = descRaw!.replace(/\s+/g, ' ').trim();
    const counterpartyName = desc.replace(COUNTRY, '').trim() || desc;
    const bookingDate = dmToDate(dBook!, closeYear, closeMonth);
    const valueDate = dmToDate(dTx!, closeYear, closeMonth);
    rows.push({
      externalId: stableId([cardRef, bookingDate?.toISOString().slice(0, 10) ?? '', amount, counterpartyName]),
      bookingDate,
      valueDate,
      amount,
      currency: 'EUR',
      counterpartyName,
      counterpartyAccount: null,
      description: desc,
      communication: null,
    });
  }
  return { cardRef, period, rows, total };
}
