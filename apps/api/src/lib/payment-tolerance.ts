/**
 * Écart toléré entre le total d'une facture et ce qui a été encaissé : un client qui paie 18 802,34 € pour
 * une facture de 18 802,44 € (arrondi d'un ancien logiciel, virement saisi à la main) l'a bel et bien payée —
 * sans cette tolérance elle restait « En retard » avec 0,10 € « dû ». Reste volontairement petit.
 */
export const PAYMENT_TOLERANCE = 0.5;

/** Purchase invoices: ignore a paid residual of at most two cents, using integer cents. */
export const PURCHASE_PAYMENT_TOLERANCE = 0.02;
export function purchaseRemaining(total: number, paid: number): number {
  const cents = Math.max(0, Math.round(Math.abs(total) * 100) - Math.round(paid * 100));
  return paid > 0 && cents <= Math.round(PURCHASE_PAYMENT_TOLERANCE * 100) ? 0 : cents / 100;
}
