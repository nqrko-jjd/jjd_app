/**
 * Palettes consignées : reconnaître une ligne de facture / note de crédit fournisseur qui est une palette (caution),
 * et la ranger par type. Facture = palette à rendre (+), note de crédit = palette rendue (−, la quantité est déjà négative).
 */
const PALLET = /\b(palettes?|pallets?|europal|pal\.?\s*euro)\b/i;
// outils et accessoires qui contiennent le mot sans être une caution
const NOT_PALLET = /palux|silicone|joints?|couteau|peinture|spatule|plateau|transpalette|gerbeur|fourche/i;

export function isPalletLine(label: string | null | undefined): boolean {
  const l = (label ?? '').trim();
  return !!l && PALLET.test(l) && !NOT_PALLET.test(l);
}

/** Type lisible : « Euro », « Plaques de plâtre », « Ytong »… (regroupe « PALETTE GARANTIE EURO » et « … NEW EURO »). */
export function palletType(label: string): string {
  const l = label.toUpperCase();
  if (/PLAQUE|PLATRE|PLÂTRE/.test(l)) return 'Plaques de plâtre';
  if (/YTONG/.test(l)) return 'Ytong';
  if (/SACS?\b/.test(l)) return 'Sacs';
  if (/BLOC|ROOSENS/.test(l)) return 'Blocs';
  if (/CIMENT|CCB|COECK/.test(l)) return 'Ciment';
  if (/REMACLE/.test(l)) return 'Remacle';
  if (/MARLUX/.test(l)) return 'Marlux';
  if (/EURO/.test(l)) return 'Euro';
  return 'Palette';
}

export interface PalletMove { entryId: string; date: string | null; docNumber: string | null; credit: boolean; label: string; type: string; qty: number; unitPriceHt: number; totalHt: number }
export interface PalletBalance { type: string; out: number; back: number; net: number; unitPriceHt: number; valueHt: number }

/** Solde par type : rendues − facturées ; la valeur est celle de la caution encore due par le fournisseur. */
export function palletBalances(moves: PalletMove[]): { byType: PalletBalance[]; net: number; valueHt: number } {
  const map = new Map<string, PalletBalance>();
  for (const m of moves) {
    const b = map.get(m.type) ?? { type: m.type, out: 0, back: 0, net: 0, unitPriceHt: m.unitPriceHt, valueHt: 0 };
    if (m.qty >= 0) { b.out += m.qty; b.unitPriceHt = m.unitPriceHt || b.unitPriceHt; } else b.back += -m.qty;
    b.net = Math.round((b.out - b.back) * 100) / 100;
    b.valueHt = Math.round((b.valueHt + m.totalHt) * 100) / 100;
    map.set(m.type, b);
  }
  const byType = [...map.values()].sort((a, b) => b.net - a.net);
  return { byType, net: byType.reduce((s, b) => s + b.net, 0), valueHt: Math.round(byType.reduce((s, b) => s + b.valueHt, 0) * 100) / 100 };
}
