/** Formats belges + conversions de dates venant d'Excel. */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30); // Excel : le jour 0 = 30/12/1899
const MS_PER_DAY = 86_400_000;
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Excel stocke les dates en nombre de jours depuis 1899-12-30.
 * Le fichier JJD mélange ce format (« 45376.0 ») avec du texte (« 16/12/2024 »).
 */
export function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH + Math.round(serial) * MS_PER_DAY);
}

export function parseLooseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 20000 && raw < 80000) return excelSerialToDate(raw);
    return null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s === '-' || s === '?' || s === '/') return null;

  // « 45376.0 » sous forme de string
  if (/^\d{4,6}(\.0+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return excelSerialToDate(n);
  }
  // « 16/12/2024 » ou « 16-12-2024 » ou « 16.12.2024 »
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y!.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  // ISO
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function formatDateBE(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt);
}

export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined || Number.isNaN(h)) return '—';
  return `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(h)} h`;
}

/** Normalise un nom pour dédoublonnage : minuscules, sans accents ni ponctuation. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Numéro TVA belge : « BE0850775221 » -> « BE 0850.775.221 » ; renvoie null si invalide. */
export function formatVat(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const m = clean.match(/^BE?(\d{9,10})$/);
  if (!m) return null;
  const digits = m[1]!.padStart(10, '0');
  return `BE ${digits.slice(0, 4)}.${digits.slice(4, 7)}.${digits.slice(7)}`;
}
