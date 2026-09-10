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
  dueOn: string | null; // ISO — échéance
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
  /** Autres références chantier trouvées dans le texte (une même facture peut couvrir
   *  plusieurs chantiers) — seule la 1ère (`worksiteId`) est prérempli, à répartir à la main. */
  otherWorksiteRefs: string[];
  textExtracted: boolean;
}

const EMPTY: DocumentExtraction = {
  kind: null, issuedOn: null, dueOn: null, docNumber: null, totalHt: null, totalVat: null, totalTtc: null, vatRate: null,
  vatNumbersFound: [], contactId: null, contactName: null, contactConfidence: null,
  worksiteId: null, worksiteRef: null, otherWorksiteRefs: [], textExtracted: false,
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

/**
 * Beaucoup de factures (imprimés de caisse/ERP) mettent les libellés de colonne sur une
 * ligne d'en-tête et les valeurs sur la ligne suivante ("Date No-Tva No-Cl. No-Doc." puis
 * "09/09/26 BE... 3958 20/358741") — le texte -raw les sépare donc par un saut de ligne,
 * sans rien entre le libellé et la valeur sur la MÊME ligne. Les helpers ci-dessous captent
 * ce cas : ligne du repère + ligne suivante, on prend le dernier jeton pertinent de la zone.
 */
function lineAndNext(text: string, atIndex: number): string {
  const rest = text.slice(atIndex);
  const lines = rest.split('\n');
  return `${lines[0] ?? ''}\n${lines[1] ?? ''}`;
}

const DATE_RE = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g;
const validDate = (day: number, month: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31;

/**
 * 1ère date plausible proche (jusqu'à `window` caractères après) la 1ère occurrence de
 * `label` dans le texte. jj/mm/aaaa OU jj/mm/aa (beaucoup de factures belges datent sur 2
 * chiffres). Le tout premier motif "chiffre/chiffre/chiffre" du texte entier peut être un
 * faux ami (n° de téléphone…), donc on ne s'arrête pas au premier candidat trouvé après le
 * repère mais au premier qui est une date plausible.
 */
function findDateNear(text: string, label: RegExp, window: number): string | null {
  const labelIdx = text.search(label);
  if (labelIdx === -1) return null;
  const candidates = [...text.matchAll(DATE_RE)];
  const best = candidates.find((m) => m.index! >= labelIdx && m.index! - labelIdx < window && validDate(Number(m[1]), Number(m[2])));
  if (!best) return null;

  const day = Number(best[1]);
  const month = Number(best[2]);
  const year = Number(best[3]) + (Number(best[3]) < 100 ? 2000 : 0);
  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function findDate(text: string): string | null {
  const near = findDateNear(text, /date/i, 60);
  if (near) return near;
  // aucun repère "date" trouvé (ou rien de plausible à proximité) -> 1er motif de date
  // plausible n'importe où dans le texte
  const candidates = [...text.matchAll(DATE_RE)];
  const best = candidates.find((m) => validDate(Number(m[1]), Number(m[2])));
  if (!best) return null;
  const day = Number(best[1]);
  const month = Number(best[2]);
  const year = Number(best[3]) + (Number(best[3]) < 100 ? 2000 : 0);
  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Date d'échéance : proche du mot "échéance" (accents variables selon l'encodage du PDF). */
function findDueDate(text: string): string | null {
  return findDateNear(text, /[ée]ch[ée]ance/i, 40);
}

/** N° de document (facture/devis/avoir) — best-effort, juste après un mot-clé. */
function findDocNumber(text: string): string | null {
  const m = text.match(/(?:facture|devis|note\s+de\s+cr[ée]dit|avoir|offre)\s*n[°o]\.?\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{1,24})/i)
    ?? text.match(/num[eé]ro\s*(?:\/\s*date)?\s*du\s*document\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{1,24})/i)
    ?? text.match(/\bn[°o]\.?\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{2,24})\b/i);
  if (m) return m[1]!.replace(/[.\-/]+$/, '');

  // repli mise en page en tableau : en-tête "No-Doc." (ou variantes, y compris avec un tiret
  // typographique "−" plutôt qu'un tiret ASCII selon la police du PDF d'origine), n° de
  // document = dernier jeton de la ligne de valeurs qui suit
  const idx = text.search(/no[\s\-‐-―−]{0,2}doc\.?/i);
  if (idx === -1) return null;
  const nextLine = lineAndNext(text, idx).split('\n')[1] ?? '';
  const tokens = nextLine.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  return last && /[A-Z0-9]/i.test(last) ? last.replace(/[.,;]+$/, '') : null;
}

