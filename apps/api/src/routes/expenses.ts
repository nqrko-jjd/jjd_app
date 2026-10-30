import { invoiceWorksiteAllocation } from '../lib/invoice-allocation.js';
import { matchCandidates, expensesWithoutPdf } from '../lib/expense-pdf-match.js';
import { peppolReceptionStatus, setPeppolReception, syncPeppolInbox } from '../lib/peppol-inbox.js';
import { linkPurchaseReceipt, createReviewedPurchase, ignorePurchaseReceipt } from '../lib/purchase-receipts.js';
/**
 * Dépenses / factures d'achat — CRUD autour de LedgerEntry (grand livre).
 * L'historique Excel (~5000 lignes) et les saisies manuelles cohabitent ;
 * les rapports (marge chantier, P&L, analyses) lisent déjà LedgerEntry.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prepareFoxZip, foxEligible } from '../lib/fox-export.js';
import type { Prisma } from '@prisma/client';
import path from 'node:path';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import multer from 'multer';
import { zipSync } from 'fflate';
import { expenseInput, linkInvoiceInput, saleEntryBackfillInput, parseAmount, parseLooseDate } from '@jjd/shared';
import { prisma } from '../db.js';
import { insensitive } from '../lib/search.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, FIELD_OFFICE } from '../lib/auth.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';
import { readReceipt } from '../lib/ai-receipt.js';
import { nameOverlap } from '../lib/bank-match.js';
import { allocationSnapshot } from '../lib/bank-allocation.js';
import { purchaseRemaining } from '../lib/payment-tolerance.js';
import { extractDocumentInfo, suggestExpenseCategory } from '../lib/document-extract.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';
import { invoiceMailboxConfigured, syncInvoiceMailbox, reprocessEmailEntries, scanInvoiceMailboxHistory, PROCESSED_MAILBOX, startHistoryImport, historyJobStatus } from '../lib/invoice-mailbox.js';
import { scanAllEntriesForRefs } from '../lib/purchase-ref-scan.js';
import { findPurchaseCandidates } from '../lib/purchase-candidates.js';
import { normalizeParts, replaceAllocations, mainWorksite, type AllocPart } from '../lib/ledger-allocation.js';
import { mergeEntries, invoiceBaseNumber } from '../lib/ledger-merge.js';
import { scanLinesBatch, linesStats, articleSummary, articleOccurrences, getHidden, setHidden, type ArticleFilters } from '../lib/purchase-lines.js';

export const expensesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const inc = {
  worksite: { select: { id: true, ref: true, title: true } },
  vehicle: { select: { id: true, code: true, plate: true, name: true, brand: true, model: true } },
  contact: { select: { id: true, name: true } },
  category: { select: { code: true, label: true } },
  createdBy: { select: { email: true } },
  // bordereau (direction "delivery_slip") -> facture reçue ensuite ; facture -> ses bordereaux liés
  linkedInvoice: { select: { id: true, docNumber: true, date: true, ttc: true, ht: true, paymentStatus: true } },
  bordereaux: { select: { id: true, docNumber: true, date: true, ht: true, ttc: true, pdfPath: true, worksiteId: true, worksite: { select: { ref: true } } }, orderBy: { date: 'asc' as const } },
  _count: { select: { bordereaux: true } },
  // répartition entre plusieurs chantiers (une seule fiche) — voir lib/ledger-allocation.ts
  allocations: { select: { worksiteId: true, ht: true, worksite: { select: { ref: true, title: true } } }, orderBy: { position: 'asc' as const } },
  receipts: { select: { id: true, source: true, xmlPath: true }, where: { source: 'peppol' } },
} as const;

function docTypeOf(direction: string): string {
  return direction === 'credit_note' ? 'Note de crédit' : direction === 'delivery_slip' ? 'Bordereau' : "Facture d'achat";
}

function derive(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

/** Résout le chemin disque d'un fichier « /uploads/… » stocké par storeFile. */
function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

/* ------------------------------------------------------------------ liste */

/** Filtre commun à la liste et à l'export CSV. */
function buildWhere(q: Record<string, string>, payments?: Awaited<ReturnType<typeof allocationSnapshot>>, opts: { skipPayment?: boolean } = {}) {
  const { q: searchRaw, paid, worksiteId, vehicleId, contactId, category, from, to, year, type, linked } = q;
  // recherche insensible à la casse (y compris accents : le repli SQLite n'insensibilise que
  // l'ASCII, "café"/"CAFÉ" ne matcheraient pas sans ce passage en minuscules côté JS)
  const search = searchRaw?.toLowerCase();
  const and: Record<string, unknown>[] = [];
  if (type) {
    // Filtre explicite (purchase | sale | credit_note | delivery_slip) : direction telle quelle,
    // sans l'exclusion "vente" ci-dessous — sert notamment la file de contrôle à retrouver une
    // écriture de vente orpheline, invisible dans la vue achats par défaut (direction toujours
    // exclue de ce tableau tant qu'on ne la demande pas explicitement).
    and.push({ direction: type });
  } else {
    // Vue par défaut : achats + notes de crédit d'achat (une NC de vente réduit le CA, pas une
    // dépense ; une ligne « Crédit auto » = emprunt/financement véhicule, ni facture ni note de crédit : elle
    // faussait le total et le « reste à payer ») + bordereaux (preuve d'enlèvement/paiement reçue avant la facture — voir
    // linkedInvoiceId). categoryRaw peut être NULL (saisie manuelle sans catégorie) :
    // NOT{contains} exclurait alors la ligne (NULL n'est ni "contient" ni "ne contient pas" en
    // SQL) -> OR explicite.
    and.push({
      OR: [
        { direction: 'purchase' },
        { direction: 'delivery_slip' },
        {
          direction: 'credit_note',
          OR: [
            { categoryRaw: null },
            { AND: [{ NOT: { categoryRaw: { contains: 'vente' } } }, { NOT: { categoryRaw: { contains: 'dit auto', ...insensitive } } }] },
          ],
        },
      ],
    });
  }
  // un bordereau relié à une facture ne fait plus qu'UNE dépense avec elle : il disparaît de la vue par défaut (on le retrouve dans sa facture,
  // ou en choisissant explicitement « Bordereaux »)
  if (!type && !linked) and.push({ OR: [{ direction: { not: 'delivery_slip' } }, { linkedInvoiceId: null }] });
  // linked = 0/1 ne s'applique qu'aux bordereaux (linkedInvoiceId)
  if (linked === '0') and.push({ linkedInvoiceId: null });
  if (linked === '1') and.push({ NOT: { linkedInvoiceId: null } });
  // une facture qui regroupe des bordereaux n'a pas forcément de chantier propre : elle compte aussi pour les chantiers de ses bordereaux
  if (worksiteId) and.push({ OR: [{ worksiteId }, { allocations: { some: { worksiteId } } }, { bordereaux: { some: { worksiteId } } }] });
  if (vehicleId) and.push({ vehicleId });
  if (contactId) and.push({ contactId });
  if (category) and.push({ categoryRaw: category });
  if (year) and.push({ year: Number(year) });
  if (from) and.push({ date: { gte: new Date(from) } });
  if (to) and.push({ date: { lte: new Date(to) } });
  const matchedIds = [...(payments?.ledgerPaid.keys() ?? [])];
  const settledIds = payments ? payments.matches.filter(m => m.ledgerEntry && expensePayment(m.ledgerEntry, payments).paid).map(m => m.ledgerEntryId!) : [];
  const settledSelf = { OR: [{ id: { in: settledIds } }, { id: { notIn: matchedIds }, paymentStatus: 'Payé' }] };
  const outstandingSelf = { OR: [{ id: { in: matchedIds, notIn: settledIds } }, { id: { notIn: matchedIds }, OR: [{ paymentStatus: null }, { NOT: { paymentStatus: 'Payé' } }] }] };
  // un bordereau relié n'a pas de paiement propre : il est payé / à payer comme sa facture
  const notLinkedSlip = { OR: [{ direction: { not: 'delivery_slip' } }, { linkedInvoiceId: null }] };
  // Ces listes d'identifiants grossissent avec les rapprochements : la liste web ne s'en sert PAS (elle filtre en mémoire, voir plus bas) ;
  // seuls l'export CSV (listes vides) et d'éventuels appels sans snapshot passent ici. Postgres refuse plus de 32 767 paramètres par requête.
  const settled = { OR: [{ AND: [notLinkedSlip, settledSelf] }, { id: { in: [] as string[] } }] };
  const outstanding = { OR: [{ AND: [notLinkedSlip, outstandingSelf] }, { id: { in: [] as string[] } }] };
  if (q.fox === 'pending') and.push({ foxTransmittedAt: null });
  if (q.fox === 'sent') and.push({ foxTransmittedAt: { not: null } });
  if (q.fox) and.push({ OR: [{ direction: 'purchase' }, { direction: 'credit_note', OR: [{ categoryRaw: null }, { AND: [{ NOT: { categoryRaw: { contains: 'vente', ...insensitive } } }, { NOT: { categoryRaw: { contains: 'dit auto', ...insensitive } } }] }] }] });
  if (!opts.skipPayment) {
    if (paid === '1') and.push(settled);
    if (paid === '0') and.push(outstanding);
    if (q.overdue === '1') and.push({ direction: 'purchase', dueDate: { not: null, lt: new Date() }, ...outstanding });
  }
  if (search) {
    and.push({
      OR: [
        { supplierName: { contains: search, ...insensitive } },
        { docNumber: { contains: search, ...insensitive } },
        { categoryRaw: { contains: search, ...insensitive } },
        { notes: { contains: search, ...insensitive } },
        { worksiteRef: { contains: search, ...insensitive } },
        { contact: { name: { contains: search, ...insensitive } } },
        { worksite: { ref: { contains: search, ...insensitive } } },
      ],
    });
  }
  return and;
}

/**
 * Doublons : même facture saisie deux fois (même fournisseur, même n°, même montant à 2 cts près). Une écriture de l'import historique Excel
 * ne peut être supprimée que si elle a un doublon (l'autre exemplaire reste) ; sinon l'historique importé est protégé.
 */
