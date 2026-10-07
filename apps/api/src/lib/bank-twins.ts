/**
 * Jumeaux bancaires : une même opération peut exister deux fois — importée d'un fichier (CSV…) ET lue par Ponto. Les dates ne coïncident
 * pas toujours (le CSV est souvent décalé d'un jour), donc on reconnaît un jumeau à : même montant SIGNÉ au centime près, date à ±2 jours,
 * et un compte contrepartie qui ne se contredit pas. En cas d'ambiguïté (quatre paiements de 47 € le même jour), l'appariement est
 * un-pour-un, en préférant la même contrepartie puis la date la plus proche.
 */
export interface TwinTx {
  id: string;
  amount: number | null;
  bookingDate: Date | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
}

export const TWIN_WINDOW_DAYS = 2;
const cents = (n: number) => Math.round(n * 100);
const dayNum = (d: Date) => Math.floor(d.getTime() / 86400000);
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Note de ressemblance (plus petit = plus proche) ou null si ce ne sont pas des jumeaux. */
export function twinScore(a: TwinTx, b: TwinTx): number | null {
  if (a.amount == null || b.amount == null || !a.bookingDate || !b.bookingDate) return null;
  if (cents(a.amount) !== cents(b.amount)) return null;
  const diff = Math.abs(dayNum(a.bookingDate) - dayNum(b.bookingDate));
  if (diff > TWIN_WINDOW_DAYS) return null;
  const accA = norm(a.counterpartyAccount);
  const accB = norm(b.counterpartyAccount);
  if (accA && accB && accA !== accB) return null;
  const nameA = norm(a.counterpartyName);
  const nameB = norm(b.counterpartyName);
  const sameName = !!nameA && nameA === nameB;
  return (sameName ? 0 : 3) + diff;
}

/** Apparie chaque ligne `left` à AU PLUS une ligne `right` (un-pour-un, meilleures notes d'abord). */
export function pairTwins<L extends TwinTx, R extends TwinTx>(left: L[], right: R[]): { pairs: [L, R][]; unpaired: L[] } {
  const byAmount = new Map<number, R[]>();
  for (const r of right) {
    if (r.amount == null) continue;
    const k = cents(r.amount);
    byAmount.set(k, [...(byAmount.get(k) ?? []), r]);
  }
  const cands: { l: L; r: R; score: number }[] = [];
  for (const l of left) {
    if (l.amount == null) continue;
    for (const r of byAmount.get(cents(l.amount)) ?? []) {
      const score = twinScore(l, r);
      if (score != null) cands.push({ l, r, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  const usedL = new Set<string>();
  const usedR = new Set<string>();
  const pairs: [L, R][] = [];
  for (const c of cands) {
    if (usedL.has(c.l.id) || usedR.has(c.r.id)) continue;
    usedL.add(c.l.id); usedR.add(c.r.id);
    pairs.push([c.l, c.r]);
  }
  return { pairs, unpaired: left.filter((l) => !usedL.has(l.id)) };
}
