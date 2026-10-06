/**
 * Rapprochement automatique : relie une transaction bancaire à une écriture
 * du grand livre (LedgerEntry — ventes et achats).
 *
 *  - « strong » : communication structurée identique
 *  - « good »   : même montant (± 2 c) + date proche (± 45 j) + sens cohérent,
 *                 et une seule écriture candidate — ou, à défaut, même montant
 *                 (unique dans tout le grand livre) + sens + nom de contrepartie
 *                 cohérent, sans limite de date (voir ci-dessous)
 *
 * La date comparée est celle de l'écriture (émission de la facture pour une vente),
 * pas la date de paiement réelle — donc la fenêtre doit couvrir des délais de
 * paiement normaux (30 jours net + quelques jours), pas seulement un paiement
 * immédiat. 10 j ratait des cas réels payés en temps normal (ex. facture émise le
 * 13/08, payée le 26/08 — 13 j, hors fenêtre). Élargi à 45 j, puis complété par un
 * dernier recours sans limite de date : certaines factures historiques (import
 * TrustUp) ont été payées plusieurs mois après leur émission (ex. ACP Stade 11,
 * 102 j) — largement hors de toute fenêtre raisonnable. Dans ce cas, un montant
 * très spécifique et unique dans tout le grand livre, combiné à un nom de
 * contrepartie qui correspond, suffit à lever l'ambiguïté sans risque réel de
 * faux positif.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { round2 } from '@jjd/shared';
import { syncLedgerEntryForDocument } from './documents.js';
import { PAYMENT_TOLERANCE } from './payment-tolerance.js';

/**
 * Recalcule `paidAmount`/`status`/`paidOn` d'une facture de vente à partir des
 * transactions bancaires RÉELLEMENT rapprochées (directement, ou via son écriture
 * de grand livre synchronisée) — jamais en écrasant avec le total de la facture.
 * Appelé après chaque ajout/retrait manuel de rapprochement : un paiement peut être
 * réparti sur plusieurs transactions (acompte + solde en plusieurs fois), il ne faut
 * donc ni marquer "payé" dès le premier rapprochement partiel, ni perdre les autres
 * paiements déjà liés quand on en retire un.
 */
export async function recomputeDocumentPayment(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { totalTtc: true, status: true, number: true } });
  if (!doc) return;
  // Statuts qui ne relèvent pas du cycle paiement (jamais touchés ici).
  if (doc.status === 'credited' || doc.status === 'declined' || doc.status === 'draft') return;

  const matches = await prisma.bankTransactionMatch.findMany({
    where: {
      OR: [
        { documentId },
        { ledgerEntry: { documentId } },
        // facture historique (Excel) pas encore liée à son Document : ses paiements comptent aussi
        ...(doc.number ? [{ ledgerEntry: { documentId: null, docNumber: doc.number, direction: { in: ['sale', 'credit_note'] } } }] : []),
      ],
    },
    select: { amount: true, bankTransaction: { select: { amount: true, bookingDate: true } } },
  });
  // part affectée à cette facture si le virement en solde plusieurs, sinon tout le montant de la transaction
  const paidAmount = round2(matches.reduce((s, m) => s + (m.amount ?? Math.abs(m.bankTransaction.amount ?? 0)), 0));
  const bookingDates = matches.map((m) => m.bankTransaction.bookingDate).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime());
  const paidOn = bookingDates[0] ?? null;
  const status = matches.length === 0 ? 'sent' : paidAmount + PAYMENT_TOLERANCE >= doc.totalTtc ? 'paid' : 'partial';

  await prisma.document.update({ where: { id: documentId }, data: { status, paidAmount, paidOn } });
  await syncLedgerEntryForDocument(documentId);
}

/** Comptes de JJD Consult (Belfius, ING) : un virement entre les deux n'est ni un encaissement ni un paiement. */
const OWN_IBANS = ['BE31068949400055', 'BE64363254694152'];
const alnum = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Lignes qu'on ne rapproche jamais automatiquement à une facture : virements entre comptes JJD, recharges de cartes
 *  prépayées et relevés VISA (prélèvement mensuel global) — ce sont des mouvements d'argent internes, les vrais achats
 *  par carte étant saisis ligne par ligne. */
