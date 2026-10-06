import type { Prisma } from '@prisma/client';
import {
  computeDocTotals, formatDocNumber, docCounterName, belgianStructuredComm,
  computeDueDate, lineTotalHt, round2, type DocumentLineInput,
} from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { HttpError } from './http.js';
import { PAYMENT_TOLERANCE } from './payment-tolerance.js';
import { sanitizeLineHtml } from './sanitize.js';

/**
 * Prochain numéro libre pour (kind, année). Le compteur est initialisé au-dessus
 * du plus grand numéro déjà présent (import TrustUp inclus) puis avance ; on
 * saute tout numéro déjà pris par sécurité.
 */
/** Une facture d'acompte partage la numérotation des factures (F2026-392), pas de série « FA » à part. */
const numberingKind = (kind: string) => (kind === 'deposit_invoice' ? 'invoice' : kind);
const kindsSharingNumbers = (kind: string) => (kind === 'invoice' ? ['invoice', 'deposit_invoice'] : [kind]);

async function nextFreeDocNumber(docKind: string, year: number): Promise<{ number: string; seq: number }> {
  const kind = numberingKind(docKind);
  const kinds = kindsSharingNumbers(kind);
  const counterName = docCounterName(kind, year);
  const existing = await prisma.counter.findUnique({ where: { name: counterName } });
  if (!existing) {
    const prefix = formatDocNumber(kind, year, 0).replace(/0+$/, '');
    const docs = await prisma.document.findMany({
      where: { kind: { in: kinds }, number: { startsWith: prefix } },
      select: { number: true },
    });
    let max = 0;
    for (const d of docs) {
      const m = d.number?.match(/(\d+)\s*$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    if (max > 0) await prisma.counter.create({ data: { name: counterName, value: max } });
  }
  for (let i = 0; i < 50; i++) {
    const seq = await nextCounter(counterName);
    const number = formatDocNumber(kind, year, seq);
    const clash = await prisma.document.findFirst({ where: { kind: { in: kinds }, number }, select: { id: true } });
    if (!clash) return { number, seq };
  }
  throw new HttpError(500, 'Impossible d’attribuer un numéro de document');
}

export const docInclude = {
  lines: { orderBy: { position: 'asc' } },
  worksite: { select: { id: true, ref: true, title: true } },
  contact: { select: { id: true, name: true, vat: true, address: true, box: true, postalCode: true, city: true, email: true } },
  parent: { select: { id: true, kind: true, number: true, draftRef: true } },
  children: { select: { id: true, kind: true, number: true, draftRef: true, status: true, totalTtc: true, issuedOn: true, lockedAt: true } },
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.DocumentInclude;

/**
 * Prépare les lignes (calcule chaque total HT) pour un createMany / recreate.
 * label/description passent par sanitizeLineHtml : l'éditeur de texte enrichi (gras, couleur…)
 * y écrit du HTML, injecté tel quel côté impression (dangerouslySetInnerHTML, imprimé en PDF via
 * Puppeteer) — jamais de HTML non filtré en base.
 */
export function buildLineRows(documentId: string, lines: DocumentLineInput[]) {
  return lines.map((l, i) => ({
    documentId,
    position: i,
    kind: l.kind,
    label: sanitizeLineHtml(l.label),
    description: l.description ? sanitizeLineHtml(l.description) : null,
    qty: l.qty,
    unit: l.unit ?? null,
    unitPriceHt: l.unitPriceHt,
    discountPct: l.discountPct,
    vatRate: l.vatRate,
    totalHt: lineTotalHt(l),
    priceItemId: l.priceItemId ?? null,
  }));
}

interface StoredLine {
  kind: string; label: string; description: string | null; qty: number; unit: string | null;
  unitPriceHt: number; discountPct: number; vatRate: number; priceItemId: string | null;
}

/** Recopie des lignes existantes vers un nouveau document (totaux recalculés). */
export function cloneLineRows(documentId: string, lines: StoredLine[], override?: (l: StoredLine) => Partial<StoredLine>) {
  return lines.map((src, i) => {
    const l = { ...src, ...(override?.(src) ?? {}) };
    return {
      documentId, position: i, kind: l.kind, label: l.label, description: l.description ?? null,
      qty: l.qty, unit: l.unit ?? null, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct,
      vatRate: l.vatRate, priceItemId: l.priceItemId ?? null,
      totalHt: lineTotalHt(l),
    };
  });
}

/** Recalcule et enregistre les totaux d'un document depuis ses lignes en base. */
export async function refreshDocTotals(documentId: string) {
  const lines = await prisma.documentLine.findMany({ where: { documentId } });
  const t = computeDocTotals(lines);
  const rates = Object.keys(t.vatBreakdown);
  await prisma.document.update({
    where: { id: documentId },
    data: {
      totalHt: t.totalHt,
      totalVat: t.totalVat,
      totalTtc: t.totalTtc,
      vatRate: rates.length === 1 ? Number(rates[0]) : null,
    },
  });
  return t;
}

/**
 * Émet un document : attribue le numéro définitif (compteur continu par type
 * et par année), fige l'instantané client, calcule échéance + communication
 * structurée pour les factures, pose le verrou.
 */
export async function issueDocument(documentId: string, opts: { issuedOn?: Date; dueDays?: number } = {}) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { contact: { include: { syndic: true } } } });
  if (!doc) throw new HttpError(404, 'Document introuvable');
  if (doc.lockedAt) throw new HttpError(409, 'Document déjà émis');

  const issuedOn = opts.issuedOn ?? new Date();
  const year = issuedOn.getFullYear();
  const { number, seq } = await nextFreeDocNumber(doc.kind, year);

  const isInvoiceLike = doc.kind === 'invoice' || doc.kind === 'deposit_invoice';
  const dueOn = isInvoiceLike ? computeDueDate(issuedOn, opts.dueDays ?? 30) : null;
  const structuredComm = isInvoiceLike
    ? belgianStructuredComm(year * 100000 + seq)
    : null;

  const contactAddress =
    [
      [doc.contact?.address, doc.contact?.box && `bte ${doc.contact.box}`].filter(Boolean).join(' '),
      [doc.contact?.postalCode, doc.contact?.city].filter(Boolean).join(' ').trim(),
    ]
      .filter(Boolean)
      .join(', ');
  // L'ACP a une adresse (le chantier, là où on intervient) mais la facture part au
  // siège du syndic qui la gère — d'où la mention « c/o Baltimo » / « c/o Kadaner ».
  const syndic = doc.contact?.syndic;
  const syndicAddress = syndic
    ? [`c/o ${syndic.name}`, syndic.address, syndic.city].filter(Boolean).join(', ')
    : null;

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      number,
      draftRef: null,
      issuedOn,
      dueOn,
      validUntil: doc.kind === 'quote' ? (doc.validUntil ?? computeDueDate(issuedOn, 30)) : doc.validUntil,
      structuredComm,
      lockedAt: new Date(),
      status: 'sent',
      billingName: doc.billingName ?? doc.contact?.name ?? null,
      billingVat: doc.billingVat ?? doc.contact?.vat ?? null,
      billingAddress: doc.billingAddress ?? (syndicAddress || contactAddress || null),
    },
    include: docInclude,
  });
  await syncLedgerEntryForDocument(documentId);
  if (doc.kind === 'credit_note' && doc.parentId) await applyCreditToParent(doc.parentId);
  return updated;
}

