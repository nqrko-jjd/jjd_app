/**
 * Rentabilité d'un chantier — le cœur de l'app.
 *
 * TrustUp calcule « devisé − dépenses encodées », aveugle au temps passé.
 * Ici la marge se base sur le RÉEL : CA encaissé − coût matériaux − coût
 * main-d'œuvre (issu du pointage validé × taux de la fiche personne).
 *
 * Reproduit la logique de l'onglet « Calculs détails JJD » :
 *   Bénéfice = Montant Payé − (Coût main d'oeuvre + Coût matériaux)
 * et ajoute la marge prévisionnelle (sur devis) et la marge sur facturé.
 */

import { round2 } from './money.js';
import { ENTITY_PROFIT_SHARE, type Entity } from './enums.js';

export interface WorksiteCostInput {
  entity: Entity;
  /** Total HT des devis acceptés. */
  quotedHt: number;
  /** Total HT facturé (factures de vente − notes de crédit vente). */
  invoicedHt: number;
  /** Total HT effectivement encaissé. */
  paidHt: number;
  /** Coût matériaux réel (factures d'achat − notes de crédit achat). */
  materialCost: number;
  /** Coût main-d'œuvre réel (Σ pointages validés × taux). */
  labourCost: number;
  /** Coût transport estimé (trajets dépôt ↔ chantier × coût/km du véhicule). Optionnel. */
  vehicleCost?: number;
}

export interface WorksiteMargin {
  quotedHt: number;
  invoicedHt: number;
  paidHt: number;
  materialCost: number;
  labourCost: number;
  /** Coût transport estimé imputé au chantier. */
  vehicleCost: number;
  totalCost: number;
  /** Marge sur ce qui est réellement encaissé (la plus fiable). */
  realMargin: number;
  realMarginPct: number | null;
  /** Marge sur le facturé (encaissé ou non). */
  invoicedMargin: number;
  /** Marge prévisionnelle : devisé − coûts engagés. */
  forecastMargin: number;
  /** Reste à facturer : devisé − déjà facturé. */
  leftToInvoice: number;
  /** Part reversée à l'apporteur (Tonton = 1/3 du bénéfice réel positif). */
  partnerShare: number;
  /** Bénéfice net JJD après part apporteur. */
  netForJjd: number;
}

export function computeWorksiteMargin(input: WorksiteCostInput): WorksiteMargin {
  const materialCost = round2(input.materialCost);
  const labourCost = round2(input.labourCost);
  const vehicleCost = round2(input.vehicleCost ?? 0);
  const totalCost = round2(materialCost + labourCost + vehicleCost);

  const realMargin = round2(input.paidHt - totalCost);
  const invoicedMargin = round2(input.invoicedHt - totalCost);
  const forecastMargin = round2(input.quotedHt - totalCost);
  const leftToInvoice = round2(input.quotedHt - input.invoicedHt);

  const realMarginPct = input.paidHt > 0 ? round2((realMargin / input.paidHt) * 100) : null;

  const shareRate = ENTITY_PROFIT_SHARE[input.entity] ?? 0;
  const partnerShare = realMargin > 0 ? round2(realMargin * shareRate) : 0;
  const netForJjd = round2(realMargin - partnerShare);

  return {
    quotedHt: round2(input.quotedHt),
    invoicedHt: round2(input.invoicedHt),
    paidHt: round2(input.paidHt),
    materialCost,
    labourCost,
    vehicleCost,
    totalCost,
    realMargin,
    realMarginPct,
    invoicedMargin,
    forecastMargin,
    leftToInvoice,
    partnerShare,
    netForJjd,
  };
}

/** Agrège les marges de plusieurs chantiers (dashboard consolidé). */
export function sumMargins(margins: WorksiteMargin[]): WorksiteMargin {
  const z: WorksiteMargin = {
    quotedHt: 0, invoicedHt: 0, paidHt: 0, materialCost: 0, labourCost: 0, vehicleCost: 0,
    totalCost: 0, realMargin: 0, realMarginPct: null, invoicedMargin: 0,
    forecastMargin: 0, leftToInvoice: 0, partnerShare: 0, netForJjd: 0,
  };
  const acc = margins.reduce((a, m) => ({
    ...a,
    quotedHt: a.quotedHt + m.quotedHt,
    invoicedHt: a.invoicedHt + m.invoicedHt,
    paidHt: a.paidHt + m.paidHt,
    materialCost: a.materialCost + m.materialCost,
    labourCost: a.labourCost + m.labourCost,
    vehicleCost: a.vehicleCost + m.vehicleCost,
    totalCost: a.totalCost + m.totalCost,
    realMargin: a.realMargin + m.realMargin,
    invoicedMargin: a.invoicedMargin + m.invoicedMargin,
    forecastMargin: a.forecastMargin + m.forecastMargin,
    leftToInvoice: a.leftToInvoice + m.leftToInvoice,
    partnerShare: a.partnerShare + m.partnerShare,
    netForJjd: a.netForJjd + m.netForJjd,
  }), z);
  for (const k of Object.keys(acc) as (keyof WorksiteMargin)[]) {
    if (typeof acc[k] === 'number') (acc[k] as number) = round2(acc[k] as number);
  }
  acc.realMarginPct = acc.paidHt > 0 ? round2((acc.realMargin / acc.paidHt) * 100) : null;
  return acc;
}