/**
 * Références chantier JJD (R-xxx / E-xx) citées dans le texte — normalisées ("R-69") même
 * si le document les écrit autrement (sans tiret, avec des zéros de tête : "R069" côté
 * fournisseur, dans son champ "Votre référence" par exemple). Dédoublonnées, dans l'ordre
 * d'apparition.
 */
export function findWorksiteRefCandidates(text: string): string[] {
  return [...new Set(
    [...text.matchAll(/\b([RE])[\s-]?(\d{2,5})\b/gi)].map((m) => `${m[1]!.toUpperCase()}-${Number(m[2])}`),
  )];
}

// un montant belge peut grouper les milliers par point OU espace : "1.498,17" / "1 498,17"
const AMOUNT = '([\\d]+(?:[.,\\s\\u00A0][\\d]+)*)';
// repli tableau uniquement : montant "propre" à 2 décimales, SANS tolérer l'espace comme
// séparateur de milliers — sur une ligne de tableau l'espace sépare des CELLULES
// différentes ("3 326.49 326.49 21. 68.56 395.05"), pas les milliers d'un même montant ;
// le pattern souple ci-dessus fusionnerait plusieurs colonnes en un seul nombre absurde
const AMOUNT_STRICT_G = /(\d+[.,]\d{2})/g;

function findTotals(text: string): { ht: number | null; vat: number | null; ttc: number | null; vatRate: number | null } {
  const ttcM = text.match(new RegExp(`total\\s*(?:ttc|tvac)[^\\d]{0,15}${AMOUNT}`, 'i'))
    // "Montant de la facture 24,99" / "Montant de vente(À payer) 411,98" — cherché AVANT le
    // "à payer" générique ci-dessous : un document déjà réglé a souvent, plus loin, un
    // second repère "(Total) à payer 0,00" qui désigne le RESTE à payer, pas le montant total
    ?? text.match(new RegExp(`montant\\s*de\\s*(?:la\\s*facture|vente)[^\\d]{0,25}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`(?:net\\s*[àa]\\s*payer|montant\\s*total|total\\s*[àa]\\s*payer)[^\\d]{0,15}${AMOUNT}`, 'i'));
  const htM = text.match(new RegExp(`total\\s*h\\.?t\\.?v\\.?a\\.?[^\\d]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total\\s*hors\\s*tva[^\\d]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total\\s*sans\\s*tva[^\\d]{0,15}${AMOUNT}`, 'i'));
  // \b après "tva" pour ne pas matcher dans "TVAC" (Total TVAC = le TTC, pas la TVA)
  const vatAmtM = text.match(new RegExp(`total\\s*tva\\b[^\\d]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`\\btva\\s*\\d{1,2}(?:[,.]\\d+)?\\s*%[^\\d]{0,15}${AMOUNT}`, 'i'));
  // taux en %, décimales tolérées ("21,00%" et pas seulement "21%")
  const vatRateM = text.match(/tva\s*(\d{1,2})(?:[,.]\d+)?\s*%/i);
  const vatRate = vatRateM ? Number(vatRateM[1]) / 100 : null;
  const ht = htM ? parseAmount(htM[1]) : null;

  let ttc = ttcM ? parseAmount(ttcM[1]) : null;
  if (ttc == null && ht != null) {
    // le HT est connu (repère fiable) mais pas le TTC -> déduit du taux de TVA (par défaut
    // 21 % BE) plutôt que de risquer le repli "à payer" ci-dessous, qui peut tomber sur un
    // reste-à-payer à 0 (facture déjà réglée) au lieu du montant total réel
    ttc = Math.round(ht * (1 + (vatRate ?? 0.21)) * 100) / 100;
  }
  if (ttc == null) {
    // dernier repli, mise en page en tableau : en-tête "... A PAYER" / "Total ... TVAC" puis
    // les montants sur la ligne suivante -> on prend le dernier montant de cette zone (la
    // colonne "total" est presque toujours la dernière du tableau)
    const idx = text.search(/[aà]\s*payer/i);
    if (idx !== -1) {
      const zone = lineAndNext(text, idx);
      const nums = [...zone.matchAll(AMOUNT_STRICT_G)].map((m) => parseAmount(m[1])).filter((n): n is number => n != null);
      if (nums.length) ttc = nums[nums.length - 1]!;
    }
  }

  return {
    ht,
    vat: vatAmtM ? parseAmount(vatAmtM[1]) : null,
    ttc,
    vatRate,
  };
}

