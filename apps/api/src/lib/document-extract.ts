/**
 * Pré-remplissage d'un devis/facture/note de crédit importé (PDF externe) :
 * lit le texte du PDF (poppler `pdftotext`, déjà utilisé pour les relevés
 * bancaires — voir bank-pdf.ts) et essaie d'en tirer le type de document, la
 * date, les montants, et de retrouver le client/chantier JJD correspondant.
 *
 * Best-effort seulement : sert à préremplir le formulaire, pas à le
 * remplacer — l'utilisateur corrige ensuite sur la fiche document. Les
 * fichiers sans couche texte (photo/scan) ne sont pas traités ici (pas de
 * lecture visuelle branchée pour l'instant).
 */
import { pdftotextAvailable, pdfToRawText } from './bank-pdf.js';
import { parseAmount } from '@jjd/shared';
import { prisma } from '../db.js';

export interface DocumentExtraction {
  kind: 'quote' | 'invoice' | 'credit_note' | 'deposit_invoice' | null;
  issuedOn: string | null; // ISO (yyyy-mm-dd)
  docNumber: string | null;
  totalHt: number | null;
  totalVat: number | null;
  totalTtc: number | null;
  vatRate: number | null;
  vatNumbersFound: string[];
  contactId: string | null;
  contactName: string | null;
  contactConfidence: 'vat' | 'name' | null;
  worksiteId: string | null;
  worksiteRef: string | null;
  textExtracted: boolean;
}

const EMPTY: DocumentExtraction = {
  kind: null, issuedOn: null, docNumber: null, totalHt: null, totalVat: null, totalTtc: null, vatRate: null,
  vatNumbersFound: [], contactId: null, contactName: null, contactConfidence: null,
  worksiteId: null, worksiteRef: null, textExtracted: false,
};

// n° de TVA belge : "BE" + 10 chiffres, groupés 4-3-3 ("BE0746.980.568") — le 1er chiffre
// peut être 0 (ancien format) ou 1 (nouveaux numéros depuis l'épuisement de la plage 0xxx)
const VAT_RE = /\bBE\s?\d{4}[.\s]?\d{3}[.\s]?\d{3}\b/gi;
const normVat = (v: string) => v.replace(/[^0-9A-Z]/gi, '').toUpperCase();

function detectKind(text: string): DocumentExtraction['kind'] {
  if (/note\s+de\s+cr[ée]dit|\bavoir\s+n[°o]/i.test(text)) return 'credit_note';
  if (/facture\s+d.?acompte|acompte\s+n[°o]/i.test(text)) return 'deposit_invoice';
  if (/\bfacture\b/i.test(text)) return 'invoice';
  if (/\bdevis\b|\boffre\s+de\s+prix\b/i.test(text)) return 'quote';
  return null;
}

function findDate(text: string): string | null {
  const m = text.match(/date[^\d]{0,20}(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i) ?? text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** N° de document (facture/devis/avoir) — best-effort, juste après un mot-clé. */
function findDocNumber(text: string): string | null {
  const m = text.match(/(?:facture|devis|note\s+de\s+cr[ée]dit|avoir|offre)\s*n[°o]\.?\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{1,24})/i)
    ?? text.match(/\bn[°o]\.?\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{2,24})\b/i);
  return m ? m[1]!.replace(/[.\-/]+$/, '') : null;
}

// un montant belge peut grouper les milliers par point OU espace : "1.498,17" / "1 498,17"
const AMOUNT = '([\\d]+(?:[.,\\s\\u00A0][\\d]+)*)';

function findTotals(text: string): { ht: number | null; vat: number | null; ttc: number | null; vatRate: number | null } {
  const ttcM = text.match(new RegExp(`total\\s*(?:ttc|tvac)[^\\d]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`(?:net\\s*[àa]\\s*payer|montant\\s*total|total\\s*[àa]\\s*payer)[^\\d]{0,15}${AMOUNT}`, 'i'));
  const htM = text.match(new RegExp(`total\\s*h\\.?t\\.?v\\.?a\\.?[^\\d]{0,15}${AMOUNT}`, 'i')) ?? text.match(new RegExp(`total\\s*hors\\s*tva[^\\d]{0,15}${AMOUNT}`, 'i'));
  // \b après "tva" pour ne pas matcher dans "TVAC" (Total TVAC = le TTC, pas la TVA)
  const vatAmtM = text.match(new RegExp(`total\\s*tva\\b[^\\d]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`\\btva\\s*\\d{1,2}\\s*%[^\\d]{0,15}${AMOUNT}`, 'i'));
  const vatRateM = text.match(/tva\s*(\d{1,2})\s*%/i);
  return {
    ht: htM ? parseAmount(htM[1]) : null,
    vat: vatAmtM ? parseAmount(vatAmtM[1]) : null,
    ttc: ttcM ? parseAmount(ttcM[1]) : null,
    vatRate: vatRateM ? Number(vatRateM[1]) / 100 : null,
  };
}