export function isInternalMovement(tx: { description?: string | null; counterpartyAccount?: string | null }): boolean {
  if (OWN_IBANS.includes(alnum(tx.counterpartyAccount))) return true;
  const d = tx.description ?? '';
  return /VERS\s+BE64\s?3632\s?5469\s?4152|VAN:\s*JJD CONSULT\s*-\s*BE31068949400055|CHARGEMENT.{0,40}(VISA|PREPAID)|VISA RELEVE|RELEVE NUMERO/i.test(d);
}

/** Numéros de facture/devis cités dans un libellé bancaire (« F2026-336 », « F20260215 », « D2026-280 »…), normalisés. */
export function invoiceTokens(text: string): string[] {
  return [...new Set([...text.matchAll(/(?<![A-Za-z0-9])[A-Za-z]{0,4}\d{4}[-/]?\d{2,8}(?![A-Za-z0-9])/g)].map((m) => alnum(m[0])))];
}

/**
 * Le libellé cite le n° d'UNE facture connue : c'est la preuve la plus forte, même si le paiement est partiel
 * (acompte, solde…). Retenu si le sens est cohérent et si le montant ne dépasse pas ce qui reste à payer.
 * Deux factures citées (paiement groupé) ou aucune → null (à traiter à la main).
 */
export function pickCitedMatch(
  tx: { amount: number | null; side: string | null; description?: string | null; communication?: string | null },
  byNumber: Map<string, LedgerLite[]>,
  outstanding: (l: LedgerLite) => number,
): string | null {
  const amt = Math.abs(tx.amount ?? 0);
  if (!amt) return null;
  const targets = new Map<string, LedgerLite>();
  for (const token of invoiceTokens(`${tx.description ?? ''} ${tx.communication ?? ''}`)) {
    for (const l of byNumber.get(token) ?? []) if (sideMatches(tx as TxLite, l)) targets.set(l.documentId ?? l.id, l);
  }
  if (targets.size !== 1) return null;
  const l = [...targets.values()][0]!;
  const left = outstanding(l);
  return left > 0.02 && amt <= left + 0.02 ? l.id : null;
}

/** Message libre du paiement : « Mededeling » ING, ou colonne « Communications » Belfius. */
export function paymentMessage(tx: { description?: string | null; communication?: string | null }): string {
  const d = (tx.description ?? '').replace(/\s+/g, ' ');
  const ing = d.match(/Mededeling:\s*(.*?)(?:\s*Persoonlijke info.*)?$/i)?.[1];
  return (ing ?? (tx.communication ?? '')).replace(/\s+/g, ' ').trim();
}

/**
 * Numéros de facture listés dans un message (« Factures F2026/ 65,66,67 », « F2026 302 291 290 », « F-182 »…).
 * Écarte dates, années, codes type « VB26/338 » et numéros de devis ; un message tronqué (« 28... ») perd son dernier
 * nombre, incomplet.
 */
export function invoiceNumbersIn(message: string): number[] {
  if (!/factur|^\s*F[\s\d.\-/]|\bF\d/i.test(message)) return [];
  let cleaned = message
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, ' ')
    .replace(/\b[A-Za-z]{1,3}\d{2}\/\d{2,}\b/g, ' ')
    .replace(/\bD\d{4}-?\d+\b/gi, ' ');
  const truncated = /\d+\s*\.{2,}|…/.test(cleaned);
  if (truncated) cleaned = cleaned.replace(/\d+\s*(\.{2,}|…).*$/, ' ');
  const out = new Set<number>();
  for (const m of cleaned.matchAll(/\b(\d{1,4})\b/g)) {
    const n = Number(m[1]);
    if (m[1]!.length === 4 && n >= 2000 && n <= 2100) continue; // une année, pas un numéro
    if (n > 0) out.add(n);
  }
  return [...out];
}

