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
import Anthropic from '@anthropic-ai/sdk';
import { pdftotextAvailable, pdfToRawText } from './bank-pdf.js';
import { parseAmount } from '@jjd/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';

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
  // FR d'abord (contexte majoritaire JJD), puis équivalents NL — beaucoup de fournisseurs
  // belges (Cebeo, Sixt…) facturent en néerlandais, jusqu'ici jamais reconnu.
  if (/note\s+de\s+cr[ée]dit|\bavoir\s+n[°o]|creditnota/i.test(text)) return 'credit_note';
  if (/facture\s+d.?acompte|acompte\s+n[°o]|voorschotfactuur/i.test(text)) return 'deposit_invoice';
  if (/\bfacture\b|\bfactuur\b/i.test(text)) return 'invoice';
  if (/\bdevis\b|\boffre\s+de\s+prix\b|\bofferte\b/i.test(text)) return 'quote';
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

/** Date d'échéance : proche du mot "échéance" (accents variables selon l'encodage du PDF), ou
 *  de son équivalent néerlandais "vervaldatum". */
function findDueDate(text: string): string | null {
  return findDateNear(text, /[ée]ch[ée]ance/i, 40) ?? findDateNear(text, /vervaldatum/i, 40);
}

/** N° de document (facture/devis/avoir) — best-effort, juste après un mot-clé. Le "°" de "N°"
 *  ressort parfois en U+FFFD (caractère de remplacement Unicode) quand `pdftotext` ne sait pas
 *  décoder le glyphe d'origine (vu sur de vraies factures Cebeo) — toléré au même titre que "°"/"o". */
