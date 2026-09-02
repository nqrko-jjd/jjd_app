/**
 * Montants en euros, TVA belge. On stocke tout en nombre (euros, 2 décimales) —
 * simple et suffisant pour de la gestion ; passage en centimes entiers possible
 * plus tard si besoin de comptabilité stricte.
 */

/** Taux de TVA belges rencontrés chez JJD. 6 % = rénovation logement > 10 ans. */
export const VAT_RATES = [0, 0.06, 0.12, 0.21] as const;
export type VatRate = (typeof VAT_RATES)[number];

export const DEFAULT_VAT_RATE: VatRate = 0.21;

/** Arrondi comptable à 2 décimales (évite 0.1 + 0.2 = 0.30000000000000004). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function htFromTtc(ttc: number, rate: number): number {
  return round2(ttc / (1 + rate));
}

export function ttcFromHt(ht: number, rate: number): number {
  return round2(ht * (1 + rate));
}

export function vatAmount(ht: number, rate: number): number {
  return round2(ht * rate);
}

/** Formate « 1 234,56 € » (format belge). */
export function formatEur(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n);
}

/** Parse « 26 166,00 € » / « 1.713,23 » / « 245.565 » -> number | null. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/\s|€|EUR/gi, '');
  if (!s || s === '-' || s === '?' || s === '/') return null;
  // Format belge « 1.234,56 » -> « 1234.56 »
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