/**
 * Paiement groupé : le message liste plusieurs factures de vente (ou une seule, partiellement payée). Retenu si la
 * somme de ce qui reste à payer sur les factures citées égale exactement le virement, ou, à défaut, si UN seul
 * sous-ensemble des factures citées l'égale. Renvoie la part affectée à chaque facture.
 */
export function pickGroupedMatch(
  tx: { amount: number | null; side: string | null; bookingDate: Date | null; description?: string | null; communication?: string | null },
  saleIndex: Map<string, LedgerLite[]>, // « 2026-65 » -> écritures de vente F2026-065
  outstanding: (l: LedgerLite) => number,
): { ledgerId: string; amount: number }[] | null {
  const amt = round2(Math.abs(tx.amount ?? 0));
  if (!amt || tx.side !== 'in' || !tx.bookingDate) return null;
  const nums = invoiceNumbersIn(paymentMessage(tx));
  if (!nums.length) return null;
  const year = tx.bookingDate.getUTCFullYear();
  const cands = new Map<string, { l: LedgerLite; left: number }>();
  for (const n of nums) {
    const found = [year, year - 1].map((y) => saleIndex.get(`${y}-${n}`) ?? []).find((a) => a.length) ?? [];
    for (const l of found) {
      const left = round2(outstanding(l));
      if (left > 0.02 && (!l.date || l.date.getTime() <= tx.bookingDate.getTime() + 3 * DAY)) cands.set(l.id, { l, left });
    }
  }
  const list = [...cands.values()];
  if (!list.length) return null;
  const total = round2(list.reduce((s, c) => s + c.left, 0));
  if (Math.abs(total - amt) <= 0.05) return list.map((c) => ({ ledgerId: c.l.id, amount: c.left }));
  if (list.length === 1 && amt < list[0]!.left - 0.02) return [{ ledgerId: list[0]!.l.id, amount: amt }]; // paiement partiel
  if (list.length > 16) return null;
  const hits: number[] = [];
  for (let mask = 1; mask < 1 << list.length && hits.length < 2; mask++) {
    let sum = 0;
    for (let i = 0; i < list.length; i++) if (mask & (1 << i)) sum += list[i]!.left;
    if (Math.abs(sum - amt) <= 0.05) hits.push(mask);
  }
  if (hits.length !== 1) return null; // aucune combinaison, ou plusieurs : à trancher à la main
  return list.filter((_, i) => hits[0]! & (1 << i)).map((c) => ({ ledgerId: c.l.id, amount: c.left }));
}

/**
 * Document de vente qui correspond à une écriture du grand livre : celui auquel elle est synchronisée ou — pour une
 * facture historique (Excel) restée non liée — le Document de même numéro. Sans cela un paiement rapproché à l'écriture
 * laissait la facture « en retard » (c'était le cas pour F2026-166).
 */
export async function documentIdForLedger(ledgerId: string): Promise<string | null> {
  const l = await prisma.ledgerEntry.findUnique({ where: { id: ledgerId }, select: { documentId: true, direction: true, docNumber: true } });
  if (!l) return null;
  if (l.documentId) return l.documentId;
  if ((l.direction !== 'sale' && l.direction !== 'credit_note') || !l.docNumber) return null;
  const docs = await prisma.document.findMany({ where: { number: l.docNumber, kind: { in: ['invoice', 'deposit_invoice', 'credit_note'] } }, select: { id: true }, take: 2 });
  return docs.length === 1 ? docs[0]!.id : null;
}