async function duplicateIdsFor(entries: { id: string; direction: string; docNumber: string | null; contactId: string | null; supplierName: string | null; ht: number; ttc: number | null }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const nums = [...new Set(entries.filter((e) => e.docNumber && e.docNumber.trim().length > 2 && e.direction !== 'delivery_slip').map((e) => e.docNumber!))];
  if (!nums.length) return out;
  const pool = await prisma.ledgerEntry.findMany({ where: { docNumber: { in: nums }, direction: { not: 'delivery_slip' } }, select: { id: true, direction: true, docNumber: true, contactId: true, supplierName: true, ht: true, ttc: true } });
  const near = (a: number | null, b: number | null) => a != null && b != null && Math.abs(Math.abs(a) - Math.abs(b)) <= 0.02;
  for (const e of entries) {
    if (!e.docNumber) continue;
    const twins = pool.filter((o) => o.id !== e.id && o.direction === e.direction && o.docNumber === e.docNumber
      && ((e.contactId && o.contactId === e.contactId) || (!!e.supplierName && o.supplierName === e.supplierName))
      && (near(o.ttc, e.ttc) || near(o.ht, e.ht)));
    if (twins.length) out.set(e.id, twins.map((t) => t.id));
  }
  return out;
}

/**
 * Autres lignes de la MÊME facture (même fournisseur, même n°, même sens) : typiquement une ligne par chantier laissée par l'ancienne saisie ou par l'import Excel.
 * Elles peuvent être fusionnées en une seule fiche avec une répartition par chantier (POST /merge).
 */
async function siblingIdsFor(entries: { id: string; direction: string; docNumber: string | null; contactId: string | null; supplierName: string | null }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const cands = entries.filter((e) => e.docNumber && e.docNumber.trim().length > 2 && (e.direction === 'purchase' || e.direction === 'credit_note'));
  if (!cands.length) return out;
  // « 23/252741 - 113679 » : n° de facture + n° de bordereau — les lignes qui ne diffèrent que par ce suffixe sont la même facture
  const nums = [...new Set(cands.flatMap((e) => [e.docNumber!, invoiceBaseNumber(e.docNumber)]))];
  const contactIds = [...new Set(cands.map((e) => e.contactId).filter((x): x is string => !!x))];
  const names = [...new Set(cands.map((e) => e.supplierName).filter((x): x is string => !!x))];
  const sel = { id: true, direction: true, docNumber: true, contactId: true, supplierName: true } as const;
  const [exact, suffixed] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { docNumber: { in: nums }, direction: { in: ['purchase', 'credit_note'] } }, select: sel }),
    prisma.ledgerEntry.findMany({ where: { docNumber: { contains: ' - ' }, direction: { in: ['purchase', 'credit_note'] }, OR: [...(contactIds.length ? [{ contactId: { in: contactIds } }] : []), ...(names.length ? [{ supplierName: { in: names } }] : [])] }, select: sel }),
  ]);
  const pool = [...new Map([...exact, ...suffixed].map((o) => [o.id, o])).values()];
  const keyOf = (o: { direction: string; docNumber: string | null; contactId: string | null; supplierName: string | null }) => { const who = o.contactId ?? (o.supplierName ?? '').trim().toLowerCase(); return who ? `${o.direction}|${invoiceBaseNumber(o.docNumber).toLowerCase()}|${who}` : null; };
  const groups = new Map<string, string[]>();
  for (const o of pool) { const k = keyOf(o); if (k) groups.set(k, [...(groups.get(k) ?? []), o.id]); }
  for (const e of entries) { const k = keyOf(e); const g = k ? groups.get(k) : undefined; if (g && g.length > 1) out.set(e.id, g.filter((id) => id !== e.id)); }
  return out;
}

/** Parmi deux exemplaires d'une même facture : « delete » pour celui qu'aucun paiement ne touche (l'autre est payé), « keep » pour celui qui est payé. */
function duplicateAdvice(id: string, dups: Map<string, string[]>, payments: Awaited<ReturnType<typeof allocationSnapshot>>): 'delete' | 'keep' | null {
  const twins = dups.get(id);
  if (!twins?.length) return null;
  const hasPayment = (x: string) => payments.ledgerPaid.has(x);
  if (hasPayment(id)) return 'keep';
  return twins.some(hasPayment) ? 'delete' : null;
}

/** Répartition par chantier calculée d'après les bordereaux reliés (voir lib/invoice-allocation.ts) ; absente si la facture est déjà répartie à la saisie. */
async function allocationOf(e: { id: string; direction: string; ht: number; worksiteId: string | null; docNumber: string | null; contactId: string | null; supplierName: string | null; worksite?: { ref: string } | null; bordereaux?: { ht: number; worksiteId: string | null; worksite?: { ref: string } | null }[] }) {
  if (e.direction !== 'purchase' || !e.bordereaux?.length) return undefined;
  const parts = invoiceWorksiteAllocation(e, e.bordereaux);
  if (!parts.length) return undefined;
  if (e.docNumber && await prisma.ledgerEntry.count({ where: { direction: 'purchase', docNumber: e.docNumber, id: { not: e.id }, OR: [...(e.contactId ? [{ contactId: e.contactId }] : []), ...(e.supplierName ? [{ supplierName: e.supplierName }] : [])] } }) > 0) return undefined;
  const refs = new Map<string, string>([...(e.worksiteId && e.worksite ? [[e.worksiteId, e.worksite.ref] as [string, string]] : []), ...e.bordereaux.flatMap((b) => (b.worksiteId && b.worksite ? [[b.worksiteId, b.worksite.ref] as [string, string]] : []))]);
  return parts.map((p) => ({ worksiteId: p.worksiteId, ref: p.worksiteId ? refs.get(p.worksiteId) ?? null : null, ht: p.ht }));
}

/** Paiement à afficher : un bordereau relié à une facture n'a pas de paiement à lui, il prend celui de sa facture (une seule dépense). */
function paymentOf(e: { id: string; ttc: number | null; ht: number; paymentStatus: string | null; direction: string; linkedInvoice?: { id: string; ttc: number | null; ht: number; paymentStatus: string | null } | null }, payments: Awaited<ReturnType<typeof allocationSnapshot>>) {
  return e.direction === 'delivery_slip' && e.linkedInvoice ? expensePayment(e.linkedInvoice, payments) : expensePayment(e, payments);
}