export interface ParsedDocumentText {
  kind: DocumentExtraction['kind'];
  issuedOn: string | null;
  dueOn: string | null;
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
    dueOn: findDueDate(text),
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

  const { kind, issuedOn, dueOn, docNumber, totalHt, totalVat, totalTtc, vatRate, vatNumbersFound } = parseDocumentText(text);

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
    // limité à l'en-tête du document (identité de l'émetteur/destinataire) : le reste
    // (coordonnées bancaires, mentions légales…) peut contenir un nom qui coïncide par
    // hasard avec un contact existant sans rapport (ex. "Belfius" comme nom de banque)
    const lower = text.slice(0, 800).toLowerCase();
    let best: { id: string; name: string } | null = null;
    for (const c of candidates) {
      const name = c.name.trim();
      if (name.length < 4 || !lower.includes(name.toLowerCase())) continue;
      if (!best || name.length > best.name.length) best = { id: c.id, name };
    }
    if (best) { contactId = best.id; contactName = best.name; contactConfidence = 'name'; }
  }

  // chantier : référence JJD (R-xxx / E-xx) citée dans le document — pas toujours telle
  // quelle : un fournisseur la reprend souvent sans tiret ni zéros de tête dans son propre
  // champ "Votre référence" (ex. "R069" pour "R-69"), donc on normalise avant de chercher
  let worksiteId: string | null = null;
  let worksiteRef: string | null = null;
  let otherWorksiteRefs: string[] = [];
  const refs = findWorksiteRefCandidates(text);
  if (refs.length) {
    // toutes les références citées peuvent correspondre à un chantier réel (une facture
    // peut couvrir plusieurs chantiers) -> on ne pré-remplit que la 1ère, les autres sont
    // juste signalées pour que l'utilisateur sache qu'il faut peut-être répartir la dépense
    const matches = await prisma.worksite.findMany({ where: { ref: { in: refs } }, select: { id: true, ref: true } });
    const ordered = refs.map((r) => matches.find((w) => w.ref === r)).filter((w): w is { id: string; ref: string } => !!w);
    if (ordered.length) {
      worksiteId = ordered[0]!.id;
      worksiteRef = ordered[0]!.ref;
      otherWorksiteRefs = ordered.slice(1).map((w) => w.ref);
    }
  }

  return {
    kind, issuedOn, dueOn, docNumber,
    totalHt, totalVat, totalTtc, vatRate,
    vatNumbersFound, contactId, contactName, contactConfidence,
    worksiteId, worksiteRef, otherWorksiteRefs, textExtracted: true,
  };
}
