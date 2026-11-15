/** Choix d'une écriture pour une transaction bancaire — partie pure de bank-match.ts (testable). */

export interface TxLite {
  id: string;
  amount: number | null;
  bookingDate: Date | null;
  structuredComm: string | null;
  counterpartyName: string | null;
  side: string | null; // "in" | "out"
  description?: string | null;
}
export interface LedgerLite {
  id: string;
  ttc: number | null;
  ht: number;
  date: Date | null;
  direction: string; // sale | purchase | credit_note
  bankComm: string | null;
  supplierName: string | null;
  contactName: string | null;
  documentId: string | null;
}

export const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
export const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const DAY = 86_400_000;

// mots trop génériques pour discriminer une contrepartie
const STOP = new Set(['acp', 'sprl', 'bvba', 'srl', 'nv', 'sa', 'the', 'les', 'des', 'and', 'ets', 'via']);
/** Deux libellés partagent-ils un mot significatif (> 3 lettres, hors mots vides) ? */
export function nameOverlap(a: string, b: string): boolean {
  const keep = (w: string) => w.length > 3 && !STOP.has(w);
  const wa = new Set(norm(a).split(/\s+/).filter(keep));
  return norm(b).split(/\s+/).filter(keep).some((w) => wa.has(w));
}

export function sideMatches(tx: TxLite, l: LedgerLite): boolean {
  // Sens de transaction inconnu (import incomplet) : `!== 'out'` et `!== 'in'` sont
  // tous les deux vrais pour null, donc un achat ET une vente passaient le filtre à
  // tort — repéré via un faux rapprochement (paiement client matché à un achat sans
  // rapport, tous deux à 110€, le sens de la transaction n'ayant jamais été importé).
  // Sans le sens, impossible de confirmer la cohérence : on écarte plutôt que deviner.
  if (!tx.side) return false;
  if (l.direction === 'sale') return tx.side !== 'out'; // encaissement
  if (l.direction === 'purchase') return tx.side !== 'in'; // décaissement
  return true; // note de crédit : les deux sens possibles
}

export const amountOf = (l: LedgerLite) => Math.abs(l.ttc ?? l.ht ?? 0);

// mots du libellé bancaire qui ne nomment pas le commerçant (moyen de paiement, banque, lieu générique…)
const PARTY_NOISE = new Set([
  ...STOP, 'achat', 'bancontact', 'betaling', 'tankbeurt', 'sans', 'contact', 'carte', 'kaart', 'kaartnummer', 'paiement', 'virement',
  'instantane', 'mobile', 'vers', 'belfius', 'app', 'naar', 'instantoverschrijving', 'overschrijving', 'euro', 'sepa', 'releve', 'visa',
  'debit', 'mastercard', 'maestro', 'uur', 'referentie', 'votre', 'domiciliation', 'europeenne', 'pour', 'communication', 'belgium',
  'belgique', 'bruxelles', 'brussel', 'inc', 'ltd', 'gmbh', 'store', 'payconiq', 'mollie', 'sumup', 'zettle', 'paypal', 'scott', 'david',
]);
/** mots qui nomment la contrepartie d'un paiement (« Tesla Inc. AARTSELAAR » → tesla, aartselaar) */
export function partyWords(tx: Pick<TxLite, 'counterpartyName' | 'description'>): string[] {
  const raw = tx.counterpartyName || tx.description || '';
  return norm(raw).split(/\s+/).filter((w) => w.length > 3 && !PARTY_NOISE.has(w) && !/\d/.test(w));
}
export type AliasCheck = (tx: TxLite, l: LedgerLite) => boolean;
/**
 * Un rapprochement « au montant » vers un achat n'est accepté que si le libellé bancaire peut désigner ce
 * fournisseur : nom commun, alias déjà confirmé à la main (Ilonato = BigMat…), ou libellé sans nom exploitable.
 * Sans ça, un Supercharger Tesla de 10,35 € partait sur un ticket Baustoff de 10,33 €.
 */
export function partyCoherent(tx: TxLite, l: LedgerLite, alias?: AliasCheck): boolean {
  if (l.direction === 'sale') return true; // un client paie souvent via un tiers (notaire, syndic, banque) : pas de filtre
  const words = partyWords(tx);
  if (!words.length) return true;
  // frais bancaires (« FRAIS DE GESTION CARTE », « PARTICIPATION AUX FRAIS ») : facturés par la banque elle-même
  if (/\b(frais|cout|couts|participation|interets?|commission)\b/.test(norm(tx.counterpartyName || tx.description || '').split(' ').slice(0, 4).join(' '))
    && /\b(belfius|ing|bnp|kbc|isabel)\b/.test(norm(`${l.supplierName ?? ''} ${l.contactName ?? ''}`))) return true;
  const party = words.join(' ');
  if (nameOverlap(party, l.supplierName ?? '') || nameOverlap(party, l.contactName ?? '')) return true;
  // préfixe commun (« sanimat » / « sani mat », « bigmat » / « big mat »)
  const sup = norm(`${l.supplierName ?? ''} ${l.contactName ?? ''}`).replace(/\s+/g, '');
  if (words.some((w) => w.length >= 5 && sup.includes(w.slice(0, 5)))) return true;
  return !!alias?.(tx, l);
}

