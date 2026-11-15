/**
 * Reconnaissance des sorties bancaires liées à la FLOTTE, sans règle à créer : la fiche de chaque véhicule
 * connaît déjà son financement (organisme, n° de contrat, mensualité, échéancier), son assurance (assureur,
 * n° de police, prime) et ses PV (référence, montant). Une sortie qui correspond devient une dépense
 * « sans facture » rangée sous le bon poste et rattachée au véhicule ; un PV reconnu passe « Payé ».
 *
 *  - n° de contrat / de police / référence du PV retrouvé dans le libellé (chiffres comparés sans séparateurs) ;
 *  - à défaut, pour le financement et l'assurance : nom de l'organisme dans le libellé ET montant identique
 *    (mensualité de la fiche ou échéance de l'échéancier à ± 20 jours).
 */

export type FleetKind = 'financing' | 'insurance' | 'fine';
export interface FleetHit {
  kind: FleetKind;
  vehicleId: string | null;
  fineId: string | null;
  /** poste de frais : E-12 (financement), E-15 (assurance), E-11 (PV) */
  postRef: string;
  supplierName: string;
  /** « Crédit · V003 Renault Master 1-ABC-123 » — affiché dans la fenêtre de rapprochement et la note */
  label: string;
}

export const FLEET_POST: Record<FleetKind, string> = { financing: 'E-12', insurance: 'E-15', fine: 'E-11' };

interface TxLite { amount: number | null; bookingDate: Date | null; counterpartyName: string | null; description: string | null; communication: string | null; counterpartyAccount: string | null }
export interface FleetIndex {
  vehicles: { id: string; code: string | null; plate: string | null; brand: string | null; model: string | null; acquisitionMode: string | null; financeCompany: string | null; financeContract: string | null; monthlyPayment: number | null; financeEndOn: Date | null; payments: { dueOn: Date | null; amount: number | null }[] }[];
  insurances: { vehicleId: string | null; provider: string | null; contractNumber: string | null; monthlyAmount: number | null; annualAmount: number | null }[];
  fines: { id: string; vehicleId: string | null; reference: string | null; amount: number | null; payTo: string | null }[];
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
/** suites de chiffres du libellé, séparateurs (espace - / . +) retirés : « 071-9542735-33 » → « 071954273533 » */
function digitRuns(text: string): string[] {
  // un seul espace toléré entre deux groupes : « 071 9542735 33 » oui, deux n° séparés par plusieurs espaces non
  return (text.match(/\d(?:[\d\-/.+]| (?=\d))*\d/g) ?? []).map(digits).filter((d) => d.length >= 5);
}
/** un n° de contrat (≥ 6 chiffres) présent dans le libellé */
export function numberInText(num: string | null | undefined, runs: string[]): boolean {
  const n = digits(num);
  return n.length >= 6 && runs.some((r) => r.includes(n));
}
/** nom d'organisme dans le libellé : « Belfius Lease » → cherche « belfius » (1er mot significatif, ≥ 3 lettres) */
export function companyInText(company: string | null | undefined, text: string): boolean {
  const words = norm(company).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['sa', 'nv', 'srl', 'bv', 'the', 'les', 'bank', 'banque', 'lease', 'leasing', 'finance', 'insurance', 'assurances'].includes(w));
  return words.length > 0 && text.includes(words[0]!);
}
const near = (a: number | null | undefined, b: number) => a != null && a > 0 && Math.abs(a - b) <= 0.01;
const DAY = 86_400_000;

function vehicleLabel(v: FleetIndex['vehicles'][number] | undefined) {
  if (!v) return '';
  return [v.code, [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' ');
}

export function findFleetHit(tx: TxLite, idx: FleetIndex): FleetHit | null {
  const amount = Math.abs(tx.amount ?? 0);
  if ((tx.amount ?? 0) >= 0 || amount === 0) return null;
  const raw = [tx.counterpartyName, tx.description, tx.communication].filter(Boolean).join(' ');
  const text = norm(raw + ' ' + (tx.counterpartyAccount ?? ''));
  const runs = digitRuns(raw);
  const when = tx.bookingDate?.getTime() ?? null;
  const vById = new Map(idx.vehicles.map((v) => [v.id, v]));

  // 1) PV : référence + montant
  for (const f of idx.fines) {
    if (numberInText(f.reference, runs) && near(f.amount, amount)) {
      const v = f.vehicleId ? vById.get(f.vehicleId) : undefined;
      return { kind: 'fine', vehicleId: f.vehicleId, fineId: f.id, postRef: FLEET_POST.fine, supplierName: f.payTo || tx.counterpartyName || 'PV', label: ['PV', f.reference, vehicleLabel(v)].filter(Boolean).join(' · ') };
    }
  }

  const financing = (v: FleetIndex['vehicles'][number]): FleetHit => ({
    kind: 'financing', vehicleId: v.id, fineId: null, postRef: FLEET_POST.financing,
    supplierName: v.financeCompany || tx.counterpartyName || 'Financement',
    label: [v.acquisitionMode || 'Financement', vehicleLabel(v)].filter(Boolean).join(' · '),
  });
  const insurance = (i: FleetIndex['insurances'][number]): FleetHit => ({
    kind: 'insurance', vehicleId: i.vehicleId, fineId: null, postRef: FLEET_POST.insurance,
    supplierName: i.provider || tx.counterpartyName || 'Assurance',
    label: ['Assurance', i.provider, vehicleLabel(i.vehicleId ? vById.get(i.vehicleId) : undefined)].filter(Boolean).join(' · '),
  });

  // 2) n° de contrat de financement / de police dans le libellé : sûr, quel que soit le montant
  const byContract = idx.vehicles.filter((v) => numberInText(v.financeContract, runs));
  if (byContract.length === 1) return financing(byContract[0]!);
  const byPolicy = idx.insurances.filter((i) => numberInText(i.contractNumber, runs));
  if (byPolicy.length === 1) return insurance(byPolicy[0]!);

  // 3) organisme dans le libellé + montant identique (mensualité, ou échéance de l'échéancier proche de la date)
  const dueMatches = (v: FleetIndex['vehicles'][number]) =>
    near(v.monthlyPayment, amount)
    || v.payments.some((p) => near(p.amount, amount) && (when == null || p.dueOn == null || Math.abs(p.dueOn.getTime() - when) <= 20 * DAY));
  const finCands = idx.vehicles.filter((v) => companyInText(v.financeCompany, text) && dueMatches(v)
    && !(v.financeEndOn && when != null && v.financeEndOn.getTime() + 45 * DAY < when));
  if (finCands.length === 1) return financing(finCands[0]!);
  if (finCands.length > 1) {
    // même organisme, même mensualité sur plusieurs véhicules : on classe sans choisir le véhicule
    const h = financing(finCands[0]!);
    return { ...h, vehicleId: null, label: `${finCands[0]!.acquisitionMode || 'Financement'} · ${finCands.map((v) => v.code || v.plate).filter(Boolean).join(' ou ')}` };
  }
  const insCands = idx.insurances.filter((i) => companyInText(i.provider, text) && (near(i.monthlyAmount, amount) || near(i.annualAmount, amount)));
  if (insCands.length === 1) return insurance(insCands[0]!);
  if (insCands.length > 1) return { ...insurance(insCands[0]!), vehicleId: null, label: `Assurance · ${insCands[0]!.provider ?? ''} (plusieurs véhicules)` };
  return null;
}
