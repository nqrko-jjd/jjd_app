import { prisma } from '../db.js';
import { isPalletLine, palletType, palletBalances, type PalletMove } from './pallets-pure.js';

/** Palettes consignées, lues dans les lignes des factures (+) et notes de crédit (−) fournisseurs. */
export async function palletMoves(contactId?: string): Promise<(PalletMove & { contactId: string | null; supplier: string })[]> {
  const lines = await prisma.purchaseLine.findMany({
    where: {
      OR: [{ label: { contains: 'palet', mode: 'insensitive' } }, { label: { contains: 'pallet', mode: 'insensitive' } }, { label: { contains: 'europal', mode: 'insensitive' } }],
      ledgerEntry: { direction: { in: ['purchase', 'credit_note'] }, ...(contactId ? { contactId } : {}) },
    },
    select: { label: true, qty: true, unitPriceHt: true, totalHt: true, ledgerEntry: { select: { id: true, date: true, docNumber: true, direction: true, contactId: true, supplierName: true, contact: { select: { name: true } } } } },
  });
  return lines
    .filter((l) => isPalletLine(l.label))
    .map((l) => {
      const credit = l.ledgerEntry.direction === 'credit_note';
      // facture : une ligne négative = palettes rendues déduites de la facture ; note de crédit : toujours un retour
      const qty = credit ? -Math.abs(l.qty) : l.qty;
      return {
        entryId: l.ledgerEntry.id, date: l.ledgerEntry.date?.toISOString() ?? null, docNumber: l.ledgerEntry.docNumber, credit, label: l.label,
        type: palletType(l.label), qty, unitPriceHt: Math.abs(l.unitPriceHt), totalHt: qty < 0 ? -Math.abs(l.totalHt) : Math.abs(l.totalHt),
        contactId: l.ledgerEntry.contactId, supplier: l.ledgerEntry.contact?.name ?? l.ledgerEntry.supplierName ?? '—',
      };
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export async function supplierPallets(contactId: string) {
  const moves = await palletMoves(contactId);
  return { ...palletBalances(moves), moves };
}

/** Tous les fournisseurs chez qui des palettes restent à rendre. */
export async function palletsOverview() {
  const moves = await palletMoves();
  const by = new Map<string, typeof moves>();
  for (const m of moves) { const k = m.contactId ?? m.supplier; by.set(k, [...(by.get(k) ?? []), m]); }
  return [...by.values()].map((ms) => ({ contactId: ms[0]!.contactId, supplier: ms[0]!.supplier, lastDate: ms[0]!.date, ...palletBalances(ms) }))
    .filter((s) => s.net !== 0)
    .sort((a, b) => b.net - a.net);
}