/** Total TTC déjà crédité sur une facture (notes de crédit émises qui s'y rattachent), en valeur absolue. */
export async function creditedTtc(parentId: string): Promise<number> {
  const cns = await prisma.document.findMany({ where: { parentId, kind: 'credit_note', lockedAt: { not: null } }, select: { totalTtc: true } });
  return round2(cns.reduce((s, c) => s + Math.abs(c.totalTtc), 0));
}

/**
 * Une facture intégralement créditée (à la tolérance d'arrondi près) passe « créditée » : elle n'est plus à encaisser
 * et son statut de paiement n'est plus recalculé. Un crédit partiel ne change pas son statut. Idempotent.
 */
export async function applyCreditToParent(parentId: string) {
  const p = await prisma.document.findUnique({ where: { id: parentId }, select: { id: true, kind: true, status: true, totalTtc: true } });
  if (!p || (p.kind !== 'invoice' && p.kind !== 'deposit_invoice') || p.status === 'draft' || p.status === 'credited' || p.totalTtc <= 0) return;
  if ((await creditedTtc(p.id)) + PAYMENT_TOLERANCE >= p.totalTtc) {
    await prisma.document.update({ where: { id: p.id }, data: { status: 'credited' } });
    await syncLedgerEntryForDocument(p.id);
  }
}

/**
 * Lignes d'une note de crédit PARTIELLE d'un montant TTC donné. Facture à un seul taux de TVA : une ligne unique au bon
 * montant HT (ajusté au centime pour retomber exactement sur le TTC demandé). Plusieurs taux : les lignes de la facture
 * sont mises à l'échelle proportionnellement.
 */