export interface ParsedDocumentText {
  kind: DocumentExtraction['kind'];
  issuedOn: string | null;
  docNumber: string | null;
  totalHt: number | null;
  totalVat: number | null;
  totalTtc: number | null;
  vatRate: number | null;
  vatNumbersFound: string[];
}

/** Partie pure (sans I/O ni base de données) — testable directement sur un texte. */
export function parseDocumentText(text: string): ParsedDocumentText {
  const vatNumbersFound = [...new Set([...text.matchAll(VAT_RE)].map((m) => normVat(m[0])))];
  const totals = findTotals(text);
  return {
    kind: detectKind(text),
    issuedOn: findDate(text),
    docNumber: findDocNumber(text),
    totalHt: totals.ht,
    totalVat: totals.vat,
    totalTtc: totals.ttc,
    vatRate: totals.vatRate,
    vatNumbersFound,
  };
}

/**
 * @param contactTypes types de `Contact` à considérer pour le repli "nom trouvé dans le texte"
 *   (le n° de TVA, lui, est cherché sur tous les contacts quel que soit le type). Devis/factures
 *   émis par JJD -> le client (`['client', 'both']`) ; dépense importée -> le fournisseur
 *   (`['supplier', 'both']`).
 */
export async function extractDocumentInfo(
  buf: Buffer,
  mimetype: string,
  contactTypes: string[] = ['client', 'both'],
): Promise<DocumentExtraction> {
  if (mimetype !== 'application/pdf' || !(await pdftotextAvailable())) return EMPTY;
  const text = await pdfToRawText(buf);
  if (!text.trim()) return EMPTY;

  const { kind, issuedOn, docNumber, totalHt, totalVat, totalTtc, vatRate, vatNumbersFound } = parseDocumentText(text);

  // contact : n° de TVA d'abord (fiable, tous types confondus), sinon un nom retrouvé tel quel
  // dans le texte parmi les contacts du type attendu (client pour un devis/facture émis par
  // JJD, fournisseur pour une dépense importée)
  let contactId: string | null = null;
  let contactName: string | null = null;
  let contactConfidence: DocumentExtraction['contactConfidence'] = null;
  if (vatNumbersFound.length) {
    const withVat = await prisma.contact.findMany({ where: { vat: { not: null } }, select: { id: true, name: true, vat: true } });
    const hit = withVat.find((c) => c.vat && vatNumbersFound.includes(normVat(c.vat)));
    if (hit) { contactId = hit.id; contactName = hit.name; contactConfidence = 'vat'; }
  }
  if (!contactId) {
    const candidates = await prisma.contact.findMany({ where: { type: { in: contactTypes } }, select: { id: true, name: true }, take: 3000 });
    const lower = text.toLowerCase();
    let best: { id: string; name: string } | null = null;
    for (const c of candidates) {
      const name = c.name.trim();
      if (name.length < 4 || !lower.includes(name.toLowerCase())) continue;
      if (!best || name.length > best.name.length) best = { id: c.id, name };
    }
    if (best) { contactId = best.id; contactName = best.name; contactConfidence = 'name'; }
  }

  // chantier : référence JJD (R-xxx / E-xx) citée telle quelle dans le document
  let worksiteId: string | null = null;
  let worksiteRef: string | null = null;
  const refs = [...new Set((text.match(/\b[RE]-\d{2,5}\b/gi) ?? []).map((r) => r.toUpperCase()))];
  if (refs.length) {
    const ws = await prisma.worksite.findFirst({ where: { ref: { in: refs } }, select: { id: true, ref: true } });
    if (ws) { worksiteId = ws.id; worksiteRef = ws.ref; }
  }

  return {
    kind, issuedOn, docNumber,
    totalHt, totalVat, totalTtc, vatRate,
    vatNumbersFound, contactId, contactName, contactConfidence,
    worksiteId, worksiteRef, textExtracted: true,
  };
}