/** Cherche la meilleure écriture pour une transaction. */
export function pickMatch(tx: TxLite, candidates: LedgerLite[], alias?: AliasCheck): { ledgerId: string; confidence: 'strong' | 'good' } | null {
  const amt = Math.abs(tx.amount ?? 0);
  if (!amt) return null;
  const ledgers = candidates.length > 1 ? [...new Map(candidates.map((l) => [l.id, l])).values()] : candidates;

  // 1. communication structurée
  if (tx.structuredComm && tx.structuredComm.length >= 10) {
    const hit = ledgers.filter((l) => digits(l.bankComm) && digits(l.bankComm) === tx.structuredComm);
    if (hit.length === 1) return { ledgerId: hit[0]!.id, confidence: 'strong' };
  }

  // 2. montant + date + sens
  const near = ledgers.filter((l) => {
    if (!sideMatches(tx, l)) return false;
    if (!partyCoherent(tx, l, alias)) return false;
    if (Math.abs(amountOf(l) - amt) > 0.02) return false;
    if (tx.bookingDate && l.date && Math.abs(tx.bookingDate.getTime() - l.date.getTime()) > 45 * DAY) return false;
    return true;
  });
  // Facture annulée par une note de crédit du MÊME montant : l'encaissement (entrant) va sur la facture, le remboursement (sortant) sur la
  // note de crédit — sans cela le même montant donnait deux candidats et rien n'était rapproché.
  if (tx.side === 'in' && near.some((l) => l.direction === 'sale')) {
    const sales = near.filter((l) => l.direction !== 'credit_note');
    if (sales.length === 1) return { ledgerId: sales[0]!.id, confidence: 'good' };
    near.splice(0, near.length, ...sales);
  }
  if (near.length === 1) return { ledgerId: near[0]!.id, confidence: 'good' };

  // Paiement récurrent (loyer, abonnement) : même tiers, même montant chaque mois. On retient l'écriture la plus proche en
  // date quand elle est nettement plus proche que les autres (≤ 20 jours, et au moins 10 jours d'avance).
  if (near.length > 1 && tx.bookingDate) {
    const party = (l: LedgerLite) => norm(l.supplierName ?? l.contactName);
    const first = party(near[0]!);
    if (first && near.every((l) => party(l) === first)) {
      const ranked = near.filter((l) => l.date)
        .map((l) => ({ l, d: Math.abs(tx.bookingDate!.getTime() - l.date!.getTime()) / DAY }))
        .sort((x, y) => x.d - y.d);
      if (ranked.length >= 2 && ranked[0]!.d <= 20 && ranked[1]!.d - ranked[0]!.d >= 10) return { ledgerId: ranked[0]!.l.id, confidence: 'good' };
    }
  }

  // 3. montant + date + nom de contrepartie (départage plusieurs candidats)
  if (near.length > 1 && tx.counterpartyName) {
    const byName = near.filter(
      (l) => nameOverlap(tx.counterpartyName!, l.supplierName ?? '') || nameOverlap(tx.counterpartyName!, l.contactName ?? ''),
    );
    if (byName.length === 1) return { ledgerId: byName[0]!.id, confidence: 'good' };
  }

  // 4. montant + sens + nom, sans limite de date — paiements très en retard (> 45 j) où
  // la date de l'écriture (émission de la facture, souvent un artefact d'import historique)
  // n'a jamais reflété une vraie date de paiement. Restreint à une correspondance de montant
  // UNIQUE dans tout le grand livre + nom de contrepartie cohérent, pour limiter le risque de
  // faux positif malgré l'absence de filtre sur la date.
  if (tx.counterpartyName) {
    const sameAmount = ledgers.filter((l) => sideMatches(tx, l) && Math.abs(amountOf(l) - amt) <= 0.02);
    if (sameAmount.length === 1) {
      const l = sameAmount[0]!;
      if (nameOverlap(tx.counterpartyName, l.supplierName ?? '') || nameOverlap(tx.counterpartyName, l.contactName ?? '')) {
        return { ledgerId: l.id, confidence: 'good' };
      }
    }
  }
  return null;
}