export function partialCreditLines(
  documentId: string,
  src: { totalTtc: number; vatRate: number | null; lines: StoredLine[] },
  amountTtc: number,
  label: string,
) {
  if (src.vatRate != null) {
    const guess = round2(amountTtc / (1 + src.vatRate));
    const ht = [0, -0.01, 0.01, -0.02, 0.02].map((d) => round2(guess + d))
      .find((h) => computeDocTotals([{ kind: 'item', qty: 1, unitPriceHt: h, discountPct: 0, vatRate: src.vatRate }]).totalTtc === amountTtc) ?? guess;
    return buildLineRows(documentId, [{
      kind: 'item', label, description: null, qty: 1, unit: 'forfait', unitPriceHt: ht, discountPct: 0, vatRate: src.vatRate, priceItemId: null,
    }]);
  }
  const factor = amountTtc / src.totalTtc;
  return cloneLineRows(documentId, src.lines, (l) => ({ unitPriceHt: round2(l.unitPriceHt * factor) }));
}

/**
 * Rattrapage : les factures d'acompte émises avant que la série F soit partagée portaient un
 * numéro « FA2026-001 ». Les renumérote à la suite des factures (F2026-392…), avec leur
 * communication structurée et leur écriture du grand livre. Idempotent : plus rien ne matche
 * une fois rattrapé.
 */
export async function renumberFaDepositInvoices(): Promise<number> {
  const docs = await prisma.document.findMany({
    where: { kind: 'deposit_invoice', number: { startsWith: 'FA' } },
    orderBy: [{ issuedOn: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, issuedOn: true, createdAt: true },
  });
  for (const d of docs) {
    const year = (d.issuedOn ?? d.createdAt).getFullYear();
    const { number, seq } = await nextFreeDocNumber('deposit_invoice', year);
    await prisma.document.update({
      where: { id: d.id },
      data: { number, structuredComm: belgianStructuredComm(year * 100000 + seq) },
    });
    await prisma.ledgerEntry.updateMany({ where: { documentId: d.id }, data: { docNumber: number } });
  }
  return docs.length;
}

function deriveLedgerPeriod(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

/**
 * Fait exister/tient à jour l'écriture du grand livre correspondant à un devis/facture/NC
 * de vente émis — pour que le CA facturé dans l'appli (Devis & factures) alimente Analyse /
 * marge chantier sans repasser par le rattrapage manuel ou le réimport Excel. Appelée après
 * chaque changement de statut de paiement ou d'émission (voir issueDocument, /mark-paid,
 * PATCH /:id) ; sans effet sur les devis (pas du CA) et sur les brouillons (pas encore émis).
 */
export async function syncLedgerEntryForDocument(documentId: string) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true, kind: true, status: true, lockedAt: true, issuedOn: true, number: true,
      worksiteId: true, contactId: true, billingName: true,
      totalHt: true, totalVat: true, totalTtc: true, paidAmount: true, paidOn: true,
      contact: { select: { name: true } },
    },
  });
  if (!doc || !doc.lockedAt || !doc.issuedOn) return;
  const isSaleSide = doc.kind === 'invoice' || doc.kind === 'deposit_invoice' || doc.kind === 'credit_note';
  if (!isSaleSide) return;

  // Une facture historique existe déjà au grand livre (import Excel, documentId nul) : ne JAMAIS en
  // créer une seconde — la vente serait comptée deux fois. Si le montant concorde on adopte
  // l'écriture existante (elle devient l'écriture synchronisée du document), sinon on ne touche
  // à rien et c'est l'écriture historique qui fait foi.
  const existing = await prisma.ledgerEntry.findUnique({ where: { documentId: doc.id }, select: { id: true, source: true } });
  if (!existing && doc.number) {
    const twins = await prisma.ledgerEntry.findMany({
      where: { documentId: null, direction: { in: ['sale', 'credit_note'] }, docNumber: doc.number },
      select: { id: true, ttc: true, ht: true },
    });
    if (twins.length) {
      const t = twins[0]!;
      const sameAmount = Math.abs(Math.abs(t.ttc ?? t.ht) - Math.abs(doc.totalTtc)) < 0.02;
      if (twins.length === 1 && doc.kind !== 'credit_note' && sameAmount) await prisma.ledgerEntry.update({ where: { id: t.id }, data: { documentId: doc.id } });
      else return;
    }
  }
  // écriture reprise de l'Excel : les champs que le document ne renseigne pas (chantier, client) sont conservés
  const current = existing ?? (await prisma.ledgerEntry.findUnique({ where: { documentId: doc.id }, select: { id: true, source: true } }));
  const adopted = !!current && current.source !== 'document-sync';

  const isCredit = doc.kind === 'credit_note';
  const sgn = (n: number) => (isCredit ? -Math.abs(n) : n); // une note de crédit réduit le CA : montants négatifs au grand livre
  // une note de crédit, ou une facture CRÉDITÉE (annulée), n'est jamais « à encaisser » au grand livre, même si elle a reçu un paiement partiel ou nul
  const paymentStatus = isCredit || doc.status === 'credited' || (doc.totalTtc > 0 && doc.paidAmount + PAYMENT_TOLERANCE >= doc.totalTtc) ? 'Payé' : 'Non payé';
  const supplierName = doc.billingName ?? doc.contact?.name ?? null;
  const period = deriveLedgerPeriod(doc.issuedOn);

  await prisma.ledgerEntry.upsert({
    where: { documentId: doc.id },
    create: {
      documentId: doc.id,
      date: doc.issuedOn,
      direction: doc.kind === 'credit_note' ? 'credit_note' : 'sale',
      docType: doc.kind === 'credit_note' ? 'Note de crédit' : 'Facture de vente',
      docNumber: doc.number,
      worksiteId: doc.worksiteId,
      contactId: doc.contactId,
      supplierName,
      categoryRaw: doc.kind === 'credit_note' ? 'Note de crédit vente' : null,
      ht: sgn(doc.totalHt),
      vatDue: sgn(doc.totalVat),
      ttc: sgn(doc.totalTtc),
      paymentStatus,
      paidOn: doc.paidOn,
      source: 'document-sync',
      ...period,
    },
    update: {
      date: doc.issuedOn,
      docNumber: doc.number,
      worksiteId: adopted ? (doc.worksiteId ?? undefined) : doc.worksiteId,
      contactId: adopted ? (doc.contactId ?? undefined) : doc.contactId,
      supplierName: adopted ? (supplierName ?? undefined) : supplierName,
      ht: sgn(doc.totalHt),
      vatDue: sgn(doc.totalVat),
      ttc: sgn(doc.totalTtc),
      paymentStatus,
      paidOn: doc.paidOn,
      ...period,
    },
  });
}