function expensePayment(e: { id: string; ttc: number | null; ht: number; paymentStatus: string | null }, payments: Awaited<ReturnType<typeof allocationSnapshot>>) {
  const total = Math.abs(e.ttc ?? e.ht);
  const manuallyPaid = (e.paymentStatus ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim() === 'paye';
  // un avoir dont le crédit est entièrement imputé sur des factures est « réglé » (creditApplied) ; une facture payée par avoir passe par ledgerPaid
  const paidAmount = Math.min(total, payments.ledgerPaid.get(e.id) ?? payments.creditApplied.get(e.id) ?? (manuallyPaid ? total : 0));
  const remainingAmount = purchaseRemaining(total, paidAmount);
  const paid = remainingAmount === 0 && (paidAmount > 0 || manuallyPaid);
  return { paidAmount, remainingAmount, paid, paymentStatus: paid ? 'Payé' : paidAmount > 0 ? 'Partiel' : 'Non payé' };
}

expensesRouter.get(
  '/',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const { page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const payments = await allocationSnapshot();
    const query = req.query as Record<string, string>;
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));
    const receiptsToReview = await prisma.purchaseReceipt.count({ where: { status: 'review' } });
    const totalsSelect = { id: true, ht: true, ttc: true, paymentStatus: true, direction: true, linkedInvoiceId: true, dueDate: true, allocations: { select: { worksiteId: true, ht: true } } } as const;
    // vue « d'un chantier » : une facture répartie ne compte que pour la part de CE chantier (montants et reste à payer au prorata)
    const partRatio = (e: { ht: number; allocations?: { worksiteId: string; ht: number }[] }) => {
      if (!query.worksiteId || !e.allocations?.length) return 1;
      const p = e.allocations.find((a) => a.worksiteId === query.worksiteId);
      return p && e.ht ? Math.abs(p.ht / e.ht) : p ? 1 : 0;
    };

    // Filtre « payé / à régler / en retard » : l'état de paiement se calcule en mémoire (rapprochements bancaires, bordereau = sa facture).
    // On ne le met JAMAIS dans la requête SQL sous forme de listes d'identifiants : elles grossissent avec les rapprochements et
    // finiraient par dépasser les 32 767 paramètres que Postgres accepte.
    const paymentFilter = query.paid === '0' || query.paid === '1' || query.overdue === '1';
    let items: Awaited<ReturnType<typeof prisma.ledgerEntry.findMany<{ include: typeof inc }>>>;
    let all: { id: string; ht: number; ttc: number | null; paymentStatus: string | null; direction: string; linkedInvoiceId: string | null; dueDate: Date | null; allocations?: { worksiteId: string; ht: number }[] }[];
    if (paymentFilter) {
      const candidates = await prisma.ledgerEntry.findMany({
        where: { AND: buildWhere(query, payments, { skipPayment: true }) },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { ...totalsSelect, linkedInvoice: { select: { id: true, ttc: true, ht: true, paymentStatus: true } } },
      });
      const nowF = new Date();
      all = candidates.filter((e) => {
        const pay = paymentOf(e, payments);
        if (query.paid === '1' && !pay.paid) return false;
        if (query.paid === '0' && pay.paid) return false;
        if (query.overdue === '1' && !(e.direction === 'purchase' && e.dueDate && e.dueDate < nowF && !pay.paid)) return false;
        return true;
      });
      const pageIds = all.slice((page - 1) * pageSize, page * pageSize).map((e) => e.id);
      const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: pageIds } }, include: inc });
      const order = new Map(pageIds.map((id, i) => [id, i]));
      items = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      const and = buildWhere(query, payments);
      [items, all] = await Promise.all([
        prisma.ledgerEntry.findMany({ where: { AND: and }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: inc }),
        // totaux (KPI) sur l'ensemble du filtre, pas seulement la page affichée
        prisma.ledgerEntry.findMany({ where: { AND: and }, select: totalsSelect }),
      ]);
    }

    const now = new Date();
    const totals = all.reduce(
      (acc, e) => {
        acc.count += 1;
        // bordereau : pas un document fiscal (pas de TVA récupérable dessus) -> exclu des
        // montants, sinon la facture reçue ensuite le compterait deux fois. Seul son statut
        // « en attente de facture » (non relié) intéresse ici.
        if (e.direction === 'delivery_slip') {
          if (!e.linkedInvoiceId) acc.pendingSlips += 1;
          return acc;
        }
        const k = partRatio(e);
        const ttc = (e.ttc ?? e.ht) * k;
        const payment = { ...expensePayment(e, payments), remainingAmount: expensePayment(e, payments).remainingAmount * k };
        // une note de crédit réduit toujours les dépenses, qu'elle soit saisie en positif ou en négatif (l'import
        // contient les deux : le signe appliqué par-dessus un montant déjà négatif la comptait comme une dépense)
        if (e.direction === 'credit_note') {
          acc.ht -= Math.abs(e.ht * k);
          acc.ttc -= Math.abs(ttc);
          // « reste à payer » : seules les notes de crédit non réglées viennent en déduction (celles marquées payées
          // sont déjà soldées avec le fournisseur)
          acc.unpaidTtc -= payment.remainingAmount;
          return acc;
        }
        acc.ht += e.ht * k;
        acc.ttc += ttc;
        if (!expensePayment(e, payments).paid) {
          acc.unpaidTtc += payment.remainingAmount;
          if (payment.remainingAmount > 0.01 && e.dueDate && e.dueDate < now) { acc.overdueCount += 1; acc.overdueTtc += payment.remainingAmount; }
        }
        return acc;
      },
      { count: 0, ht: 0, ttc: 0, unpaidTtc: 0, pendingSlips: 0, overdueCount: 0, overdueTtc: 0 },
    );

    const dups = await duplicateIdsFor(items);
    const siblings = await siblingIdsFor(items);
    res.json({
      receiptsToReview,
      items: await Promise.all(items.map(async (e) => ({
        ...e,
        // vue d'un chantier : montants = part de ce chantier (la fiche entière reste visible : ouvrir la dépense)
        ...(partRatio(e) !== 1 ? { partOfHt: e.ht, ht: Math.round(e.ht * partRatio(e) * 100) / 100, ttc: e.ttc != null ? Math.round(e.ttc * partRatio(e) * 100) / 100 : e.ttc } : {}),
        supplier: e.contact?.name ?? e.supplierName ?? null,
        categoryLabel: e.category?.label ?? e.categoryRaw ?? null,
        ...paymentOf(e, payments),
        worksiteAllocation: await allocationOf(e),
        hasPdf: !!e.pdfPath,
        editable: e.source !== 'xlsx',
        // répartir entre plusieurs chantiers et supprimer : possible sur TOUTES les lignes (import Excel et fiches transmises à Fox comprises) ; la suppression d'une ligne
        // de l'import sans doublon demande une confirmation explicite (force), voir DELETE
        splittable: e.direction === 'purchase' || e.direction === 'credit_note',
        siblingIds: siblings.get(e.id) ?? [],
        duplicateIds: dups.get(e.id) ?? [],
        duplicateAdvice: duplicateAdvice(e.id, dups, payments),
        deletable: true,
      }))),
      totals: {
        count: totals.count,
        ht: Math.round(totals.ht * 100) / 100,
        ttc: Math.round(totals.ttc * 100) / 100,
        unpaidTtc: Math.round(totals.unpaidTtc * 100) / 100,
        pendingSlips: totals.pendingSlips,
        overdueCount: totals.overdueCount,
        overdueTtc: Math.round(totals.overdueTtc * 100) / 100,
      },
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totals.count / pageSize)),
    });
  }),
);


/**
 * Dépenses du poste « Matériel sans chantier » (E-01) à imputer : pour chacune, les chantiers actifs CE JOUR-LÀ
 * (interventions du planning et heures pointées) — ceux sur lesquels ce matériel a pu servir. Aucune écriture : l'imputation se fait ensuite
 * par une modification normale de la dépense (PATCH worksiteId). `window` = nombre de jours avant/après à regarder aussi (0 à 3).
 */
const brusselsDayOf = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(d);
expensesRouter.get(
  '/unassigned',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { q: qRaw, from, to, category, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const win = Math.min(3, Math.max(0, Math.trunc(Number(req.query.window)) || 0));
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(200, Math.max(10, Math.trunc(Number(pageSizeStr)) || 50));
    // seulement le poste « Matériel sans chantier » (E-01) : les autres postes E-xx (E-03, E-04…) sont de vraies charges, pas des achats à imputer à un chantier
    const and: Record<string, unknown>[] = [{ direction: 'purchase' }, { worksite: { ref: 'E-01', kind: 'overhead' } }];
    if (from) and.push({ date: { gte: new Date(from) } });
    if (to) and.push({ date: { lte: new Date(to) } });
    if (category) and.push({ categoryRaw: category });
    if (qRaw) and.push({ OR: [{ supplierName: { contains: qRaw, ...insensitive } }, { docNumber: { contains: qRaw, ...insensitive } }, { contact: { name: { contains: qRaw, ...insensitive } } }] });
    const where = { AND: and };
    const [rows, total, sums] = await Promise.all([
      prisma.ledgerEntry.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { worksite: { select: { id: true, ref: true, title: true } }, contact: { select: { name: true } } } }),
      prisma.ledgerEntry.count({ where }),
      prisma.ledgerEntry.aggregate({ where, _sum: { ht: true } }),
    ]);
    const dated = rows.filter((r) => r.date);
    const days = dated.map((r) => r.date!.getTime());
    const span = 86_400_000 * (win + 1);
    const lo = days.length ? new Date(Math.min(...days) - span) : new Date(), hi = days.length ? new Date(Math.max(...days) + span) : new Date();
    const [events, times] = days.length ? await Promise.all([
      prisma.planningEvent.findMany({
        where: { kind: 'intervention', startAt: { gte: lo, lte: hi }, worksite: { kind: 'project' } },
        select: { startAt: true, worksite: { select: { id: true, ref: true, title: true, city: true } }, _count: { select: { assignments: true } } },
      }),
      prisma.timeEntry.findMany({
        where: { date: { gte: lo, lte: hi }, worksiteId: { not: null }, status: { in: ['approved', 'submitted', 'running'] }, worksite: { kind: 'project' } },
        select: { date: true, hours: true, personId: true, worksite: { select: { id: true, ref: true, title: true, city: true } } },
      }),
    ]) : [[], []];
    type Sug = { worksiteId: string; ref: string; title: string; city: string | null; onDay: boolean; planned: number; people: number; hours: number };
    const items = rows.map((r) => {
      const day = r.date ? brusselsDayOf(r.date) : null;
      const near = day ? new Set(Array.from({ length: 2 * win + 1 }, (_, i) => brusselsDayOf(new Date(r.date!.getTime() + (i - win) * 86_400_000)))) : new Set<string>();
      const sug = new Map<string, Sug & { ppl: Set<string> }>();
      const slot = (w: { id: string; ref: string; title: string; city: string | null }, d: string) => {
        const cur = sug.get(w.id) ?? { worksiteId: w.id, ref: w.ref, title: w.title, city: w.city, onDay: false, planned: 0, people: 0, hours: 0, ppl: new Set<string>() };
        if (d === day) cur.onDay = true;
        sug.set(w.id, cur);
        return cur;
      };
      for (const e of events) { const d = brusselsDayOf(e.startAt); if (near.has(d)) slot(e.worksite, d).planned += 1; }
      for (const t of times) { if (!t.date) continue; const d = brusselsDayOf(t.date); if (near.has(d)) { if (!t.worksite) continue; const c = slot(t.worksite, d); c.hours += t.hours ?? 0; c.ppl.add(t.personId); } }
      const suggestions: Sug[] = [...sug.values()].map(({ ppl, ...s }) => ({ ...s, people: ppl.size, hours: Math.round(s.hours * 10) / 10 }))
        .sort((a, b) => Number(b.onDay) - Number(a.onDay) || b.hours - a.hours || b.planned - a.planned);
      return {
        id: r.id, date: r.date, supplier: r.contact?.name ?? r.supplierName ?? null, docNumber: r.docNumber, category: r.categoryRaw, ht: r.ht, ttc: r.ttc,
        worksite: r.worksite, hasPdf: !!r.pdfPath, suggestions,
      };
    });
    res.json({ items, total, totalHt: Math.round((sums._sum.ht ?? 0) * 100) / 100, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), window: win });
  }),
);

