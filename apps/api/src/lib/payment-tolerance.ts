/**
 * Écart toléré entre le total d'une facture et ce qui a été encaissé : un client qui paie 18 802,34 € pour
 * une facture de 18 802,44 € (arrondi d'un ancien logiciel, virement saisi à la main) l'a bel et bien payée —
 * sans cette tolérance elle restait « En retard » avec 0,10 € « dû ». Reste volontairement petit.
 */
export const PAYMENT_TOLERANCE = 0.5;