/**
 * Une facture envoyée (ou partiellement payée) dont l'échéance est dépassée passe
 * automatiquement en "En retard". Purement déclaratif — n'affecte ni paidAmount ni
 * le grand livre — donc idempotent et sûr à rejouer à intervalles réguliers.
 */
export async function markOverdueInvoices(now: Date = new Date()) {
  // facture dont l'encaissement couvre le total à l'arrondi près (ex. 18 802,34 € pour 18 802,44 €) : payée,
  // jamais « en retard » — répare aussi celles restées bloquées avant la tolérance (voir payment-tolerance.ts)
  const nearlyPaid = await prisma.document.findMany({
    where: { kind: { in: ['invoice', 'deposit_invoice'] }, status: { in: ['sent', 'partial', 'overdue'] }, paidAmount: { gt: 0 }, totalTtc: { gt: 0 } },
    select: { id: true, totalTtc: true, paidAmount: true },
  });
  for (const d of nearlyPaid.filter((x) => x.paidAmount + PAYMENT_TOLERANCE >= x.totalTtc)) {
    await prisma.document.update({ where: { id: d.id }, data: { status: 'paid' } });
    await syncLedgerEntryForDocument(d.id);
  }
  const r = await prisma.document.updateMany({
    where: {
      kind: { in: ['invoice', 'deposit_invoice'] },
      status: { in: ['sent', 'partial'] },
      dueOn: { lt: now },
    },
    data: { status: 'overdue' },
  });
  return r.count;
}

const COMPANY_DEFAULTS = {
  name: 'JJD Consult SRL',
  address: '',
  postalCode: '',
  city: '',
  vat: '',
  iban: '',
  email: 'info@jjd-consult.be',
  phone: '',
  website: 'www.jjd-consult.be',
  quoteTerms: 'Devis valable 30 jours. Acompte de 30 % à la commande.',
  invoiceTerms: 'Facture payable à 30 jours. Tout retard de paiement entraîne de plein droit et sans mise en demeure un intérêt de 8 % l’an et une indemnité forfaitaire de 40 €.',
};
export type Company = typeof COMPANY_DEFAULTS;

export async function getCompany(): Promise<Company> {
  const row = await prisma.setting.findUnique({ where: { key: 'company' } });
  return { ...COMPANY_DEFAULTS, ...((row?.value as Partial<Company>) ?? {}) };
}
