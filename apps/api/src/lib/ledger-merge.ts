/**
 * Fusion de plusieurs lignes d'une MÊME facture d'achat (même fournisseur, même n°, même sens) en une seule fiche répartie entre leurs chantiers :
 * HT / TTC / TVA additionnés, une part par chantier, un seul PDF, un seul rapprochement bancaire (ceux des lignes fusionnées sont repris).
 * Utilisée par l'écran (POST /api/finance/expenses/merge) et par le script de rattrapage des fiches déjà éclatées.
 */
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { normalizeParts, replaceAllocations } from './ledger-allocation.js';

const sameSupplier = (a: { contactId: string | null; supplierName: string | null }, b: { contactId: string | null; supplierName: string | null }) =>
  (!!a.contactId && a.contactId === b.contactId) || (!!a.supplierName && !!b.supplierName && a.supplierName.trim().toLowerCase() === b.supplierName.trim().toLowerCase());

export interface MergePreview { survivorId: string; docNumber: string | null; ht: number; ttc: number | null; vatRecup: number | null; removed: string[]; parts: { worksiteId: string; ref: string | null; ht: number }[]; warnings: string[] }

/** `dryRun` : ne fait rien, renvoie ce qui serait fait. Les lignes supprimées sont conservées dans le journal. */
export async function mergeEntries(ids: string[], opts: { keepId?: string; dryRun?: boolean; actorId: string | null }): Promise<{ preview: MergePreview; survivorId: string }> {
  z.array(z.string().min(1)).min(2).max(30).parse(ids);
  const rows = await prisma.ledgerEntry.findMany({
    where: { id: { in: ids } },
    include: { allocations: { orderBy: { position: 'asc' } }, bankMatches: { select: { id: true, bankTransactionId: true, amount: true } }, worksite: { select: { ref: true } } },
  });
  if (rows.length !== new Set(ids).size) throw new HttpError(404, 'Une des lignes est introuvable.');
  const first = rows[0]!;
  if (rows.some((r) => r.direction !== first.direction) || !['purchase', 'credit_note'].includes(first.direction)) throw new HttpError(422, 'On ne fusionne que des factures d’achat entre elles, ou des notes de crédit entre elles.');
  const num = (r: { docNumber: string | null }) => (r.docNumber ?? '').trim().toLowerCase();
  if (!num(first) || rows.some((r) => num(r) !== num(first))) throw new HttpError(422, 'Les lignes doivent avoir le même n° de facture.');
  if (rows.some((r) => !sameSupplier(r, first))) throw new HttpError(422, 'Les lignes doivent avoir le même fournisseur.');
  const without = rows.filter((r) => !r.allocations.length && !r.worksiteId);
  if (without.length) throw new HttpError(422, `Affectez d’abord un chantier à toutes les lignes (sans chantier : ${without.map((r) => r.docNumber ?? r.id).join(', ')}).`);

  const keep = (opts.keepId ? rows.find((r) => r.id === opts.keepId) : undefined)
    ?? [...rows].sort((a, b) => Number(b.bankMatches.length > 0) - Number(a.bankMatches.length > 0) || Number(!!b.pdfPath) - Number(!!a.pdfPath) || a.createdAt.getTime() - b.createdAt.getTime())[0]!;
  const others = rows.filter((r) => r.id !== keep.id);
  const sign = keep.ht < 0 ? -1 : 1;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const ht = r2(sign * rows.reduce((s, r) => s + Math.abs(r.ht), 0));
  const ttc = rows.every((r) => r.ttc != null) ? r2(sign * rows.reduce((s, r) => s + Math.abs(r.ttc!), 0)) : null;
  const vat = rows.some((r) => r.vatRecup != null) ? r2(sign * rows.reduce((s, r) => s + Math.abs(r.vatRecup ?? 0), 0)) : null;
  const parts = normalizeParts(ht, rows.flatMap((r) => (r.allocations.length ? r.allocations.map((a) => ({ worksiteId: a.worksiteId, ht: a.ht })) : [{ worksiteId: r.worksiteId!, ht: r.ht }])));
  const refs = new Map(rows.flatMap((r) => (r.worksiteId && r.worksite ? [[r.worksiteId, r.worksite.ref] as [string, string]] : [])));
  const warnings: string[] = [];
  if (new Set(rows.map((r) => r.ht.toFixed(2))).size === 1 && rows.length > 1) warnings.push('Toutes les lignes ont le même montant : s’il s’agit d’un doublon (la même facture saisie deux fois), supprimez l’un des exemplaires au lieu de fusionner, sinon le montant sera doublé.');
  const preview = { survivorId: keep.id, docNumber: keep.docNumber, ht, ttc, vatRecup: vat, removed: others.map((r) => r.id), parts: parts.map((p) => ({ worksiteId: p.worksiteId, ref: refs.get(p.worksiteId) ?? null, ht: p.ht })), warnings };
  if (opts.dryRun) return { preview, survivorId: keep.id };

  const allFox = (f: 'foxExportedAt' | 'foxTransmittedAt') => (rows.every((r) => r[f]) ? keep[f] : null);
  const otherIds = others.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.update({
      where: { id: keep.id },
      data: {
        ht, ttc, vatRecup: vat,
        pdfPath: keep.pdfPath ?? others.find((r) => r.pdfPath)?.pdfPath ?? null,
        foxExportedAt: allFox('foxExportedAt'), foxTransmittedAt: allFox('foxTransmittedAt'),
        paymentStatus: rows.every((r) => (r.paymentStatus ?? '') === 'Payé') ? 'Payé' : keep.paymentStatus === 'Payé' && others.some((r) => (r.paymentStatus ?? '') !== 'Payé') ? 'Non payé' : keep.paymentStatus,
        linesScannedAt: null, linesScanStatus: null,
      },
    });
    await replaceAllocations(tx, keep.id, parts);
    if (!parts.length) await tx.ledgerEntry.update({ where: { id: keep.id }, data: { worksiteId: keep.worksiteId } });
    // paiements bancaires rapprochés : repris par la fiche restante (un même virement présent sur deux lignes ne compte qu'une fois : montants additionnés)
    const keepMatches = new Map(keep.bankMatches.map((m) => [m.bankTransactionId, m]));
    for (const o of others) for (const m of o.bankMatches) {
      const same = keepMatches.get(m.bankTransactionId);
      if (same) {
        await tx.bankTransactionMatch.update({ where: { id: same.id }, data: { amount: same.amount != null && m.amount != null ? r2(same.amount + m.amount) : null } });
        await tx.bankTransactionMatch.delete({ where: { id: m.id } });
      } else { await tx.bankTransactionMatch.update({ where: { id: m.id }, data: { ledgerEntryId: keep.id } }); keepMatches.set(m.bankTransactionId, m); }
    }
    await tx.creditApplication.updateMany({ where: { creditId: { in: otherIds } }, data: { creditId: keep.id } });
    await tx.creditApplication.updateMany({ where: { invoiceId: { in: otherIds } }, data: { invoiceId: keep.id } });
    await tx.ledgerEntry.updateMany({ where: { linkedInvoiceId: { in: otherIds } }, data: { linkedInvoiceId: keep.id } });
    await tx.purchaseReceipt.updateMany({ where: { ledgerEntryId: { in: otherIds } }, data: { ledgerEntryId: keep.id } });
    await tx.vehicleRepair.updateMany({ where: { ledgerEntryId: { in: otherIds } }, data: { ledgerEntryId: keep.id } });
    await tx.purchaseLine.deleteMany({ where: { ledgerEntryId: { in: [keep.id, ...otherIds] } } }); // relues au prochain passage (le PDF est celui de la fiche)
    await tx.ledgerEntry.deleteMany({ where: { id: { in: otherIds } } });
  });
  await prisma.auditLog.create({ data: { actorId: opts.actorId, action: 'expense.merge', entity: 'ledger', entityId: keep.id, meta: { preview, removedRows: JSON.parse(JSON.stringify(others.map(({ bankMatches: _b, worksite: _w, ...r }) => r))) } } }).catch(() => undefined);
  return { preview, survivorId: keep.id };
}