expensesRouter.get('/peppol-reception',requireAuth(...OFFICE),asyncHandler(async (_req,res)=>{res.json(await peppolReceptionStatus());}));
expensesRouter.post('/peppol-reception',requireAuth('admin'),asyncHandler(async(req,res)=>{
  const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);
  await setPeppolReception(enabled);
  await prisma.auditLog.create({data:{actorId:req.user!.id,action:enabled?'enable':'disable',entity:'peppolReception'}});
  res.json({enabled});
}));
expensesRouter.post('/sync-peppol',requireAuth(...OFFICE),asyncHandler(async(_req,res)=>{res.json(await syncPeppolInbox());}));
expensesRouter.get('/receipts',requireAuth(...OFFICE),asyncHandler(async(req,res)=>{
  const page=Math.max(1,Number(req.query.page)||1);
  const where={status:'review'};
  const [items,total]=await Promise.all([prisma.purchaseReceipt.findMany({where,orderBy:{createdAt:'desc'},skip:(page-1)*30,take:30}),prisma.purchaseReceipt.count({where})]);
  res.json({items,total,page});
}));
expensesRouter.get('/receipts/:id/:format',requireAuth(...OFFICE),asyncHandler(async(req,res)=>{
  if(!['pdf','xml'].includes(req.params.format!)) throw new HttpError(404,'Format inconnu.');
  const row=await prisma.purchaseReceipt.findUnique({where:{id:req.params.id}});
  const file=req.params.format==='xml'?row?.xmlPath:row?.pdfPath;
  if(!file || !existsSync(resolveUpload(file))) throw new HttpError(404,'Pièce jointe introuvable.');
  res.setHeader('Content-Type',req.params.format==='xml'?'application/xml':'application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="document.'+req.params.format+'"');
  res.sendFile(path.resolve(resolveUpload(file)));
}));
expensesRouter.post('/receipts/:id/link',requireAuth(...OFFICE),asyncHandler(async(req,res)=>{
  const {entryId}=z.object({entryId:z.string().min(1)}).parse(req.body);
  res.json(await linkPurchaseReceipt(req.params.id!,entryId,req.user!.id));
}));
expensesRouter.post('/receipts/:id/ignore',requireAuth(...OFFICE),asyncHandler(async(req,res)=>{
  const {reason}=z.object({reason:z.string().max(200).nullable().optional()}).parse(req.body??{});
  res.json(await ignorePurchaseReceipt(req.params.id!,reason??null,req.user!.id));
}));
expensesRouter.post('/receipts/:id/create',requireAuth(...OFFICE),asyncHandler(async(req,res)=>{
  const data=z.object({
    confirmedDistinct:z.literal(true),direction:z.enum(['purchase','credit_note','delivery_slip']),
    docNumber:z.string().trim().min(1).max(200),supplierName:z.string().trim().min(1).max(300),
    supplierVat:z.string().max(40).nullable().optional(),contactId:z.null(),
    date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))),
    ht:z.number().finite().nonnegative(),ttc:z.number().finite().nonnegative(),
  }).parse(req.body);
  res.json(await createReviewedPurchase(req.params.id!,data,req.user!.id));
}));

/* ------------------------------------------------------------------ meta */

expensesRouter.get(
  '/meta',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (_req, res) => {
    const [categories, rawCats, suppliers, worksites, vehicles, years] = await Promise.all([
      prisma.category.findMany({
        where: { active: true, kind: { in: ['expense', 'salary', 'tax', 'vat'] } },
        orderBy: { label: 'asc' },
        select: { code: true, label: true, kind: true },
      }),
      prisma.ledgerEntry.findMany({
        where: { direction: { in: ['purchase', 'credit_note'] }, categoryRaw: { not: null } },
        distinct: ['categoryRaw'],
        select: { categoryRaw: true },
        orderBy: { categoryRaw: 'asc' },
      }),
      prisma.contact.findMany({
        where: { OR: [{ type: 'supplier' }, { type: 'both' }] },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      // chantiers clôturés/archivés inclus (en fin de liste) : on doit pouvoir y rattacher une dépense
      prisma.worksite.findMany({
        orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
        take: 5000,
        select: { id: true, ref: true, title: true, archived: true, status: true },
      }),
      prisma.vehicle.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, plate: true, name: true, brand: true, model: true },
      }),
      prisma.ledgerEntry.findMany({
        where: { direction: { in: ['purchase', 'credit_note'] }, year: { not: null } },
        distinct: ['year'],
        select: { year: true },
        orderBy: { year: 'desc' },
      }),
    ]);
    res.json({
      categories,
      rawCategories: rawCats.map((c) => c.categoryRaw).filter(Boolean),
      suppliers,
      worksites: worksites.map((w) => ({ id: w.id, name: `${w.ref} · ${w.title}${w.status === 'closed' ? ' (clôturé)' : w.archived ? ' (archivé)' : ''}` })),
      vehicles: vehicles.map((v) => ({ id: v.id, name: [v.model || v.brand || v.name, v.plate].filter(Boolean).join(' · ') || v.code || 'Véhicule' })),
      years: years.map((y) => y.year).filter(Boolean),
    });
  }),
);

/**
 * Repère, dans les factures d'achat déjà reçues, les articles qui reviennent souvent mais ne
 * sont pas encore suivis en stock — best-effort (voir lib/purchase-candidates.ts), à vérifier
 * avant de créer l'article : ne crée jamais rien tout seul. Route à chemin fixe : doit rester
 * déclarée avant GET /:id, sinon Express la confond avec une dépense d'id "purchase-candidates".
 */
expensesRouter.get(
  '/purchase-candidates',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json({ items: await findPurchaseCandidates() });
  }),
);

/* ------------------------------------------------------------------ articles achetés (lignes lues dans les PDF) */

const lineFilters = (q: Record<string, unknown>): ArticleFilters => {
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const from = day(q.from), to = day(q.to);
  return {
    q: typeof q.q === 'string' ? q.q : undefined,
    contactId: typeof q.contactId === 'string' && q.contactId ? q.contactId : undefined,
    worksiteId: typeof q.worksiteId === 'string' && q.worksiteId ? q.worksiteId : undefined,
    from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
    includeSlips: q.includeSlips === '1',
  };
};

/** Avancement de la lecture des PDF d'achat (combien lus, lisibles, lignes trouvées). */
expensesRouter.get('/lines/stats', requireAuth(...OFFICE), asyncHandler(async (_req, res) => { res.json(await linesStats()); }));

/** Lit un lot de PDF (≈ 20 s) ; l'écran rappelle tant qu'il en reste. `rescan: true` repart de zéro (après une amélioration de la lecture). */
expensesRouter.post(
  '/scan-lines',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const body = z.object({ rescan: z.boolean().optional(), timeBudgetMs: z.number().int().optional() }).parse(req.body ?? {});
    const result = await scanLinesBatch(body);
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'purchase-lines.scan', entity: 'ledger', entityId: 'batch', meta: { ...result, rescan: !!body.rescan } } }).catch(() => undefined);
    res.json(result);
  }),
);

/** Articles regroupés (quantité, montant, prix mini / maxi / dernier) — filtres : q, contactId, worksiteId, from, to, includeSlips, tri, page. */
expensesRouter.get(
  '/lines/articles',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { sort, dir, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const rows = await articleSummary(lineFilters(req.query));
    const sortDir = dir === 'asc' ? 1 : -1;
    const by: Record<string, (r: (typeof rows)[number]) => number | string> = {
      total: (r) => r.totalHt, qty: (r) => r.qty, purchases: (r) => r.purchases, last: (r) => r.lastDate ?? '', label: (r) => r.label.toLowerCase(), price: (r) => r.lastPrice,
    };
    const key = by[sort ?? 'total'] ?? by.total!;
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(200, Math.max(10, Math.trunc(Number(pageSizeStr)) || 50));
    res.json({
      items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalCount: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      totals: { articles: rows.length, spendHt: Math.round(rows.reduce((s, r) => s + r.totalHt, 0) * 100) / 100 },
    });
  }),
);

/** Articles et fournisseurs masqués (forfaits, services…) : liste pour pouvoir les réafficher. */
expensesRouter.get('/lines/hidden', requireAuth(...OFFICE), asyncHandler(async (_req, res) => { res.json(await getHidden()); }));

/** Masque des articles / fournisseurs entiers de la page « Articles achetés » ; `show: true` les réaffiche. Ne supprime aucune ligne lue. */
expensesRouter.post(
  '/lines/hide',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const body = z.object({
      articles: z.array(z.object({ key: z.string().min(1).max(300), label: z.string().max(300) })).max(500).optional(),
      suppliers: z.array(z.object({ id: z.string().min(1), name: z.string().max(200) })).max(100).optional(),
      show: z.boolean().optional(),
    }).parse(req.body ?? {});
    const hidden = await setHidden(body);
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: body.show ? 'purchase-lines.show' : 'purchase-lines.hide', entity: 'ledger', entityId: 'batch', meta: { articles: body.articles?.length ?? 0, suppliers: body.suppliers?.map((s) => s.name) ?? [] } } }).catch(() => undefined);
    res.json(hidden);
  }),
);

/** Détail d'un article : chaque achat (date, fournisseur, n°, chantier, quantité, prix). */
expensesRouter.get(
  '/lines/article',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!key) throw new HttpError(422, 'Article manquant');
    res.json({ items: await articleOccurrences(key, lineFilters(req.query)) });
  }),
);

/* ------------------------------------------------------------------ fusionner les lignes d'une même facture */

/**
 * Fusionne plusieurs lignes d'une MÊME facture (même fournisseur, même n°, même sens) en une seule fiche répartie entre leurs chantiers :
 * HT / TTC / TVA additionnés, une part par chantier, un seul PDF, un seul rapprochement bancaire (ceux des lignes fusionnées sont repris).
 * `dryRun` : ne fait rien, renvoie ce qui serait fait. Les lignes supprimées sont conservées dans le journal.
 */
expensesRouter.post(
  '/merge',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.string().min(1)).min(2).max(30), keepId: z.string().optional(), dryRun: z.boolean().optional() }).parse(req.body ?? {});
    const out = await mergeEntries(body.ids, { keepId: body.keepId, dryRun: body.dryRun, actorId: req.user!.id });
    if (body.dryRun) { res.json({ preview: out.preview }); return; }
    res.json({ preview: out.preview, expense: await prisma.ledgerEntry.findUnique({ where: { id: out.survivorId }, include: inc }) });
  }),
);

/* ------------------------------------------------------------------ export */

