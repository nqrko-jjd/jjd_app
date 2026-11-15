/**
 * Montants d'une facture lue en texte (pdftotext -raw) : HT, TVA, TTC et taux. Partie pure, testable
 * (document-totals.test.ts) — utilisée par document-extract.ts.
 */
import { parseAmount } from '@jjd/shared';

function lineAndNext(text: string, atIndex: number): string {
  const rest = text.slice(atIndex);
  const lines = rest.split('\n');
  return `${lines[0] ?? ''}\n${lines[1] ?? ''}`;
}

// un montant belge peut grouper les milliers par point OU espace : "1.498,17" / "1 498,17"
const AMOUNT = '([\\d]+(?:[.,\\s\\u00A0][\\d]+)*)';
// repli tableau uniquement : montant "propre" à 2 décimales, SANS tolérer l'espace comme
// séparateur de milliers — sur une ligne de tableau l'espace sépare des CELLULES
// différentes ("3 326.49 326.49 21. 68.56 395.05"), pas les milliers d'un même montant ;
// le pattern souple ci-dessus fusionnerait plusieurs colonnes en un seul nombre absurde
const AMOUNT_STRICT_G = /(\d+[.,]\d{2})/g;

export function findTotals(text: string): { ht: number | null; vat: number | null; ttc: number | null; vatRate: number | null } {
  // les conditions générales imprimées en annexe (Clicpublic…) citent des montants (« minimum de 100,00 Eur »)
  // qu'il ne faut pas prendre pour un total : on s'arrête à leur titre, s'il vient après le récapitulatif
  const legal = text.search(/\n[^\S\n]*CONDITIONS G[ÉE]N[ÉE]RALES(?: DE VENTE)?[^\S\n]*\n/);
  if (legal > 200) text = text.slice(0, legal);
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
    ?? text.match(new RegExp(`(?:net${S}[àa]${S}payer|montant${S}total|total${S}[àa]${S}payer|te${S}betalen)[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    // « Total - Totaal: € 36,30 » (Clicpublic) : la ligne « Total » nue, en fin de récapitulatif
    ?? text.match(new RegExp(`(?:^|\\n)${S}total(?:${S}[-–/]${S}totaal)?${S}:${S}€?${S}${AMOUNT}`, 'i'));
  const htM = text.match(new RegExp(`total${S}h\\.?t\\.?v\\.?a\\.?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    // « Total HT - Totaal excl. BTW: € 30,00 » : libellé bilingue, le montant vient après le second
    ?? text.match(new RegExp(`total${S}h\\.?t\\.?\\b[^\\d\\n]{0,40}?€${S}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total${S}h\\.?t\\.?\\b[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total${S}\\(?${S}hors${S}tva${S}\\)?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total${S}sans${S}tva[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    // "Montant hors taxes 500,00" (Teknocom et d'autres outils SaaS de facturation) — variante
    // sans le mot "total" du tout
    ?? text.match(new RegExp(`montant${S}hors${S}taxes?[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`totaal${S}excl\\.?${S}btw[^\\d\\n]{0,15}${AMOUNT}`, 'i'));
  // \b après "tva" pour ne pas matcher dans "TVAC" (Total TVAC = le TTC, pas la TVA)
  const vatAmtM = text.match(new RegExp(`total${S}(?:montant${S})?tva\\b[^\\d\\n]{0,25}\\d{1,2}(?:[,.]\\d+)?${S}%[^\\d\\n]{0,10}${AMOUNT}`, 'i'))
    ?? text.match(new RegExp(`total${S}(?:montant${S})?tva\\b[^\\d\\n]{0,15}${AMOUNT}`, 'i'))
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
  const payIdx = text.search(/[aà]\s*payer/i);
  if (ttc == null) {
    // dernier repli, mise en page en tableau : en-tête "... A PAYER" / "Total ... TVAC" puis
    // les montants sur la ligne suivante -> on prend le dernier montant de cette zone (la
    // colonne "total" est presque toujours la dernière du tableau)
    if (payIdx !== -1) {
      const zone = lineAndNext(text, payIdx);
      const nums = [...zone.matchAll(AMOUNT_STRICT_G)].map((m) => parseAmount(m[1])).filter((n): n is number => n != null);
      if (nums.length) ttc = nums[nums.length - 1]!;
    }
  }

  if ((ht == null || vat == null) && ttc != null && payIdx !== -1) {
    // même mise en page en tableau (Vector 3, BigMat, Sani Mat… vraisemblablement le même
    // logiciel de facturation chez plusieurs grossistes) : la ligne de valeurs répète le HT
    // (colonnes "Tot-Marchandise"/"Tot-Htva" puis "Base Taxable"), puis le taux de TVA tronqué
    // en "NN." SANS le symbole % (qui n'est que dans l'en-tête de colonne "%-TVA"), puis le
    // montant de TVA lui-même. On ne les accepte que si HT + TVA retombe exactement sur le TTC
    // déjà connu (± 2 c) — sinon on risquerait de prendre un nombre sans rapport pour la TVA.
    const zone = lineAndNext(text, payIdx);
    for (const m of zone.matchAll(/\b(\d{1,2})\.\s+(\d+[.,]\d{2})\b/g)) {
      const rate = Number(m[1]);
      if (rate < 1 || rate > 30) continue;
      const vatCand = parseAmount(m[2]);
      const priorNums = [...zone.slice(0, m.index).matchAll(AMOUNT_STRICT_G)];
      const htCand = priorNums.length ? parseAmount(priorNums[priorNums.length - 1]![1]) : null;
      if (vatCand == null || htCand == null || Math.abs(htCand + vatCand - ttc) >= 0.02) continue;
      if (ht == null) ht = htCand;
      if (vat == null) vat = vatCand;
      if (vatRate == null) vatRate = rate / 100;
      break;
    }
  }

  return { ht, vat, ttc, vatRate };
}

