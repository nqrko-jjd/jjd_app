export interface StockUnit { name: string; factor: number }
export interface StockItem {
  id: string; ref: string | null; name: string; brand: string | null; unit: string; qty: number; minQty: number | null; low: boolean;
  location: string | null; photoThumbUrl: string | null; photoUrl: string | null; category: string | null; units: StockUnit[];
  barcodes?: { id: string; code: string; unitName: string | null }[];
}
export interface OrderLine {
  id: string; qty: number; pickedQty: number; unitName: string | null; note: string | null;
  stockItem: { id: string; ref: string | null; name: string; brand: string | null; unit: string; qty: number; photoThumbUrl: string | null };
}
export interface StockOrder {
  id: string; ref: string; status: string; neededOn: string | null; note: string | null;
  worksite: { id: string; ref: string; title: string; city?: string | null };
  lines: OrderLine[];
}

/** 12,5 → « 12,5 » ; 12 → « 12 » (pas de décimales inutiles). */
export const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
