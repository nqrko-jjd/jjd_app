/**
 * Devis & factures — calculs de lignes, totaux, numérotation, communication
 * structurée belge. Pas de dépendance : réutilisable côté API et côté web.
 */
import { round2 } from './money.js';

export interface DocLineLike {
  kind?: string; // item | section | text
  qty?: number | null;
  unitPriceHt?: number | null;
  discountPct?: number | null;
  vatRate?: number | null;
}

/** Total HT d'une ligne (0 pour les lignes de section / texte). */
export function lineTotalHt(l: DocLineLike): number {
  if (l.kind && l.kind !== 'item') return 0;
  const qty = l.qty ?? 0;
  const pu = l.unitPriceHt ?? 0;
  const disc = Math.min(Math.max(l.discountPct ?? 0, 0), 100);
  return round2(qty * pu * (1 - disc / 100));
}

export interface DocTotals {
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  /** Ventilation par taux : { "0.21": { base, vat } }. */
  vatBreakdown: Record<string, { base: number; vat: number }>;
}

/** Totaux d'un document à partir de ses lignes (TVA ventilée par taux). */
export function computeDocTotals(lines: DocLineLike[]): DocTotals {
  const breakdown: Record<string, { base: number; vat: number }> = {};
  for (const l of lines) {
    if (l.kind && l.kind !== 'item') continue;
    const base = lineTotalHt(l);
    const rate = l.vatRate ?? 0;
    const key = String(rate);
    const b = breakdown[key] ?? { base: 0, vat: 0 };
    b.base = round2(b.base + base);
    breakdown[key] = b;
  }
  let totalHt = 0;
  let totalVat = 0;
  for (const [rate, b] of Object.entries(breakdown)) {
    b.vat = round2(b.base * Number(rate));
    totalHt = round2(totalHt + b.base);
    totalVat = round2(totalVat + b.vat);
  }
  return { totalHt, totalVat, totalTtc: round2(totalHt + totalVat), vatBreakdown: breakdown };
}

/** Préfixe de numéro par type de document. */
export const DOC_NUMBER_PREFIX: Record<string, string> = {
  quote: 'D',
  invoice: 'F',
  credit_note: 'NC',
  deposit_invoice: 'FA',
};

/** « F2026-014 » — numérotation continue par type et par année. */
export function formatDocNumber(kind: string, year: number, seq: number): string {
  const prefix = DOC_NUMBER_PREFIX[kind] ?? 'DOC';
  return `${prefix}${year}-${String(seq).padStart(3, '0')}`;
}

/** Nom du compteur atomique correspondant. */
export function docCounterName(kind: string, year: number): string {
  return `doc:${kind}:${year}`;
}

/**
 * Communication structurée belge : 10 chiffres + 2 de contrôle (mod 97,
 * 00 -> 97). Rendu « +++123/4567/89012+++ ». `base` = entier (souvent
 * dérivé du numéro de facture).
 */
export function belgianStructuredComm(base: number): string {
  const ten = String(Math.abs(Math.trunc(base)) % 10_000_000_000).padStart(10, '0');
  const mod = Number(ten) % 97;
  const check = String(mod === 0 ? 97 : mod).padStart(2, '0');
  const full = ten + check;
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7, 12)}+++`;
}

/** Échéance = date d'émission + N jours (défaut 30). */
export function computeDueDate(issuedOn: Date, days = 30): Date {
  const d = new Date(issuedOn);
  d.setDate(d.getDate() + days);
  return d;
}

export const DOC_KIND_LABEL: Record<string, string> = {
  quote: 'Devis',
  invoice: 'Facture',
  credit_note: 'Note de crédit',
  deposit_invoice: 'Facture d’acompte',
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  declined: 'Refusé',
  expired: 'Expiré',
  paid: 'Payée',
  partial: 'Partiel',
  overdue: 'En retard',
  credited: 'Créditée',
};