/** Export groupé : les pièces jointes de plusieurs dépenses en un seul .zip (à glisser chez le comptable). */
expensesRouter.get(
  '/export.zip',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new HttpError(422, 'Aucune dépense sélectionnée');
    if (ids.length > 300) throw new HttpError(422, 'Trop de dépenses sélectionnées (300 max)');
    const items = await prisma.ledgerEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, pdfPath: true, docNumber: true, supplierName: true, contact: { select: { name: true } } },
    });

    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const e of items) {
      if (!e.pdfPath) continue;
      const file = resolveUpload(e.pdfPath);
      if (!existsSync(file)) continue;
      const ext = path.extname(file) || '.pdf';
      const label = (e.docNumber || e.contact?.name || e.supplierName || e.id).replace(/[^\w.-]+/g, '-');
      let name = `${label}${ext}`;
      let i = 2;
      while (used.has(name)) { name = `${label}-${i}${ext}`; i++; }
      used.add(name);
      files[name] = new Uint8Array(readFileSync(file));
    }
    if (!Object.keys(files).length) throw new HttpError(422, 'Aucune des dépenses sélectionnées n’a de pièce jointe à exporter.');

    const zipped = zipSync(files, { level: 6 });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="depenses-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(Buffer.from(zipped));
  }),
);


const foxIds = z.object({ ids: z.array(z.string().min(1)).min(1).max(300) });
expensesRouter.post('/fox-export', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const ids = [...new Set(foxIds.parse(req.body).ids)];
  const items = await prisma.ledgerEntry.findMany({ where: { id: { in: ids } }, include: { contact: { select: { name: true, vat: true } } }, orderBy: { id: 'asc' } });
  if (items.length !== ids.length) throw new HttpError(404, 'Une dépense sélectionnée est introuvable. Actualisez la liste.');
  const zip = await prepareFoxZip(items);
  await prisma.$transaction([
    prisma.ledgerEntry.updateMany({ where: { id: { in: ids } }, data: { foxExportedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'fox_export', entity: 'ledgerEntry', meta: { ids } } }),
  ]);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="fox-' + new Date().toISOString().slice(0, 10) + '.zip"');
  res.send(zip);
}));
expensesRouter.post('/fox-transmission', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const { ids: raw, transmitted } = foxIds.extend({ transmitted: z.boolean() }).parse(req.body);
  const ids = [...new Set(raw)];
  const items = await prisma.ledgerEntry.findMany({ where: { id: { in: ids } } });
  if (items.length !== ids.length || items.some(e => !foxEligible(e))) throw new HttpError(422, 'Sélection de factures d’achat invalide.');
  await prisma.$transaction([
    prisma.ledgerEntry.updateMany({ where: { id: { in: ids }, ...(transmitted ? { foxTransmittedAt: null } : {}) }, data: { foxTransmittedAt: transmitted ? new Date() : null } }),
    prisma.auditLog.create({ data: { actorId: req.user!.id, action: transmitted ? 'fox_transmitted' : 'fox_reset', entity: 'ledgerEntry', meta: { ids, confirmation: 'manual' } } }),
  ]);
  res.json({ count: ids.length });
}));

/* --------------------------------------------------------- export/import Excel */

const EXPENSE_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'date', label: 'Date' },
  { key: 'dueDate', label: 'Échéance' },
  { key: 'type', label: 'Type' },
  { key: 'supplier', label: 'Fournisseur' },
  { key: 'docNumber', label: 'N° document' },
  { key: 'worksiteRef', label: 'Chantier' },
  { key: 'category', label: 'Catégorie' },
  { key: 'ht', label: 'HT' },
  { key: 'vatRecup', label: 'TVA récup' },
  { key: 'ttc', label: 'TTC' },
  { key: 'paymentStatus', label: 'Statut' },
  { key: 'paidAmount', label: 'Payé TTC' },
  { key: 'remainingAmount', label: 'Reste à payer TTC' },
  { key: 'bankDate', label: 'Date du paiement (banque)' },
  { key: 'bankMatch', label: 'Rapprochement bancaire' },
  { key: 'communication', label: 'Communication' },
  { key: 'notes', label: 'Notes' },
];

/** Export en CSV (éditable dans Excel) — respecte les mêmes filtres que la liste. */
expensesRouter.get(
  '/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const and = buildWhere(req.query as Record<string, string>);
    const items = await prisma.ledgerEntry.findMany({
      where: { AND: and },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
      include: inc,
    });
    // paiement réel : rapprochements bancaires (un bordereau prend celui de sa facture), pas seulement le statut saisi à la main
    const payments = await allocationSnapshot();
    const matches = await prisma.bankTransactionMatch.findMany({
      where: { ledgerEntryId: { in: items.map((e) => e.linkedInvoice?.id ?? e.id) } },
      select: { ledgerEntryId: true, bankTransaction: { select: { bookingDate: true, counterpartyName: true, description: true, communication: true } } },
    });
    const matchesOf = new Map<string, typeof matches>();
    for (const m of matches) matchesOf.set(m.ledgerEntryId!, [...(matchesOf.get(m.ledgerEntryId!) ?? []), m]);
    const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    const rows = items.map((e) => {
      const pay = paymentOf(e, payments);
      const bank = (matchesOf.get(e.direction === 'delivery_slip' && e.linkedInvoice ? e.linkedInvoice.id : e.id) ?? []).sort((a, b) => (a.bankTransaction.bookingDate?.getTime() ?? 0) - (b.bankTransaction.bookingDate?.getTime() ?? 0));
      return {
      id: e.id,
      date: e.date,
      dueDate: e.dueDate,
      type: e.direction === 'credit_note' ? 'Note de crédit' : 'Achat',
      supplier: e.contact?.name ?? e.supplierName ?? '',
      docNumber: e.docNumber ?? '',
      worksiteRef: e.worksite?.ref ?? e.worksiteRef ?? '',
      category: e.category?.label ?? e.categoryRaw ?? '',
      ht: e.ht,
      vatRecup: e.vatRecup,
      ttc: e.ttc,
      paymentStatus: pay.paymentStatus,
      paidAmount: pay.paidAmount,
      remainingAmount: pay.remainingAmount,
      bankDate: bank.map((m) => d10(m.bankTransaction.bookingDate)).filter(Boolean).join(' ; '),
      bankMatch: bank.map((m) => [d10(m.bankTransaction.bookingDate), m.bankTransaction.counterpartyName || m.bankTransaction.description || ''].filter(Boolean).join(' ')).join(' ; '),
      communication: [...new Set(bank.map((m) => m.bankTransaction.communication?.trim()).filter(Boolean))].join(' ; '),
      notes: e.notes ?? '',
      };
    });
    const csv = toCsv(EXPENSE_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="achats-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

/**
 * Réimporte un fichier (précédemment exporté puis corrigé dans Excel, ou nouveau).
 * Une ligne avec un `id` connu met à jour l'écriture ; sans `id` (ou inconnu), une
 * nouvelle écriture est créée. Une ligne absente du fichier n'est jamais supprimée.
 */
expensesRouter.post(
  '/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const rows = readTableBuffer(req.file.buffer, req.file.originalname);
    if (rows.length > 5000) throw new HttpError(422, 'Trop de lignes (5000 max)');

    let created = 0;
    let updated = 0;
    const warnings: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2; // 1 = en-tête
      const id = pick(row, 'id');
      const date = parseLooseDate(pick(row, 'date'));
      if (!date) { warnings.push({ row: rowNum, message: 'Date manquante ou invalide — ligne ignorée' }); continue; }

      const worksiteRef = pick(row, 'chantier', 'worksiteref', 'ref chantier');
      let worksiteId: string | null | undefined;
      if (worksiteRef) {
        const w = await prisma.worksite.findFirst({ where: { ref: worksiteRef } });
        if (w) worksiteId = w.id;
        else warnings.push({ row: rowNum, message: `Chantier « ${worksiteRef} » introuvable — non modifié` });
      }

      const supplierName = pick(row, 'fournisseur', 'supplier');
      let contactId: string | null | undefined;
      if (supplierName) {
        const c = await prisma.contact.findFirst({
          where: { name: { equals: supplierName }, type: { in: ['supplier', 'both'] } },
        });
        if (c) contactId = c.id;
      }

      const categoryLabel = pick(row, 'categorie', 'catégorie', 'category');
      let categoryCode: string | null | undefined;
      let categoryRaw: string | null | undefined = categoryLabel ?? undefined;
      if (categoryLabel) {
        const cat = await prisma.category.findFirst({ where: { label: { equals: categoryLabel } } });
        if (cat) { categoryCode = cat.code; categoryRaw = cat.label; }
      }

      const typeRaw = (pick(row, 'type') ?? '').toLowerCase();
      const direction = /credit|avoir/.test(typeRaw) ? 'credit_note' : 'purchase';
      const paidRaw = (pick(row, 'statut', 'paymentstatus') ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
      const paymentStatus = paidRaw === 'paye' ? 'Payé' : 'Non payé';

      const data: Record<string, unknown> = {
        date,
        dueDate: parseLooseDate(pick(row, 'echeance', 'échéance', 'duedate')),
        direction,
        docType: direction === 'credit_note' ? 'Note de crédit' : "Facture d'achat",
        docNumber: pick(row, 'n document', 'docnumber', 'numero') || null,
        worksiteRef: worksiteRef || null,
        ...(worksiteId !== undefined ? { worksiteId } : {}),
        supplierName: supplierName || null,
        ...(contactId !== undefined ? { contactId } : {}),
        categoryCode: categoryCode ?? null,
        categoryRaw: categoryRaw ?? null,
        ht: parseAmount(pick(row, 'ht')) ?? 0,
        vatRecup: parseAmount(pick(row, 'tva recup', 'tva récup', 'vatrecup')),
        ttc: parseAmount(pick(row, 'ttc')),
        paymentStatus,
        ...derive(date),
        notes: pick(row, 'notes') || null,
      };

      if (id) {
        const existing = await prisma.ledgerEntry.findUnique({ where: { id } });
        if (existing) {
          await prisma.ledgerEntry.update({ where: { id }, data });
          updated++;
          continue;
        }
        warnings.push({ row: rowNum, message: `id « ${id} » introuvable — ligne créée comme nouvelle écriture` });
      }
      await prisma.ledgerEntry.create({ data: { ...data, source: 'manual', createdById: req.user!.id } as Prisma.LedgerEntryUncheckedCreateInput });
      created++;
    }

    res.json({ created, updated, warnings });
  }),
);

/* ------------------------------------------------------------------ détail */