export interface TxLite {
  id: string;
  amount: number | null;
  bookingDate: Date | null;
  structuredComm: string | null;
  counterpartyName: string | null;
  side: string | null; // "in" | "out"
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

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const DAY = 86_400_000;

// mots trop génériques pour discriminer une contrepartie
const STOP = new Set(['acp', 'sprl', 'bvba', 'srl', 'nv', 'sa', 'the', 'les', 'des', 'and', 'ets', 'via']);
/** Deux libellés partagent-ils un mot significatif (> 3 lettres, hors mots vides) ? */
export function nameOverlap(a: string, b: string): boolean {
  const keep = (w: string) => w.length > 3 && !STOP.has(w);
  const wa = new Set(norm(a).split(/\s+/).filter(keep));
  return norm(b).split(/\s+/).filter(keep).some((w) => wa.has(w));
}

function sideMatches(tx: TxLite, l: LedgerLite): boolean {
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

const amountOf = (l: LedgerLite) => Math.abs(l.ttc ?? l.ht ?? 0);

/** Cherche la meilleure écriture pour une transaction. */
export function pickMatch(tx: TxLite, candidates: LedgerLite[]): { ledgerId: string; confidence: 'strong' | 'good' } | null {
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
    if (Math.abs(amountOf(l) - amt) > 0.02) return false;
    if (tx.bookingDate && l.date && Math.abs(tx.bookingDate.getTime() - l.date.getTime()) > 45 * DAY) return false;
    return true;
  });
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

/**
 * Migration paresseuse : au démarrage, matérialise les anciens liens uniques (matchedLedgerId /
 * matchedDocumentId, posés avant l'introduction de BankTransactionMatch) en vraies lignes de
 * rapprochement — idempotent (ne retraite jamais une transaction déjà migrée), sûr à rappeler à
 * chaque redémarrage.
 */
export async function backfillBankMatches(): Promise<number> {
  const legacy = await prisma.bankTransaction.findMany({
    where: { OR: [{ matchedLedgerId: { not: null } }, { matchedDocumentId: { not: null } }], matches: { none: {} } },
    select: { id: true, matchedLedgerId: true, matchedDocumentId: true },
  });
  if (!legacy.length) return 0;
  await prisma.bankTransactionMatch.createMany({
    data: legacy.map((t) => ({ bankTransactionId: t.id, ledgerEntryId: t.matchedLedgerId, documentId: t.matchedDocumentId })),
  });
  return legacy.length;
}

/**
 * Rapproche automatiquement les transactions non liées.
 * @returns nombre de rapprochements créés, par niveau de confiance.
 */
export async function autoMatchAll(
  opts: { onlyUnmatched?: boolean; txFilter?: Prisma.BankTransactionWhereInput } = {},
): Promise<{ strong: number; good: number; scanned: number }> {
  const txs = await prisma.bankTransaction.findMany({
    where: { ...(opts.onlyUnmatched === false ? {} : { matches: { none: {} } }), ...opts.txFilter },
    select: { id: true, amount: true, bookingDate: true, structuredComm: true, counterpartyName: true, side: true, description: true, communication: true, counterpartyAccount: true },
    orderBy: { bookingDate: 'desc' },
  });

  const ledgerRows = await prisma.ledgerEntry.findMany({
    select: {
      id: true, ttc: true, ht: true, date: true, direction: true, bankComm: true, docNumber: true,
      supplierName: true, contact: { select: { name: true } }, documentId: true,
    },
  });
  const ledgers: LedgerLite[] = ledgerRows.map((l) => ({
    id: l.id, ttc: l.ttc, ht: l.ht, date: l.date, direction: l.direction, bankComm: l.bankComm,
    supplierName: l.supplierName, contactName: l.contact?.name ?? null, documentId: l.documentId,
  }));
  const docNumberById = new Map(ledgerRows.map((l) => [l.id, alnum(l.docNumber)]));
  const rawNumberById = new Map(ledgerRows.map((l) => [l.id, (l.docNumber ?? '').trim()]));
  const documentIdByLedger = new Map(ledgers.map((l) => [l.id, l.documentId]));
  // écritures historiques (Excel) non liées : on les rattache à leur Document de même numéro pour que le paiement se répercute
  const twinIds = new Set<string>();
  {
    const saleDocs = await prisma.document.findMany({ where: { kind: { in: ['invoice', 'deposit_invoice', 'credit_note'] }, number: { not: null } }, select: { id: true, number: true } });
    const idByNumber = new Map<string, string | null>();
    for (const d of saleDocs) { const k = d.number!.trim(); idByNumber.set(k, idByNumber.has(k) ? null : d.id); }
    for (const l of ledgerRows) {
      if (l.documentId || (l.direction !== 'sale' && l.direction !== 'credit_note') || !l.docNumber) continue;
      const id = idByNumber.get(l.docNumber.trim());
      if (id) { documentIdByLedger.set(l.id, id); twinIds.add(l.id); }
    }
  }

  // index montant (au centime) + index communication structurée -> lookup O(1)
  const byAmount = new Map<number, LedgerLite[]>();
  const byComm = new Map<string, LedgerLite[]>();
  for (const l of ledgers) {
    const k = Math.round(amountOf(l) * 100);
    const bucket = byAmount.get(k);
    if (bucket) bucket.push(l); else byAmount.set(k, [l]);
    const c = digits(l.bankComm);
    if (c.length >= 10) {
      const cb = byComm.get(c);
      if (cb) cb.push(l); else byComm.set(c, [l]);
    }
  }

  const now = new Date();
  const updates: { id: string; ledgerId: string; confidence: 'strong' | 'good'; amount?: number }[] = [];

  // Déjà payé par écriture (somme des paiements rapprochés) et index des écritures par n° de facture.
  const ledgerByDocument = new Map(ledgers.filter((l) => l.documentId).map((l) => [l.documentId!, l.id]));
  const paid = new Map<string, number>();
  for (const m of await prisma.bankTransactionMatch.findMany({ select: { ledgerEntryId: true, documentId: true, amount: true, bankTransaction: { select: { amount: true } } } })) {
    const lid = m.ledgerEntryId ?? (m.documentId ? ledgerByDocument.get(m.documentId) : undefined);
    if (lid) paid.set(lid, (paid.get(lid) ?? 0) + (m.amount ?? Math.abs(m.bankTransaction.amount ?? 0)));
  }
  const byNumber = new Map<string, LedgerLite[]>();
  for (const l of ledgers) {
    const n = docNumberById.get(l.id) ?? '';
    if (n.length >= 5) { const b = byNumber.get(n); if (b) b.push(l); else byNumber.set(n, [l]); }
  }
  const outstanding = (l: LedgerLite) => amountOf(l) - (paid.get(l.id) ?? 0);
  // chronologique : un acompte puis un solde sur la même facture s'additionnent dans l'ordre
  const citedDone = new Set<string>();
  const ledgerTotal = new Map(ledgers.map((l) => [l.id, amountOf(l)]));
  for (const tx of [...txs].sort((a, b) => (a.bookingDate?.getTime() ?? 0) - (b.bookingDate?.getTime() ?? 0))) {
    if (isInternalMovement(tx)) continue;
    const lid = pickCitedMatch(tx, byNumber, outstanding);
    if (!lid) continue;
    updates.push({ id: tx.id, ledgerId: lid, confidence: 'strong' });
    paid.set(lid, (paid.get(lid) ?? 0) + Math.abs(tx.amount ?? 0));
    citedDone.add(tx.id);
  }
  // paiements groupés / partiels dont le message liste les numéros de facture (ventes), chronologique
  const saleIndex = new Map<string, LedgerLite[]>();
  for (const l of ledgers) {
    if (l.direction !== 'sale') continue;
    const m = /^F(\d{4})-0*(\d+)$/i.exec(rawNumberById.get(l.id) ?? '');
    if (m) { const k = `${m[1]}-${Number(m[2])}`; const b = saleIndex.get(k); if (b) b.push(l); else saleIndex.set(k, [l]); }
  }
  for (const tx of [...txs].sort((a, b) => (a.bookingDate?.getTime() ?? 0) - (b.bookingDate?.getTime() ?? 0))) {
    if (isInternalMovement(tx) || citedDone.has(tx.id)) continue;
    const g = pickGroupedMatch(tx, saleIndex, outstanding);
    if (!g) continue;
    for (const part of g) { updates.push({ id: tx.id, ledgerId: part.ledgerId, confidence: 'strong', amount: part.amount }); paid.set(part.ledgerId, (paid.get(part.ledgerId) ?? 0) + part.amount); }
    citedDone.add(tx.id);
  }

  for (const tx of txs) {
    const amt = Math.round(Math.abs(tx.amount ?? 0) * 100);
    if (!amt) continue;
    if (isInternalMovement(tx) || citedDone.has(tx.id)) continue;
    const pool: LedgerLite[] = [];
    if (tx.structuredComm) pool.push(...(byComm.get(tx.structuredComm) ?? []));
    for (let d = -2; d <= 2; d++) pool.push(...(byAmount.get(amt + d) ?? []));
    const open = pool.filter((l) => (paid.get(l.id) ?? 0) + 0.02 < amountOf(l)); // une écriture déjà soldée par d'autres paiements n'est plus candidate
    const m = pickMatch(tx as TxLite, open);
    if (m) { updates.push({ id: tx.id, ledgerId: m.ledgerId, confidence: m.confidence }); paid.set(m.ledgerId, (paid.get(m.ledgerId) ?? 0) + Math.abs(tx.amount ?? 0)); }
  }

  // date de la transaction (pour poser paidOn sur l'écriture rapprochée)
  const txDate = new Map(txs.map((t) => [t.id, t.bookingDate]));

  // Écritures synchronisées depuis une facture de vente (LedgerEntry.documentId non nul,
  // voir syncLedgerEntryForDocument) : la FACTURE est la source de vérité, pas le grand
  // livre. La marquer payée directement ici (sans passer par le Document) désynchronise
  // durablement facture et grand livre — c'est exactement le bug remonté le 2026-09-30
  // (facture restée « envoyée » malgré un rapprochement bancaire réussi).
  const docUpdates = updates.filter((u) => documentIdByLedger.get(u.ledgerId));
  const ledgerOnlyUpdates = updates.filter((u) => !documentIdByLedger.get(u.ledgerId));

  // écriture par lots : transactions bancaires + statut « payé » des écritures non liées à une facture
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);
    await prisma.$transaction([
      ...batch.map((u) =>
        prisma.bankTransactionMatch.create({ data: { bankTransactionId: u.id, ledgerEntryId: u.ledgerId, amount: u.amount ?? null } }),
      ),
      ...batch.map((u) =>
        prisma.bankTransaction.update({ where: { id: u.id }, data: { matchConfidence: u.confidence, matchedAt: now } }),
      ),
      ...ledgerOnlyUpdates
        .filter((u) => batch.includes(u) && (paid.get(u.ledgerId) ?? 0) + 0.02 >= (ledgerTotal.get(u.ledgerId) ?? 0))
        .map((u) =>
          prisma.ledgerEntry.update({
            where: { id: u.ledgerId },
            data: { paymentStatus: 'Payé', paidOn: txDate.get(u.id) ?? now },
          }),
        ),
    ]);
  }

  // factures de vente : on passe par le Document puis on répercute sur le grand livre
  // (syncLedgerEntryForDocument), au lieu d'écrire directement dans LedgerEntry.
  for (const documentId of new Set(docUpdates.map((u) => documentIdByLedger.get(u.ledgerId)!))) {
    await recomputeDocumentPayment(documentId); // somme des paiements réellement rapprochés : payée, ou partielle
  }
  // écriture historique que la synchro n'a pas pu lier au Document (montant différent) : statut posé directement, comme avant
  for (const u of docUpdates.filter((x) => twinIds.has(x.ledgerId))) {
    const le = await prisma.ledgerEntry.findUnique({ where: { id: u.ledgerId }, select: { documentId: true } });
    if (!le?.documentId && (paid.get(u.ledgerId) ?? 0) + 0.02 >= (ledgerTotal.get(u.ledgerId) ?? 0)) {
      await prisma.ledgerEntry.update({ where: { id: u.ledgerId }, data: { paymentStatus: 'Payé', paidOn: txDate.get(u.id) ?? now } });
    }
  }

  const strong = updates.filter((u) => u.confidence === 'strong').length;
  return { strong, good: updates.length - strong, scanned: txs.length };
}