function findDocNumber(text: string): string | null {
  const m = text.match(/(?:facture|devis|note\s+de\s+cr[ée]dit|avoir|offre)\s*n[°o�]\.?\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{1,24})/i)
    ?? text.match(/num[eé]ro\s*(?:\/\s*date)?\s*du\s*document\s*:?\s*([A-Z0-9][A-Z0-9\-/.]{1,24})/i)
    // ordre inversé "Numéro de facture : …" (vu chez ENGIE) — le numéro peut être groupé par
    // espaces ("709 934 470 024"), tolérés tant qu'ils séparent deux blocs alphanumériques.
    ?? text.match(/num[eé]ro\s*de\s*(?:facture|devis|commande)\s*:?\s*([A-Z0-9](?:[A-Z0-9\-/.]|\s(?=[A-Z0-9]))*[A-Z0-9])/i)
    // "Facture INV/2026/0015" (outils de facturation SaaS type Teknocom) : pas de "n°" du tout,
    // juste la référence — repère PREFIXE/ANNÉE/NUMÉRO pour éviter d'attraper une phrase banale
    // ("Facture jointe", "Facture ci-dessous"…) qui suit aussi le mot "facture".
    ?? text.match(/\bfacture\s+([A-Z]{2,8}\/\d{4}\/\d{1,6})\b/i)
    // repli le plus permissif (pas de mot-clé "facture/devis" devant) : la seule contrainte
    // (lookahead, ne consomme rien) est qu'il y ait au moins un chiffre dans le jeton — sinon
    // "novembre", "notre", "nombre"… matchent "n[o]" et capturent la suite du mot comme si
    // c'était un n° de document (vu en prod : "vembre").
    ?? text.match(/\bn[°o]\.?\s*:?\s*(?=[A-Z0-9\-/.]*\d)([A-Z0-9][A-Z0-9\-/.]{2,24})\b/i);

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
  // libellés FR tolérant une parenthèse ("Total (TVA comprise)", "Total (hors TVA)" — ENGIE
  // et d'autres facturiers ERP), puis équivalents NL ("Totaal incl./excl. BTW" — Sixt et
  // autres fournisseurs facturant en néerlandais, jamais reconnus jusqu'ici.
  // `S` = espace/tab MAIS PAS retour à la ligne (contrairement à \s, qui inclut \n — un piège
  // ici : "Total (TVA comprise)" en fin de ligne d'en-tête, suivi de "21%..." sur la ligne
  // suivante, ferait sinon "sauter" le \s* du libellé par-dessus le saut de ligne jusqu'à ce
  // taux de TVA). Utilisée pour CHAQUE espace interne au libellé, pas seulement la fin.
  const S = '[^\\S\\n]*';
  const ttcM = text.match(new RegExp(`total${S}\\(?${S}(?:ttc|tvac|tva${S}comprise)${S}\\)?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`totaal${S}incl\\.?${S}btw[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    // "Montant de la facture 24,99" / "Montant de vente(À payer) 411,98" — cherché AVANT le
    // "à payer" générique ci-dessous : un document déjà réglé a souvent, plus loin, un
    // second repère "(Total) à payer 0,00" qui désigne le RESTE à payer, pas le montant total
    ?? text.match(new RegExp(`montant${S}de${S}(?:la${S}facture|vente)[^\\d\\n]{0,25}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`(?:net${S}[àa]${S}payer|montant${S}total|total${S}[àa]${S}payer|te${S}betalen)[^\\d\\n]{0,15}${AMOUNT}`, 'i'));
  const htM = text.match(new RegExp(`total${S}h\\.?t\\.?v\\.?a\\.?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total${S}\\(?${S}hors${S}tva${S}\\)?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total${S}sans${S}tva[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    // "Montant hors taxes 500,00" (Teknocom et d'autres outils SaaS de facturation) — variante
    // sans le mot "total" du tout
    ?? text.match(new RegExp(`montant${S}hors${S}taxes?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`totaal${S}excl\\.?${S}btw[^\\d\\n]{0,15}${AMOUNT}`, 'i'));
  // \b après "tva" pour ne pas matcher dans "TVAC" (Total TVAC = le TTC, pas la TVA)
  const vatAmtM = text.match(new RegExp(`total${S}(?:montant${S})?tva\\b[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`\\btva${S}\\d{1,2}(?:[,.]\\d+)?${S}%[^\\d\\n]{0,15}${AMOUNT}`, 'i'));
  // taux en %, décimales tolérées ("21,00%" et pas seulement "21%")
  const vatRateM = text.match(/tva\s*(\d{1,2})(?:[,.]\d+)?\s*%/i) ?? text.match(/btw\s*(\d{1,2})(?:[,.]\d+)?\s*%/i);
  let vatRate = vatRateM ? Number(vatRateM[1]) / 100 : null;
  let ht = htM ? parseAmount(htM[1]) : null;
  let vat = vatAmtM ? parseAmount(vatAmtM[1]) : null;
  let ttc = ttcM ? parseAmount(ttcM[1]) : null;

  // Repli "récap TVA" fréquent chez les grossistes (Cebeo…) : pas de libellé "Total TTC/HTVA"
  // du tout, juste un bloc en fin de facture "% NET TAXABLE TVA" puis "<taux>% <net> <net>
  // <tva>" (le net répété deux fois — colonnes "Net" et "Taxable" identiques quand une seule
  // ligne de TVA). Rétro-référence \2 sur ce doublon pour ne PAS confondre avec d'autres
  // tableaux à 3 montants dont les valeurs diffèrent (ex. "<taux>% <ht> <tva> <ttc>", où les
  // 3 nombres sont différents) — ne comble que ce qui manque encore, les libellés priment.
  if (ht == null || ttc == null || vat == null) {
    const m = text.match(/(\d{1,2}(?:[,.]\d+)?)\s*%\s+(\d+[.,]\d{2})\s+\2\s+(\d+[.,]\d{2})\b/);
    if (m) {
      const net = parseAmount(m[2]);
      const vatVal = parseAmount(m[3]);
      if (ht == null) ht = net;
      if (vat == null) vat = vatVal;
      if (vatRate == null) vatRate = Number(m[1]!.replace(',', '.')) / 100;
      if (ttc == null && net != null && vatVal != null) ttc = Math.round((net + vatVal) * 100) / 100;
    }
  }

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

  return { ht, vat, ttc, vatRate };
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

/* --------------------------------------------------------- repli IA (mises en page difficiles) */

const AI_MODEL = 'claude-sonnet-5';
const aiClient = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;

const AI_EXTRACTION_PROMPT = `Tu es un extracteur de données de documents commerciaux belges (facture, devis ou note de crédit fournisseur — en français ou en néerlandais). Le destinataire est toujours "JJD Consult" : ignore-le, seul l'ÉMETTEUR du document t'intéresse.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, aucun bloc markdown), avec exactement ces clés :
{
  "kind": "invoice" | "quote" | "credit_note" | "deposit_invoice" | null,
  "issuedOn": "YYYY-MM-DD" | null,
  "dueOn": "YYYY-MM-DD" | null,
  "docNumber": string | null,
  "totalHt": number | null,
  "totalVat": number | null,
  "totalTtc": number | null,
  "vatRate": number | null,
  "supplierName": string | null,
  "supplierVat": string | null
}

- "totalHt"/"totalVat"/"totalTtc" : montants en euros (nombre, pas de texte, séparateur décimal ".").
- "vatRate" : taux principal en fraction (0.21 pour 21 %, 0 pour une facture en autoliquidation/exonérée).
- "supplierName" : le nom de la société qui émet le document (jamais "JJD Consult").
- "supplierVat" : n° de TVA du fournisseur, normalisé "BE" suivi de 10 chiffres sans espace ni point.
- Mets null pour toute valeur introuvable — n'invente jamais un montant à 0 ou une date par défaut.`;

interface AiExtraction {
  kind?: string | null;
  issuedOn?: string | null;
  dueOn?: string | null;
  docNumber?: string | null;
  totalHt?: number | null;
  totalVat?: number | null;
  totalTtc?: number | null;
  vatRate?: number | null;
  supplierName?: string | null;
  supplierVat?: string | null;
}

const AI_KINDS = new Set(['quote', 'invoice', 'credit_note', 'deposit_invoice']);

/**
 * Repli IA (Claude) quand l'extraction par règles ne trouve rien d'exploitable — mise en page
 * inhabituelle, facture en néerlandais avec libellés/valeurs disjoints, PDF mal décodé par
 * `pdftotext`… Lit directement le PDF (support natif des documents de l'API), donc insensible
 * aux soucis d'encodage rencontrés par `pdftotext`. Dégradation silencieuse : sans clé
 * Anthropic configurée, ou en cas d'erreur/réponse illisible, renvoie simplement `null` — le
 * best-effort par règles reste le résultat final dans ce cas.
 */
async function extractWithAi(buf: Buffer): Promise<AiExtraction | null> {
  if (!aiClient) return null;
  try {
    const response = await aiClient.messages.create({
      model: AI_MODEL,
      max_tokens: 2048, // marge au-delà du JSON attendu : le thinking adaptatif partage le même budget
      thinking: { type: 'adaptive' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
          { type: 'text', text: AI_EXTRACTION_PROMPT },
        ],
      }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const raw = textBlock?.text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiExtraction;
    return parsed;
  } catch {
    return null; // clé absente, quota, JSON illisible… le best-effort par règles reste le résultat
  }
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

  let { kind, issuedOn, dueOn, docNumber, totalHt, totalVat, totalTtc, vatRate, vatNumbersFound } = parseDocumentText(text);
  let aiSupplierName: string | null = null;

  // Repli IA : rien d'exploitable trouvé par les règles (ni montant ni n° de document) -> on
  // retente en lisant le PDF directement avec Claude, qui gère bien mieux les mises en page
  // atypiques et le néerlandais — ne comble que ce qui manque, ne tourne que pour les cas
  // vraiment bloqués (coût maîtrisé : pas un appel par facture, seulement pour celles où les
  // règles échouent complètement).
  if (totalHt == null && totalTtc == null && docNumber == null) {
    const ai = await extractWithAi(buf);
    if (ai) {
      if (kind == null && ai.kind && AI_KINDS.has(ai.kind)) kind = ai.kind as DocumentExtraction['kind'];
      if (issuedOn == null && ai.issuedOn) issuedOn = ai.issuedOn;
      if (dueOn == null && ai.dueOn) dueOn = ai.dueOn;
      if (docNumber == null && ai.docNumber) docNumber = ai.docNumber;
      if (totalHt == null && typeof ai.totalHt === 'number') totalHt = ai.totalHt;
      if (totalVat == null && typeof ai.totalVat === 'number') totalVat = ai.totalVat;
      if (totalTtc == null && typeof ai.totalTtc === 'number') totalTtc = ai.totalTtc;
      if (vatRate == null && typeof ai.vatRate === 'number') vatRate = ai.vatRate;
      if (ai.supplierVat) {
        const v = normVat(ai.supplierVat);
        if (!vatNumbersFound.includes(v)) vatNumbersFound = [...vatNumbersFound, v];
      }
      aiSupplierName = ai.supplierName ?? null;
    }
  }

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
  // ni TVA ni nom connu -> à défaut, le nom que Claude a lu sur le document (fournisseur
  // probablement pas encore dans les contacts JJD) : mieux qu'un champ vide à remplir à la main
  if (!contactName && aiSupplierName) contactName = aiSupplierName;

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