expensesRouter.get(
  '/:id',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, include: inc });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const matches = await prisma.bankTransactionMatch.findMany({
      where: { ledgerEntryId: e.id },
      include: { bankTransaction: { select: { id: true, bookingDate: true, amount: true, bank: true, counterpartyName: true, communication: true } } },
    });
    const payments = await allocationSnapshot();
    const bankMatches = matches.map((m) => ({ matchId: m.id, allocatedAmount: payments.amounts.get(m.id) ?? 0, ...m.bankTransaction }));
    const dupIds = (await duplicateIdsFor([e])).get(e.id) ?? [];
    res.json({ expense: { ...e, ...paymentOf(e, payments), worksiteAllocation: await allocationOf(e), hasPdf: !!e.pdfPath, editable: e.source !== 'xlsx', splittable: e.direction === 'purchase' || e.direction === 'credit_note', siblingIds: (await siblingIdsFor([e])).get(e.id) ?? [], duplicateIds: dupIds, duplicateAdvice: duplicateAdvice(e.id, new Map(dupIds.length ? [[e.id, dupIds]] : []), payments), deletable: true, bankMatches } });
  }),
);

/** Transactions bancaires non rapprochées susceptibles de correspondre à cette dépense. */
expensesRouter.get(
  '/:id/bank-suggestions',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({
      where: { id: req.params.id },
      select: { ttc: true, ht: true, date: true, bankComm: true, supplierName: true, contact: { select: { name: true } } },
    });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const amount = Math.abs(e.ttc ?? e.ht ?? 0);
    const supplier = e.contact?.name ?? e.supplierName ?? '';

    // Recherche libre (texte, montant, dates, paiements déjà rapprochés compris) : dès qu'un critère est donné on n'impose
    // plus « même montant ± 1 € et ± 2 mois » — c'est l'utilisateur qui cherche. Sans critère : propositions automatiques.
    const qs = req.query as Record<string, string | undefined>;
    const words = (qs.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    const askedAmount = qs.amount !== undefined && qs.amount !== '' ? parseAmount(qs.amount) : null;
    const from = qs.from ? parseLooseDate(qs.from) : null;
    const to = qs.to ? parseLooseDate(qs.to) : null;
    const includeMatched = qs.all === '1';
    const manual = words.length > 0 || askedAmount != null || !!from || !!to || includeMatched;

    const where: Prisma.BankTransactionWhereInput = manual
      ? {
          ...(includeMatched ? {} : { matches: { none: {} }, pairedTxId: null }),
          ...(askedAmount != null ? { OR: [{ amount: { gte: Math.abs(askedAmount) - 0.5, lte: Math.abs(askedAmount) + 0.5 } }, { amount: { gte: -(Math.abs(askedAmount) + 0.5), lte: -(Math.abs(askedAmount) - 0.5) } }] } : {}),
          ...(from || to ? { bookingDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          AND: words.map((w) => ({
            OR: [
              { description: { contains: w, ...insensitive } },
              { counterpartyName: { contains: w, ...insensitive } },
              { communication: { contains: w, ...insensitive } },
            ],
          })),
        }
      : {
          matches: { none: {} },
          pairedTxId: null,
          // décaissement : montant négatif de valeur proche du TTC de la dépense
          amount: { gte: -(amount + 1), lte: -(amount - 1) },
          ...(e.date ? { bookingDate: { gte: new Date(e.date.getTime() - 30 * 86400000), lte: new Date(e.date.getTime() + 60 * 86400000) } } : {}),
        };
    const raw = await prisma.bankTransaction.findMany({
      where,
      orderBy: { bookingDate: 'desc' },
      take: manual ? 60 : 40,
      select: {
        id: true, bookingDate: true, amount: true, bank: true, counterpartyName: true, communication: true, description: true,
        matches: { select: { ledgerEntry: { select: { docNumber: true, supplierName: true } }, document: { select: { number: true } } } },
      },
    });
    const items = raw
      .map(({ matches, ...t }) => ({
        ...t,
        nameMatch: !!supplier && !!(t.counterpartyName || t.description) && nameOverlap(supplier, `${t.counterpartyName ?? ''} ${t.description ?? ''}`),
        // paiement déjà rapproché à d'autres factures (un paiement peut en couvrir plusieurs)
        matchedTo: matches.map((m) => m.ledgerEntry?.docNumber ?? m.document?.number ?? m.ledgerEntry?.supplierName ?? '?'),
      }))
      // le fournisseur qui correspond d'abord, puis par date décroissante
      .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch))
      .slice(0, manual ? 40 : 15);
    res.json({ items, supplier, manual });
  }),
);

/**
 * Pré-lit une pièce (PDF) avant création : type (facture/NC), n°, date,
 * montants, fournisseur et chantier détectés — best-effort, à vérifier
 * ensuite dans le formulaire. Ne crée rien.
 */
expensesRouter.post(
  '/extract',
  requireAuth(...FIELD_OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    // photo d'un ticket : lecture par l'IA (direction), sinon saisie à la main
    if (/^image\/(jpe?g|png|webp)$/.test(req.file.mimetype)) {
      const r = await readReceipt(req.user!, { mediaType: req.file.mimetype === 'image/jpg' ? 'image/jpeg' : (req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp'), data: req.file.buffer.toString('base64') });
      if (!r.ok) return res.json({ extraction: null, suggestedCategory: null, note: r.reason });
      return res.json({ extraction: r.extraction, suggestedCategory: r.suggestedCategory, ai: true });
    }
    const extraction = await extractDocumentInfo(req.file.buffer, req.file.mimetype, ['supplier', 'both']);
    const isPdf = req.file.mimetype === 'application/pdf';
    const suggestedCategory = isPdf ? await suggestExpenseCategory(req.file.buffer, extraction.contactId) : null;
    res.json({ extraction, suggestedCategory });
  }),
);

/**
 * Rattache un PDF à la dépense qui lui correspond (import en masse de pièces manquantes) : lit le PDF puis propose, parmi les dépenses SANS pièce jointe,
 * celles dont le n° de facture ou le montant colle (voir lib/expense-pdf-match.ts). N'écrit rien : la jonction se fait ensuite par POST /:id/pdf.
 */
expensesRouter.post(
  '/match-pdf',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    if (req.file.mimetype !== 'application/pdf') throw new HttpError(422, 'PDF uniquement.');
    const extraction = await extractDocumentInfo(req.file.buffer, req.file.mimetype, ['supplier', 'both']);
    const candidates = extraction.textExtracted ? matchCandidates(extraction, await expensesWithoutPdf()) : [];
    res.json({
      extraction: { docNumber: extraction.docNumber, issuedOn: extraction.issuedOn, totalHt: extraction.totalHt, totalTtc: extraction.totalTtc, contactName: extraction.contactName, textExtracted: extraction.textExtracted },
      candidates,
    });
  }),
);

/** Statut + déclenchement manuel de la boîte mail factures (voir lib/invoice-mailbox.ts). */
expensesRouter.get(
  '/mailbox-status',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json({ configured: invoiceMailboxConfigured() });
  }),
);

expensesRouter.post(
  '/sync-mailbox',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!invoiceMailboxConfigured()) throw new HttpError(409, 'Boîte mail non configurée');
    const stats = await syncInvoiceMailbox();
    res.json(stats);
  }),
);

/** Repasse les dépenses "Boîte mail" déjà importées mais mal extraites (montant/n°/fournisseur
 *  manquants) dans l'extracteur — utile après une amélioration de document-extract.ts pour
 *  corriger les PDF déjà en base, pas seulement les prochains reçus. */
expensesRouter.post(
  '/reprocess-email',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const stats = await reprocessEmailEntries();
    res.json(stats);
  }),
);

/**
 * Recherche, dans le texte des factures d'achat déjà en base, les références produit déjà
 * enregistrées sur les articles de stock (StockSupplier.supplierRef) — alimente l'historique
 * d'achat par article (voir GET /api/stock/items/:id/purchase-history). À relancer après avoir
 * ajouté une nouvelle réf. fournisseur, pour retrouver son historique dans les factures passées.
 */
expensesRouter.post(
  '/scan-purchase-refs',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const stats = await scanAllEntriesForRefs();
    res.json(stats);
  }),
);

/**
 * Reprend le dossier « Traité par JJD App » : un mail classé « traité » avant le correctif du
 * multi-pièces-jointes (un échec sur l'une d'elles y faisait atterrir le mail avec sa vraie
 * facture jamais importée) peut y contenir une facture manquante. Ne modifie jamais les mails
 * (comme scanInvoiceMailboxHistory) — dédoublonne par n° de document / montant + date, jamais
 * de doublon si une pièce du mail était en fait déjà connue.
 */
expensesRouter.post(
  '/scan-processed-mailbox',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!invoiceMailboxConfigured()) throw new HttpError(409, 'Boîte mail non configurée');
    const stats = await scanInvoiceMailboxHistory([PROCESSED_MAILBOX]);
    res.json(stats);
  }),
);

/**
 * Import de tout l'historique de la boîte factures (lus et non lus, tous dossiers), en tâche de fond :
 * POST lance (une seule exécution à la fois), GET suit l'avancement. Ne crée aucune dépense (voir
 * scanInvoiceMailboxHistory) : les documents non retrouvés partent dans « Documents à vérifier ».
 */
expensesRouter.get('/mailbox-history', requireAuth(...OFFICE), asyncHandler(async (_req, res) => {
  res.json({ configured: invoiceMailboxConfigured(), ...historyJobStatus() });
}));
expensesRouter.post('/mailbox-history', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  if (!invoiceMailboxConfigured()) throw new HttpError(409, 'Boîte mail non configurée');
  const { since } = z.object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body ?? {});
  const job = startHistoryImport(since ? new Date(since) : null);
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'mailbox_history_import', entity: 'purchaseReceipt', meta: { since: since ?? null } } });
  res.json({ configured: true, ...job });
}));

/* ------------------------------------------------------------------ créer */

const allocationsInput = z.array(z.object({ worksiteId: z.string().min(1), ht: z.coerce.number() })).max(40);

