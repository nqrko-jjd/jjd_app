import type { Prisma } from '@prisma/client';
import {
  computeDocTotals, formatDocNumber, docCounterName, belgianStructuredComm,
  computeDueDate, lineTotalHt, type DocumentLineInput,
} from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { HttpError } from './http.js';

/**
 * Prochain numéro libre pour (kind, année). Le compteur est initialisé au-dessus
 * du plus grand numéro déjà présent (import TrustUp inclus) puis avance ; on
 * saute tout numéro déjà pris par sécurité.
 */
async function nextFreeDocNumber(kind: string, year: number): Promise<{ number: string; seq: number }> {
  const counterName = docCounterName(kind, year);
  const existing = await prisma.counter.findUnique({ where: { name: counterName } });
  if (!existing) {
    const prefix = formatDocNumber(kind, year, 0).replace(/0+$/, '');
    const docs = await prisma.document.findMany({
      where: { kind, number: { startsWith: prefix } },
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
    const clash = await prisma.document.findFirst({ where: { kind, number }, select: { id: true } });
    if (!clash) return { number, seq };
  }
  throw new HttpError(500, 'Impossible d’attribuer un numéro de document');
}

export const docInclude = {
  lines: { orderBy: { position: 'asc' } },
  worksite: { select: { id: true, ref: true, title: true } },
  contact: { select: { id: true, name: true, vat: true, address: true, postalCode: true, city: true, email: true } },
  parent: { select: { id: true, kind: true, number: true, draftRef: true } },
  children: { select: { id: true, kind: true, number: true, draftRef: true, status: true } },
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.DocumentInclude;

/** Prépare les lignes (calcule chaque total HT) pour un createMany / recreate. */
export function buildLineRows(documentId: string, lines: DocumentLineInput[]) {
  return lines.map((l, i) => ({
    documentId,
    position: i,
    kind: l.kind,
    label: l.label,
    description: l.description ?? null,
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
  const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { contact: true } });
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
    [doc.contact?.address, [doc.contact?.postalCode, doc.contact?.city].filter(Boolean).join(' ').trim()]
      .filter(Boolean)
      .join(', ');

  return prisma.document.update({
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
      billingAddress: doc.billingAddress ?? (contactAddress || null),
    },
    include: docInclude,
  });
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
