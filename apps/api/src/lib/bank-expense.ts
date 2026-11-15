/**
 * Sorties bancaires SANS facture : mensualité de crédit, domiciliation (assurance, leasing), frais bancaires, parking…
 * Il n'y a aucune facture d'achat à rapprocher : on crée la dépense directement depuis la ligne du relevé (le relevé fait
 * office de justificatif), rangée sous un poste (ex. « E-12 · Crédit Auto ») ou un chantier, et rapprochée d'office.
 *
 * Une RÈGLE retient le choix pour les prélèvements qui reviennent : « texte contenu dans la ligne → poste + fournisseur ».
 * Elle s'applique aux sorties pas encore rapprochées, à la création de la règle puis après chaque synchro ou import.
 * Les règles sont stockées dans le réglage `bankExpenseRules`.
 */
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { findFleetHit, type FleetHit, type FleetIndex } from './bank-fleet.js';

export interface BankExpenseRule {
  id: string;
  /** texte cherché (sans tenir compte des majuscules) dans la contrepartie, le libellé, la communication et l'IBAN */
  pattern: string;
  worksiteId: string;
  supplierName: string;
  notes: string | null;
  createdAt: string;
  createdById: string | null;
}

const RULES_KEY = 'bankExpenseRules';

export async function listBankExpenseRules(): Promise<BankExpenseRule[]> {
  const s = await prisma.setting.findUnique({ where: { key: RULES_KEY } });
  return Array.isArray(s?.value) ? (s!.value as unknown as BankExpenseRule[]) : [];
}
async function saveRules(rules: BankExpenseRule[]) {
  await prisma.setting.upsert({ where: { key: RULES_KEY }, update: { value: rules as never }, create: { key: RULES_KEY, value: rules as never } });
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function txText(tx: { counterpartyName: string | null; description: string | null; communication: string | null; counterpartyAccount: string | null }) {
  return norm([tx.counterpartyName, tx.description, tx.communication, tx.counterpartyAccount].filter(Boolean).join(' '));
}
export function ruleMatches(pattern: string, text: string) {
  const p = norm(pattern);
  return p.length >= 3 && text.includes(p);
}

/**
 * Texte proposé pour une règle : ce qui reste stable d'un mois à l'autre. Un n° de crédit (071-9542735-33) ou de
 * contrat de domiciliation d'abord, sinon l'IBAN de la contrepartie, sinon son nom.
 */
export function suggestPattern(tx: { counterpartyName: string | null; description: string | null; communication: string | null; counterpartyAccount: string | null }): string {
  const text = [tx.description, tx.communication].filter(Boolean).join(' ');
  const loan = /\b\d{3}-\d{7}-\d{2}\b/.exec(text)?.[0];
  if (loan) return loan;
  if (tx.counterpartyAccount && tx.counterpartyAccount.replace(/\s/g, '').length >= 12) return tx.counterpartyAccount.replace(/\s/g, '');
  const name = (tx.counterpartyName ?? '').trim();
  if (name.length >= 3) return name;
  return text.replace(/\bREF\.?\s*:.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

const derive = (date: Date) => {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
};

/** Crée la dépense « sans facture » d'une sortie bancaire et la rapproche pour tout le montant restant. */
export async function createExpenseFromBankTx(
  txId: string,
  input: { worksiteId: string; supplierName: string; notes?: string | null; vehicleId?: string | null; fineId?: string | null },
  actorId: string | null,
  how: 'manual' | 'rule' | 'fleet' = 'manual',
) {
  return prisma.$transaction(async (db) => {
    const tx = await db.bankTransaction.findUnique({ where: { id: txId }, include: { matches: { select: { amount: true } } } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');
    if ((tx.amount ?? 0) >= 0) throw new HttpError(422, 'Seule une sortie d’argent peut devenir une dépense.');
    if (tx.pairedTxId) throw new HttpError(409, 'Cette transaction est liée à un remboursement : détachez-le d’abord.');
    const ws = await db.worksite.findUnique({ where: { id: input.worksiteId }, select: { id: true, ref: true } });
    if (!ws) throw new HttpError(422, 'Choisissez le poste ou le chantier.');
    // une liaison sans montant couvre toute la transaction
    const already = tx.matches.some((m) => m.amount == null) ? Math.abs(tx.amount ?? 0) : tx.matches.reduce((s, m) => s + (m.amount ?? 0), 0);
    const amount = Math.round((Math.abs(tx.amount ?? 0) - already) * 100) / 100;
    if (amount <= 0) throw new HttpError(409, 'Ce paiement est déjà entièrement rapproché.');
    const date = tx.bookingDate ?? tx.valueDate ?? new Date();
    const label = [tx.counterpartyName, tx.description].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 300);
    const entry = await db.ledgerEntry.create({
      data: {
        ...derive(date),
        date,
        direction: 'purchase',
        docType: 'Sans facture (relevé bancaire)',
        supplierName: input.supplierName.trim() || tx.counterpartyName || 'Banque',
        worksiteId: ws.id,
        worksiteRef: ws.ref,
        vehicleId: input.vehicleId || null,
        // montant payé, TVA comprise s'il y en a : sans facture, pas de TVA récupérable connue
        ht: amount,
        ttc: amount,
        notes: [input.notes?.trim(), `Créée depuis le relevé bancaire : ${label}`].filter(Boolean).join('\n'),
        paymentStatus: 'Payé',
        paidOn: date,
        source: how === 'rule' ? 'bank-rule' : how === 'fleet' ? 'bank-fleet' : 'bank',
        createdById: actorId,
      },
    });
    await db.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, ledgerEntryId: entry.id, amount } });
    await db.bankTransaction.update({ where: { id: tx.id }, data: { matchConfidence: how, matchedAt: new Date() } });
    // PV reconnu : il passe « Payé » à la date du relevé
    if (input.fineId) await db.fine.updateMany({ where: { id: input.fineId, OR: [{ status: null }, { status: { not: 'Payé' } }] }, data: { status: 'Payé', paidOn: date } });
    return entry;
  });
}

/** Ajoute une règle et l'applique aussitôt aux sorties pas encore rapprochées qui la vérifient. */
export async function addBankExpenseRule(
  input: { pattern: string; worksiteId: string; supplierName: string; notes?: string | null },
  actorId: string | null,
): Promise<{ rule: BankExpenseRule; applied: number }> {
  const pattern = input.pattern.trim();
  if (norm(pattern).length < 3) throw new HttpError(422, 'Le texte de la règle doit faire au moins 3 caractères.');
  const rules = await listBankExpenseRules();
  const rule: BankExpenseRule = {
    id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    pattern, worksiteId: input.worksiteId, supplierName: input.supplierName.trim(), notes: input.notes?.trim() || null,
    createdAt: new Date().toISOString(), createdById: actorId,
  };
  await saveRules([...rules.filter((r) => norm(r.pattern) !== norm(pattern)), rule]);
  const { created } = await applyBankExpenseRules([rule]);
  return { rule, applied: created };
}

export async function deleteBankExpenseRule(id: string) {
  const rules = await listBankExpenseRules();
  await saveRules(rules.filter((r) => r.id !== id));
}

/** Flotte : financements, assurances et PV non payés, pour la reconnaissance des sorties bancaires. */
export async function loadFleetIndex(): Promise<FleetIndex> {
  const [vehicles, insurances, fines] = await Promise.all([
    prisma.vehicle.findMany({
      select: {
        id: true, code: true, plate: true, brand: true, model: true, acquisitionMode: true, financeCompany: true,
        financeContract: true, monthlyPayment: true, financeEndOn: true, payments: { select: { dueOn: true, amount: true } },
      },
    }),
    prisma.insurance.findMany({ select: { vehicleId: true, provider: true, contractNumber: true, monthlyAmount: true, annualAmount: true } }),
    prisma.fine.findMany({ where: { OR: [{ status: null }, { status: { not: 'Payé' } }] }, select: { id: true, vehicleId: true, reference: true, amount: true, payTo: true } }),
  ]);
  return { vehicles, insurances, fines };
}

/** Poste de frais (E-12…) d'une reconnaissance « flotte » → id du chantier-poste ; null s'il n'existe pas. */
const postIdCache = new Map<string, string | null>();
export async function overheadIdByRef(ref: string): Promise<string | null> {
  if (!postIdCache.has(ref)) {
    const w = await prisma.worksite.findFirst({ where: { ref, kind: 'overhead' }, select: { id: true } });
    postIdCache.set(ref, w?.id ?? null);
  }
  return postIdCache.get(ref)!;
}
export async function fleetHitForTx(txId: string): Promise<(FleetHit & { worksiteId: string | null }) | null> {
  const tx = await prisma.bankTransaction.findUnique({ where: { id: txId }, select: { amount: true, bookingDate: true, counterpartyName: true, description: true, communication: true, counterpartyAccount: true } });
  if (!tx) return null;
  const hit = findFleetHit(tx, await loadFleetIndex());
  return hit ? { ...hit, worksiteId: await overheadIdByRef(hit.postRef) } : null;
}

/**
 * Applique les règles aux sorties non rapprochées (sans facture trouvée par le rapprochement automatique),
 * puis — sauf si on n'applique qu'une règle précise — la reconnaissance « flotte » (crédits, leasing, assurances, PV).
 */
export async function applyBankExpenseRules(only?: BankExpenseRule[]): Promise<{ created: number; fleet: number }> {
  const rules = only ?? (await listBankExpenseRules());
  const ruleCount = rules.length ? await applyRules(rules) : 0;
  const fleet = only ? 0 : await applyFleet().catch((e) => { console.warn('[bank-expense] flotte', (e as Error).message); return 0; });
  return { created: ruleCount + fleet, fleet };
}

async function applyFleet(): Promise<number> {
  const idx = await loadFleetIndex();
  if (!idx.vehicles.length && !idx.insurances.length && !idx.fines.length) return 0;
  const txs = await prisma.bankTransaction.findMany({
    where: { amount: { lt: 0 }, pairedTxId: null, matches: { none: {} } },
    select: { id: true, amount: true, bookingDate: true, counterpartyName: true, description: true, communication: true, counterpartyAccount: true },
  });
  let created = 0;
  for (const tx of txs) {
    const hit = findFleetHit(tx, idx);
    if (!hit) continue;
    const worksiteId = await overheadIdByRef(hit.postRef);
    if (!worksiteId) continue;
    try {
      await createExpenseFromBankTx(tx.id, { worksiteId, supplierName: hit.supplierName, notes: hit.label, vehicleId: hit.vehicleId, fineId: hit.fineId }, null, 'fleet');
      if (hit.fineId) idx.fines = idx.fines.filter((f) => f.id !== hit.fineId);
      created++;
    } catch (e) {
      console.warn('[bank-expense] flotte non appliquée à', tx.id, (e as Error).message);
    }
  }
  return created;
}

async function applyRules(rules: BankExpenseRule[]): Promise<number> {
  const txs = await prisma.bankTransaction.findMany({
    where: { amount: { lt: 0 }, pairedTxId: null, matches: { none: {} } },
    select: { id: true, counterpartyName: true, description: true, communication: true, counterpartyAccount: true },
  });
  let created = 0;
  for (const tx of txs) {
    const text = txText(tx);
    const rule = rules.find((r) => ruleMatches(r.pattern, text));
    if (!rule) continue;
    try {
      await createExpenseFromBankTx(tx.id, { worksiteId: rule.worksiteId, supplierName: rule.supplierName, notes: rule.notes }, rule.createdById, 'rule');
      created++;
    } catch (e) {
      console.warn('[bank-expense] règle', rule.pattern, 'non appliquée à', tx.id, (e as Error).message);
    }
  }
  return created;
}