expensesRouter.post(
  '/',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const d = expenseInput.parse(req.body);
    // répartition entre plusieurs chantiers : une seule fiche, les parts s'enregistrent avec elle
    const parts = req.body?.allocations !== undefined ? normalizeParts(d.ht, allocationsInput.parse(req.body.allocations)) : [];
    let supplierName = d.supplierName ?? null;
    if (d.contactId) {
      const c = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { name: true } });
      if (c) supplierName = c.name;
    }
    const e = await prisma.ledgerEntry.create({
      data: {
        ...derive(d.date),
        date: d.date,
        dueDate: d.dueDate ?? null,
        direction: d.direction,
        docType: docTypeOf(d.direction),
        docNumber: d.docNumber ?? null,
        supplierName,
        contactId: d.contactId ?? null,
        categoryCode: d.categoryCode ?? null,
        categoryRaw: d.categoryCode
          ? (await prisma.category.findUnique({ where: { code: d.categoryCode }, select: { label: true } }))?.label ?? null
          : null,
        worksiteId: parts.length ? mainWorksite(parts) : (d.worksiteId ?? null),
        vehicleId: d.vehicleId ?? null,
        ht: d.ht,
        vatRecup: d.vatRecup ?? null,
        ttc: d.ttc ?? null,
        vatRate: d.vatRate ?? null,
        notes: d.notes ?? null,
        paymentStatus: d.paymentStatus,
        paidOn: d.paymentStatus === 'Payé' ? d.date : null,
        source: 'manual',
        createdById: req.user!.id,
      },
      include: inc,
    });
    if (parts.length) {
      await prisma.$transaction((tx) => replaceAllocations(tx, e.id, parts));
      res.status(201).json({ expense: await prisma.ledgerEntry.findUnique({ where: { id: e.id }, include: inc }) });
      return;
    }
    res.status(201).json({ expense: e });
  }),
);

/**
 * Écriture "Facture de vente" du grand livre saisie/rattrapée à la main — pour compléter le
 * CA (utilisé par "Facturé HT" sur la liste Chantiers) quand le dernier import xlsx n'est
 * pas à jour. Distinct de POST / (achats/dépenses uniquement) : direction toujours 'sale',
 * le contact est le client facturé, jamais un fournisseur.
 */
expensesRouter.post(
  '/sale-backfill',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = saleEntryBackfillInput.parse(req.body);
    let clientName = d.clientName ?? null;
    if (d.contactId) {
      const c = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { name: true } });
      if (c) clientName = c.name;
    }
    const e = await prisma.ledgerEntry.create({
      data: {
        ...derive(d.date),
        date: d.date,
        direction: 'sale',
        docType: 'Facture de vente',
        docNumber: d.docNumber ?? null,
        supplierName: clientName,
        contactId: d.contactId ?? null,
        categoryRaw: d.categoryRaw ?? null,
        worksiteId: d.worksiteId ?? null,
        ht: d.ht,
        vatDue: d.vatDue ?? null,
        ttc: d.ttc ?? null,
        paymentStatus: d.paymentStatus,
        paidOn: d.paymentStatus === 'Payé' ? d.date : null,
        source: 'manual',
        createdById: req.user!.id,
      },
      include: inc,
    });
    res.status(201).json({ expense: e });
  }),
);

/* ------------------------------------------------------------------ éditer */

expensesRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Dépense introuvable');
    const d = expenseInput.partial().parse(req.body);
    // répartition entre plusieurs chantiers : `allocations` = les parts (liste vide : plus de répartition) ; absent : on ne touche pas aux parts
    const allocationsGiven = req.body?.allocations !== undefined;
    const hadParts = await prisma.ledgerAllocation.count({ where: { ledgerEntryId: existing.id } });
    const newHt = d.ht !== undefined ? d.ht : existing.ht;
    const parts: AllocPart[] | undefined = allocationsGiven ? normalizeParts(newHt, allocationsInput.parse(req.body.allocations)) : undefined;
    if (parts === undefined && hadParts && d.ht !== undefined && Math.abs(d.ht - existing.ht) > 0.01) {
      throw new HttpError(422, 'Cette facture est répartie entre plusieurs chantiers : modifiez la répartition en même temps que le montant (la somme des parts doit égaler le HT).');
    }

    const data: Record<string, unknown> = {};
    if (d.date) Object.assign(data, derive(d.date), { date: d.date });
    if ('dueDate' in d) data.dueDate = d.dueDate ?? null;
    if (d.direction) {
      data.direction = d.direction;
      data.docType = docTypeOf(d.direction);
    }
    if ('docNumber' in d) data.docNumber = d.docNumber ?? null;
    // facture répartie : le chantier principal vient des parts, l'écran renvoie seulement ce chantier-là (on n'y touche pas sans nouvelles parts)
    if ('worksiteId' in d && !(parts === undefined && hadParts)) data.worksiteId = d.worksiteId ?? null;
    if (parts?.length) data.worksiteId = mainWorksite(parts);
    if ('vehicleId' in d) data.vehicleId = d.vehicleId ?? null;
    if ('ht' in d) data.ht = d.ht;
    if ('vatRecup' in d) data.vatRecup = d.vatRecup ?? null;
    if ('ttc' in d) data.ttc = d.ttc ?? null;
    if ('vatRate' in d) data.vatRate = d.vatRate ?? null;
    if ('notes' in d) data.notes = d.notes ?? null;
    if ('paymentStatus' in d && d.paymentStatus) {
      const payments = await allocationSnapshot();
      data.paymentStatus = payments.ledgerPaid.has(existing.id) ? expensePayment(existing, payments).paymentStatus : d.paymentStatus;
      data.paidOn = data.paymentStatus !== 'Non payé' ? (existing.paidOn ?? new Date()) : null;
    }
    if (d.contactId !== undefined) {
      data.contactId = d.contactId ?? null;
      if (d.contactId) {
        const c = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { name: true } });
        if (c) data.supplierName = c.name;
      }
    }
    if (d.supplierName !== undefined && !d.contactId) data.supplierName = d.supplierName ?? null;
    if (d.categoryCode !== undefined) {
      data.categoryCode = d.categoryCode ?? null;
      data.categoryRaw = d.categoryCode
        ? (await prisma.category.findUnique({ where: { code: d.categoryCode }, select: { label: true } }))?.label ?? null
        : null;
    }

    await prisma.ledgerEntry.update({ where: { id: existing.id }, data });
    if (parts !== undefined) await prisma.$transaction((tx) => replaceAllocations(tx, existing.id, parts));
    res.json({ expense: await prisma.ledgerEntry.findUnique({ where: { id: existing.id }, include: inc }) });
  }),
);

/* ------------------------------------------------------------------ supprimer */

expensesRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { id: true, source: true, direction: true, docNumber: true, contactId: true, supplierName: true, ht: true, ttc: true } });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    if (e.source === 'xlsx') {
      // import historique Excel : supprimable, mais avec garde-fous — jamais si un paiement bancaire y est rapproché ; sans doublon ni autre ligne de la même facture,
      // seulement après confirmation explicite (force=1) ; la ligne est conservée dans le journal pour pouvoir la restaurer
      if (await prisma.bankTransactionMatch.count({ where: { ledgerEntryId: e.id } })) throw new HttpError(409, "Cette ligne est rapprochée d'un paiement bancaire : retirez d'abord le rapprochement, ou fusionnez-la avec les autres lignes de la facture.");
      const twin = (await duplicateIdsFor([e])).has(e.id) || ((await siblingIdsFor([e])).get(e.id)?.length ?? 0) > 0;
      if (!twin && req.query.force !== '1') throw new HttpError(409, "Écriture de l'import historique Excel sans doublon ni autre ligne de la même facture : confirmez la suppression.");
    }
    if (await prisma.creditApplication.count({ where: { OR: [{ creditId: e.id }, { invoiceId: e.id }] } })) throw new HttpError(409, 'Un avoir est imputé sur cette facture : annulez d’abord l’imputation.');
    const full = await prisma.ledgerEntry.findUnique({ where: { id: e.id }, include: { allocations: true } });
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'expense.delete', entity: 'ledger', entityId: e.id, meta: { row: JSON.parse(JSON.stringify(full)) } } }).catch(() => undefined);
    // les BankTransactionMatch de cette dépense partent en cascade (onDelete: Cascade) ; il reste
    // à nettoyer le badge de confiance des transactions qui n'ont plus aucun rapprochement.
    const affectedTxIds = (await prisma.bankTransactionMatch.findMany({ where: { ledgerEntryId: req.params.id }, select: { bankTransactionId: true } })).map((m) => m.bankTransactionId);
    await prisma.ledgerEntry.delete({ where: { id: req.params.id } });
    if (affectedTxIds.length) {
      const stillMatched = await prisma.bankTransactionMatch.findMany({ where: { bankTransactionId: { in: affectedTxIds } }, select: { bankTransactionId: true } });
      const stillMatchedSet = new Set(stillMatched.map((m) => m.bankTransactionId));
      const nowEmpty = affectedTxIds.filter((id) => !stillMatchedSet.has(id));
      if (nowEmpty.length) await prisma.bankTransaction.updateMany({ where: { id: { in: nowEmpty } }, data: { matchConfidence: null, matchedAt: null } });
    }
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ avoirs imputés sur des factures */

/**
 * Imputation d'un avoir fournisseur sur une facture d'achat, quand le fournisseur a réglé la facture avec le crédit (sans virement) :
 * la facture compte comme payée à hauteur du montant imputé, et le crédit restant de l'avoir diminue d'autant.
 */
const sameSupplier = (a: { contactId: string | null; supplierName: string | null }, b: { contactId: string | null; supplierName: string | null }) =>
  (!!a.contactId && a.contactId === b.contactId) || (!!a.supplierName && !!b.supplierName && a.supplierName.trim().toLowerCase() === b.supplierName.trim().toLowerCase());

