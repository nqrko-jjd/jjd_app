/**
 * Rattachement d'un PDF de facture à une dépense existante qui n'en a pas : on lit le PDF (n°, date, montants, fournisseur) puis on cherche la dépense
 * qui correspond. Le montant ou le numéro de facture doit coller : une simple date ou un fournisseur identique ne suffisent jamais.
 */
import { prisma } from '../db.js';
import type { DocumentExtraction } from './document-extract.js';

export interface MatchEntry { id: string; date: Date | null; docNumber: string | null; supplier: string | null; contactId: string | null; ht: number; ttc: number | null; worksiteRef: string | null; worksiteKind: string | null }
export interface MatchCandidate { id: string; date: string | null; supplier: string | null; docNumber: string | null; ht: number; ttc: number | null; worksiteRef: string | null; score: number; reasons: string[] }

const normNum = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normName = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
const close = (a: number | null | undefined, b: number | null | undefined, tol = 0.02) => a != null && b != null && Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
const DAY = 86_400_000;

export function matchCandidates(ex: Pick<DocumentExtraction, 'issuedOn' | 'docNumber' | 'totalHt' | 'totalTtc' | 'contactId' | 'contactName'>, entries: MatchEntry[], max = 5): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  for (const e of entries) {
    const reasons: string[] = []; let score = 0;
    const sameNumber = !!ex.docNumber && !!e.docNumber && normNum(ex.docNumber) === normNum(e.docNumber);
    if (sameNumber) { score += 5; reasons.push('même n° de facture'); }
    const amount = close(ex.totalTtc, e.ttc) ? 'TTC' : close(ex.totalHt, e.ht) ? 'HT' : close(ex.totalTtc, e.ht) ? 'TTC' : close(ex.totalHt, e.ttc) ? 'HT' : null;
    if (amount) { score += 4; reasons.push(`même montant ${amount}`); }
    if (!sameNumber && !amount) continue; // ni numéro ni montant : jamais proposé
    if (ex.issuedOn && e.date) {
      const d = Math.abs(new Date(ex.issuedOn).getTime() - e.date.getTime()) / DAY;
      if (d <= 3) { score += 2; reasons.push(d < 1 ? 'même jour' : `à ${Math.round(d)} j`); } else if (d <= 15) { score += 1; reasons.push(`à ${Math.round(d)} j`); }
    }
    if (ex.contactId && e.contactId && ex.contactId === e.contactId) { score += 2; reasons.push('même fournisseur'); }
    else if (ex.contactName && e.supplier && (normName(ex.contactName).includes(normName(e.supplier)) || normName(e.supplier).includes(normName(ex.contactName))) && normName(e.supplier).length > 2) { score += 1; reasons.push('fournisseur proche'); }
    out.push({ id: e.id, date: e.date ? e.date.toISOString().slice(0, 10) : null, supplier: e.supplier, docNumber: e.docNumber, ht: e.ht, ttc: e.ttc, worksiteRef: e.worksiteRef, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Dépenses d'achat sans pièce jointe (E-01 d'abord) comme candidates. */
export async function expensesWithoutPdf(): Promise<MatchEntry[]> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { direction: { in: ['purchase', 'credit_note'] }, pdfPath: null },
    select: { id: true, date: true, docNumber: true, supplierName: true, contactId: true, ht: true, ttc: true, contact: { select: { name: true } }, worksite: { select: { ref: true, kind: true } } },
    orderBy: { date: 'desc' },
    take: 8000,
  });
  return rows.map((r) => ({ id: r.id, date: r.date, docNumber: r.docNumber, supplier: r.contact?.name ?? r.supplierName, contactId: r.contactId, ht: r.ht, ttc: r.ttc, worksiteRef: r.worksite?.ref ?? null, worksiteKind: r.worksite?.kind ?? null }));
}