expensesRouter.get(
  '/:id/credit-applications',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, include: { creditsApplied: { include: { invoice: { select: { id: true, docNumber: true, date: true } } }, orderBy: { appliedOn: 'asc' } }, creditsReceived: { include: { credit: { select: { id: true, docNumber: true, date: true } } }, orderBy: { appliedOn: 'asc' } } } });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    if (e.direction !== 'credit_note' && e.direction !== 'purchase') return res.json({ role: null, applications: [], candidates: [], remaining: 0 });
    const payments = await allocationSnapshot();
    const sup = { contactId: e.contactId, supplierName: e.supplierName };
    const cands = await prisma.ledgerEntry.findMany({
      where: { direction: e.direction === 'credit_note' ? 'purchase' : 'credit_note', id: { not: e.id }, ...(e.contactId ? { contactId: e.contactId } : { supplierName: e.supplierName }) },
      select: { id: true, docNumber: true, date: true, ht: true, ttc: true, paymentStatus: true, contactId: true, supplierName: true, categoryRaw: true, worksite: { select: { ref: true } } },
      orderBy: { date: 'desc' }, take: 300,
    });
    if (e.direction === 'credit_note') {
      const applied = e.creditsApplied.reduce((s, a) => s + a.amount, 0);
      const remaining = Math.max(0, Math.round((Math.abs(e.ttc ?? e.ht) - applied) * 100) / 100);
      const candidates = cands.filter((c) => sameSupplier(sup, c)).map((c) => ({ id: c.id, docNumber: c.docNumber, date: c.date, worksiteRef: c.worksite?.ref ?? null, remaining: expensePayment(c, payments).remainingAmount })).filter((c) => c.remaining > 0.01);
      return res.json({ role: 'credit', total: Math.abs(e.ttc ?? e.ht), remaining, applications: e.creditsApplied.map((a) => ({ id: a.id, amount: a.amount, appliedOn: a.appliedOn, other: a.invoice })), candidates });
    }
    // facture : avoirs encore disponibles du même fournisseur
    const remainingOf = async (c: { id: string; ttc: number | null; ht: number }) => {
      const used = await prisma.creditApplication.aggregate({ where: { creditId: c.id }, _sum: { amount: true } });
      return Math.max(0, Math.round((Math.abs(c.ttc ?? c.ht) - (used._sum.amount ?? 0)) * 100) / 100);
    };
    const candidates = [];
    for (const c of cands.filter((x) => sameSupplier(sup, x) && !/vente/i.test(x.categoryRaw ?? ''))) { const r = await remainingOf(c); if (r > 0.01) candidates.push({ id: c.id, docNumber: c.docNumber, date: c.date, worksiteRef: c.worksite?.ref ?? null, remaining: r }); }
    res.json({ role: 'invoice', total: Math.abs(e.ttc ?? e.ht), remaining: expensePayment(e, payments).remainingAmount, applications: e.creditsReceived.map((a) => ({ id: a.id, amount: a.amount, appliedOn: a.appliedOn, other: a.credit })), candidates });
  }),
);

expensesRouter.post(
  '/:id/apply-credit',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = z.object({ otherId: z.string(), amount: z.coerce.number().positive().max(1_000_000), appliedOn: z.coerce.date().optional() }).parse(req.body);
    const self = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id } });
    const other = await prisma.ledgerEntry.findUnique({ where: { id: d.otherId } });
    if (!self || !other) throw new HttpError(404, 'Dépense introuvable');
    const [credit, invoice] = self.direction === 'credit_note' ? [self, other] : [other, self];
    if (credit.direction !== 'credit_note' || invoice.direction !== 'purchase') throw new HttpError(422, 'Il faut un avoir fournisseur et une facture d’achat.');
    if (!sameSupplier(credit, invoice)) throw new HttpError(422, 'L’avoir et la facture doivent être du même fournisseur.');
    const payments = await allocationSnapshot();
    const creditLeft = Math.abs(credit.ttc ?? credit.ht) - (payments.creditApplied.get(credit.id) ?? 0);
    const invoiceLeft = expensePayment(invoice, payments).remainingAmount;
    if (d.amount > creditLeft + 0.02) throw new HttpError(422, `Il ne reste que ${Math.round(creditLeft * 100) / 100} € de crédit sur cet avoir.`);
    if (d.amount > invoiceLeft + 0.02) throw new HttpError(422, `Il ne reste que ${invoiceLeft} € à payer sur cette facture.`);
    const app = await prisma.creditApplication.create({ data: { creditId: credit.id, invoiceId: invoice.id, amount: Math.round(d.amount * 100) / 100, appliedOn: d.appliedOn ?? new Date() } });
    // facture entièrement couverte : elle passe « Payé » (date = celle de l'imputation)
    if (invoiceLeft - d.amount <= 0.02) await prisma.ledgerEntry.update({ where: { id: invoice.id }, data: { paymentStatus: 'Payé', paidOn: invoice.paidOn ?? app.appliedOn } });
    // avoir entièrement imputé : il passe « Payé » (son crédit est consommé)
    if (creditLeft - d.amount <= 0.02) await prisma.ledgerEntry.update({ where: { id: credit.id }, data: { paymentStatus: 'Payé', paidOn: credit.paidOn ?? app.appliedOn } });
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'credit.apply', entity: 'LedgerEntry', entityId: credit.id, meta: { invoiceId: invoice.id, amount: app.amount } } });
    res.status(201).json({ ok: true, application: app });
  }),
);

expensesRouter.delete(
  '/credit-applications/:appId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const app = await prisma.creditApplication.findUnique({ where: { id: req.params.appId } });
    if (!app) throw new HttpError(404, 'Imputation introuvable');
    await prisma.creditApplication.delete({ where: { id: app.id } });
    // la facture n'est plus couverte par aucun paiement ni imputation : elle redevient « Non payé »
    const payments = await allocationSnapshot();
    const invoice = await prisma.ledgerEntry.findUnique({ where: { id: app.invoiceId } });
    if (invoice && !payments.ledgerPaid.has(invoice.id) && invoice.paymentStatus === 'Payé') await prisma.ledgerEntry.update({ where: { id: invoice.id }, data: { paymentStatus: 'Non payé', paidOn: null } });
    // l'avoir n'est plus entièrement imputé : il redevient « Non payé » s'il avait été marqué payé par l'imputation
    const credit = await prisma.ledgerEntry.findUnique({ where: { id: app.creditId } });
    if (credit && credit.paymentStatus === 'Payé' && !(await prisma.bankTransactionMatch.count({ where: { ledgerEntryId: credit.id } }))) await prisma.ledgerEntry.update({ where: { id: credit.id }, data: { paymentStatus: 'Non payé', paidOn: null } });
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'credit.unapply', entity: 'LedgerEntry', entityId: app.creditId, meta: { invoiceId: app.invoiceId, amount: app.amount } } });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ statut payé */

expensesRouter.post(
  '/:id/paid',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const paid = req.body?.paid !== false;
    const paidOn = req.body?.paidOn ? new Date(req.body.paidOn) : new Date();
    const e = await prisma.ledgerEntry.update({
      where: { id: req.params.id },
      data: { paymentStatus: paid ? 'Payé' : 'Non payé', paidOn: paid ? paidOn : null },
      include: inc,
    });
    res.json({ expense: e });
  }),
);

/* ------------------------------------------------------------------ lien bordereau -> facture */

/**
 * Relie un bordereau (direction "delivery_slip") à la facture d'achat reçue ensuite
 * (`invoiceId: null` pour délier). Plusieurs bordereaux peuvent pointer vers la même facture
 * (un fournisseur en consolide parfois plusieurs sur une facture mensuelle unique).
 */
expensesRouter.post(
  '/:id/link',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const slip = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { id: true, direction: true } });
    if (!slip) throw new HttpError(404, 'Bordereau introuvable');
    if (slip.direction !== 'delivery_slip') throw new HttpError(422, 'Seul un bordereau peut être relié à une facture.');
    const { invoiceId } = linkInvoiceInput.parse(req.body);
    if (invoiceId) {
      if (invoiceId === slip.id) throw new HttpError(422, 'Un bordereau ne peut pas se relier lui-même.');
      const invoice = await prisma.ledgerEntry.findUnique({ where: { id: invoiceId }, select: { direction: true } });
      if (!invoice || invoice.direction !== 'purchase') throw new HttpError(422, 'Facture d’achat introuvable.');
    }
    const e = await prisma.ledgerEntry.update({ where: { id: slip.id }, data: { linkedInvoiceId: invoiceId ?? null }, include: inc });
    res.json({ expense: e });
  }),
);

/* ------------------------------------------------------------------ pièce jointe */

expensesRouter.post(
  '/:id/pdf',
  requireAuth(...FIELD_OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const okType = req.file.mimetype === 'application/pdf' || /^image\/(jpe?g|png|webp|heic)$/.test(req.file.mimetype);
    if (!okType) throw new HttpError(422, 'Format accepté : PDF ou image.');
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const rel = storeFile(req.file.buffer, req.file.originalname || 'facture.pdf', 'expenses');
    // nouveau PDF : les lignes d'article lues dans l'ancien sont périmées, l'achat sera relu à la prochaine lecture
    await prisma.$transaction([
      prisma.purchaseLine.deleteMany({ where: { ledgerEntryId: e.id } }),
      prisma.ledgerEntry.update({ where: { id: e.id }, data: { pdfPath: rel, linesScannedAt: null, linesScanStatus: null } }),
    ]);
    res.status(201).json({ ok: true, pdfPath: rel });
  }),
);

expensesRouter.get(
  '/:id/pdf',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { pdfPath: true, docNumber: true } });
    if (!e?.pdfPath) throw new HttpError(404, 'Aucune pièce jointe');
    const file = resolveUpload(e.pdfPath);
    if (!existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename="${(e.docNumber ?? 'facture').replace(/[^\w.-]/g, '_')}${ext}"`);
    createReadStream(file).pipe(res);
  }),
);

expensesRouter.delete(
  '/:id/pdf',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.ledgerEntry.update({ where: { id: req.params.id }, data: { pdfPath: null } });
    res.json({ ok: true });
  }),
);
