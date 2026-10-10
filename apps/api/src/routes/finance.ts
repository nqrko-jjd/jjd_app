import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { prisma } from '../db.js';
import { insensitive } from '../lib/search.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requirePartner, OFFICE } from '../lib/auth.js';
import { consolidatedPnl, profitShare, forecastReceivable } from '../lib/consolidated.js';
import { analytics } from '../lib/analytics.js';
import { autoMatchAll, recomputeDocumentPayment, documentIdForLedger } from '../lib/bank-match.js';
import { parseBankCsv, decodeCsvBuffer, type ParsedBankRow } from '../lib/bank-csv.js';
import { parseCardStatement, pdfToRawText, pdftotextAvailable } from '../lib/bank-pdf.js';
import { parseScreenshots, screenshotImportAvailable } from '../lib/bank-screenshot.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';
import { parseAmount, parseLooseDate } from '@jjd/shared';
import { syncLedgerEntryForDocument } from '../lib/documents.js';
import { supplierAccounts } from '../lib/supplier-account.js';
import { allocationSnapshot, freezeLegacyAllocations } from '../lib/bank-allocation.js';
import { purchaseRemaining } from '../lib/payment-tolerance.js';
import { PAYMENT_TOLERANCE } from '../lib/payment-tolerance.js';

export const financeRouter = Router();
financeRouter.get('/suppliers', requireAuth(...OFFICE), asyncHandler(async (_req, res) => {
  res.json({ items: await supplierAccounts() });
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function derive(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

const normDesc = (s: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Références bancaires du libellé brut (« REF. : 311fc58a… ») — identifient l'opération. */
const bankRefs = (s: string | null) => new Set([...(s ?? '').matchAll(/REF\.?\s*:\s*([A-Za-z0-9]{8,})/gi)].map((m) => m[1]!.toUpperCase()));

/** Insère des lignes de relevé. Doublon = même identifiant (ré-import, fichiers qui se recoupent), ou — pour une ligne
 *  déjà en base d'un AUTRE import — même jour/montant avec exactement le même libellé, ou une même REF bancaire.
 *  Plus d'heuristique « même montant à quelques jours + début de nom identique » : elle écartait de vraies opérations
 *  (parkings, prélèvements récurrents). Deux lignes du même fichier ne se comparent jamais entre elles. */
export async function insertBankRows(rows: ParsedBankRow[], bankLabel: string, source: string) {
  const runStart = new Date();
  let imported = 0;
  let duplicates = 0;
  for (const r of rows) {
    if (await prisma.bankTransaction.findUnique({ where: { externalId: r.externalId } })) { duplicates++; continue; }
    if (r.bookingDate && r.amount != null && r.description) {
      const day = new Date(r.bookingDate); day.setUTCHours(0, 0, 0, 0);
      const next = new Date(day); next.setUTCDate(next.getUTCDate() + 1);
      const myRefs = bankRefs(r.description);
      const near = await prisma.bankTransaction.findMany({
        where: { amount: r.amount, createdAt: { lt: runStart }, bookingDate: { gte: new Date(day.getTime() - 3 * 86400000), lt: next } },
        select: { bookingDate: true, description: true },
      });
      const isDup = near.some((n) => {
        const sameDay = n.bookingDate != null && n.bookingDate >= day && n.bookingDate < next;
        if (sameDay && normDesc(n.description) === normDesc(r.description)) return true;
        const theirRefs = bankRefs(n.description);
        return myRefs.size > 0 && [...myRefs].some((x) => theirRefs.has(x));
      });
      if (isDup) { duplicates++; continue; }
    }
    await prisma.bankTransaction.create({
      data: {
        externalId: r.externalId, bookingDate: r.bookingDate, valueDate: r.valueDate,
        bank: bankLabel, amount: r.amount, currency: r.currency,
        counterpartyName: r.counterpartyName, counterpartyAccount: r.counterpartyAccount,
        description: r.description, communication: r.communication,
        side: (r.amount ?? 0) < 0 ? 'out' : 'in', source,
      },
    });
    imported++;
  }
  return { imported, duplicates };
}

/** P&L consolidé (bureau + admin). */
financeRouter.get(
  '/consolidated',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { year, month, entity } = req.query as Record<string, string>;
    res.json(
      await consolidatedPnl({
        year: year ? Number(year) : undefined,
        month: month ? Number(month) : undefined,
        entity: entity === 'jjd' || entity === 'tonton' || entity === 'm7' ? entity : undefined,
      }),
    );
  }),
);

/** Séries pour la page Analyse (graphiques). */
financeRouter.get(
  '/analytics',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { months, entity } = req.query as Record<string, string>;
    res.json(
      await analytics({
        months: months ? Number(months) : undefined,
        entity: entity === 'jjd' || entity === 'tonton' || entity === 'm7' ? entity : undefined,
      }),
    );
  }),
);

/** Partage des bénéfices — associés uniquement. */
financeRouter.get(
  '/profit-share',
  requirePartner,
  asyncHandler(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(await profitShare(year));
  }),
);

/** Prévisionnel — devis acceptés pas encore totalement facturés, par chantier. */
financeRouter.get(
  '/forecast',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json(await forecastReceivable());
  }),
);

/** Années disponibles pour les filtres. */
financeRouter.get(
  '/years',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.ledgerEntry.groupBy({ by: ['year'], where: { year: { not: null } } });
    res.json({ years: rows.map((r) => r.year).filter(Boolean).sort((a, b) => (b as number) - (a as number)) });
  }),
);

/* ------------------------------------------------------- ventes (grand livre, historique) */

const SALES_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'date', label: 'Date' },
  { key: 'dueDate', label: 'Échéance' },
  { key: 'client', label: 'Client' },
  { key: 'docNumber', label: 'N° document' },
  { key: 'worksiteRef', label: 'Chantier' },
  { key: 'ht', label: 'HT' },
  { key: 'vatDue', label: 'TVA due' },
  { key: 'ttc', label: 'TTC' },
  { key: 'paymentStatus', label: 'Statut' },
  { key: 'notes', label: 'Notes' },
];

const salesInc = { worksite: { select: { id: true, ref: true } }, contact: { select: { id: true, name: true } } } as const;

/** Export en CSV des ventes du grand livre (historique Excel + saisies manuelles). */
financeRouter.get(
  '/sales/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { from, to, worksiteId, year } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { direction: 'sale' };
    if (worksiteId) where.worksiteId = worksiteId;
    if (year) where.year = Number(year);
    if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const items = await prisma.ledgerEntry.findMany({ where, orderBy: { date: 'desc' }, take: 5000, include: salesInc });
    const rows = items.map((e) => ({
      id: e.id,
      date: e.date,
      dueDate: e.dueDate,
      client: e.contact?.name ?? e.supplierName ?? '',
      docNumber: e.docNumber ?? '',
      worksiteRef: e.worksite?.ref ?? e.worksiteRef ?? '',
      ht: e.ht,
      vatDue: e.vatDue,
      ttc: e.ttc,
      paymentStatus: e.paymentStatus ?? 'Non payé',
      notes: e.notes ?? '',
    }));
    const csv = toCsv(SALES_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ventes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

/**
 * Réimporte un fichier de ventes (précédemment exporté puis corrigé dans Excel, ou
 * nouveau). Une ligne avec un `id` connu met à jour l'écriture ; sans `id` (ou
 * inconnu), une nouvelle écriture est créée. Rien n'est jamais supprimé.
 */
financeRouter.post(
  '/sales/import',
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
      const rowNum = i + 2;
      const id = pick(row, 'id');
      const date = parseLooseDate(pick(row, 'date'));
      if (!date) { warnings.push({ row: rowNum, message: 'Date manquante ou invalide — ligne ignorée' }); continue; }

      const worksiteRef = pick(row, 'chantier', 'worksiteref');
      let worksiteId: string | null | undefined;
      if (worksiteRef) {
        const w = await prisma.worksite.findFirst({ where: { ref: worksiteRef } });
        if (w) worksiteId = w.id;
        else warnings.push({ row: rowNum, message: `Chantier « ${worksiteRef} » introuvable — non modifié` });
      }

      const clientName = pick(row, 'client');
      let contactId: string | null | undefined;
      if (clientName) {
        const c = await prisma.contact.findFirst({ where: { name: { equals: clientName }, type: { in: ['client', 'both'] } } });
        if (c) contactId = c.id;
      }

      const paidRaw = (pick(row, 'statut', 'paymentstatus') ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
      const paymentStatus = paidRaw === 'paye' ? 'Payé' : 'Non payé';

      const data: Record<string, unknown> = {
        date,
        dueDate: parseLooseDate(pick(row, 'echeance', 'échéance', 'duedate')),
        direction: 'sale',
        docType: 'Facture de vente',
        docNumber: pick(row, 'n document', 'docnumber', 'numero') || null,
        worksiteRef: worksiteRef || null,
        ...(worksiteId !== undefined ? { worksiteId } : {}),
        supplierName: clientName || null,
        ...(contactId !== undefined ? { contactId } : {}),
        ht: parseAmount(pick(row, 'ht')) ?? 0,
        vatDue: parseAmount(pick(row, 'tva due', 'vatdue')),
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

/* ------------------------------------------------------- rapprochement bancaire */

financeRouter.get(
  '/bank',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { matched, q: qRaw, from, bank, documentId, page: pageStr, pageSize: pageSizeStr, sort, dir } = req.query as Record<string, string>;
    const q = qRaw?.toLowerCase();
    const and: Record<string, unknown>[] = [];
    // Retrouver la transaction qui a réglé une facture précise (lien direct depuis sa fiche) —
    // prioritaire sur `matched`, puisqu'une facture rapprochée est par définition "matched".
    // Le rapprochement peut viser directement le Document (rapprochement manuel), ou son
    // écriture de grand livre synchronisée (rapprochement automatique) — les deux comptent.
    if (documentId) {
      const dn = (await prisma.document.findUnique({ where: { id: documentId }, select: { number: true } }))?.number;
      and.push({ matches: { some: { OR: [{ documentId }, { ledgerEntry: { documentId } }, ...(dn ? [{ ledgerEntry: { documentId: null, docNumber: dn, direction: { in: ['sale', 'credit_note'] } } }] : [])] } } });
    }
    else if (matched === '1') and.push({ matches: { some: {} } });
    else if (matched === '0') and.push({ matches: { none: {} } });
    if (from) and.push({ bookingDate: { gte: new Date(from) } });
    if (bank) and.push({ bank });
    if (typeof req.query.transactionId === 'string') { and.length = 0; and.push({ id: req.query.transactionId }); }
    if (q) and.push({ OR: [{ counterpartyName: { contains: q, ...insensitive } }, { description: { contains: q, ...insensitive } }, { communication: { contains: q, ...insensitive } }] });
    const where: Record<string, unknown> = and.length ? { AND: and } : {};

    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));
    const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc';
    const orderBy: Record<string, unknown> =
      sort === 'bank' ? { bank: sortDir }
      : sort === 'counterparty' ? { counterpartyName: sortDir }
      : sort === 'amount' ? { amount: sortDir }
      : { bookingDate: sortDir };

    const [items, filteredCount, stats, total, done] = await Promise.all([
      prisma.bankTransaction.findMany({
        where, orderBy,
        skip: (page - 1) * pageSize, take: pageSize,
        include: {
          account: { select: { label: true, iban: true } },
          contact: { select: { id: true, name: true } },
          matches: {
            orderBy: { createdAt: 'asc' },
            include: {
              ledgerEntry: { select: { id: true, docNumber: true, supplierName: true, direction: true, documentId: true, ttc: true, ht: true, worksite: { select: { ref: true } } } },
              document: { select: { id: true, number: true, kind: true, totalTtc: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } } },
            },
          },
        },
      }),
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.groupBy({ by: ['bank'], _count: true, _sum: { amount: true } }),
      prisma.bankTransaction.count(),
      prisma.bankTransaction.count({ where: { matches: { some: {} } } }),
    ]);
    const allocations = await allocationSnapshot();
    res.json({
      items: items.map(t => ({ ...t, matches: t.matches.map(m => ({ ...m, amount: allocations.amounts.get(m.id) ?? 0 })) })),
      byBank: stats, matched: done, total,
      page, pageSize, totalCount: filteredCount, totalPages: Math.max(1, Math.ceil(filteredCount / pageSize)),
    });
  }),
);

/**
 * Correction manuelle d'une transaction importée (date, banque, contrepartie, communication,
 * montant…) — en attendant Ponto (flux bancaire live), c'est le seul moyen de rattraper une
 * erreur d'import (CSV/PDF/capture d'écran) sans tout réimporter.
 */
financeRouter.patch(
  '/bank/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const updated = await prisma.$transaction(async db => {
    const existing = await db.bankTransaction.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Transaction introuvable');
    const b = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if ('bookingDate' in b) data.bookingDate = parseLooseDate(b.bookingDate);
    if ('valueDate' in b) data.valueDate = parseLooseDate(b.valueDate);
    if ('bank' in b) data.bank = typeof b.bank === 'string' ? b.bank.trim() || null : null;
    if ('counterpartyName' in b) data.counterpartyName = typeof b.counterpartyName === 'string' ? b.counterpartyName.trim() || null : null;
    if ('counterpartyAccount' in b) data.counterpartyAccount = typeof b.counterpartyAccount === 'string' ? b.counterpartyAccount.trim() || null : null;
    if ('description' in b) data.description = typeof b.description === 'string' ? b.description.trim() || null : null;
    if ('communication' in b) data.communication = typeof b.communication === 'string' ? b.communication.trim() || null : null;
    if ('amount' in b) {
      const amount = parseAmount(b.amount);
      if (amount == null) throw new HttpError(422, 'Montant invalide');
      const allocation = await freezeLegacyAllocations(db, { transactionId: existing.id });
      const used = allocation.transactions.get(existing.id) ?? 0;
      if (Math.abs(amount) < used || used > 0 && Math.sign(amount) !== Math.sign(existing.amount ?? 0)) throw new HttpError(409, 'Modifiez les affectations avant de réduire ou inverser ce paiement');
      data.amount = amount;
      data.side = amount < 0 ? 'out' : 'in';
    }
    // client / payeur à qui attribuer ce virement entrant (argent reçu sans facture : acompte à facturer, trop-perçu)
    if ('contactId' in b) {
      if (b.contactId == null || b.contactId === '') data.contactId = null;
      else {
        if (typeof b.contactId !== 'string' || !(await db.contact.findUnique({ where: { id: b.contactId }, select: { id: true } }))) throw new HttpError(422, 'Contact introuvable');
        data.contactId = b.contactId;
      }
    }
    return db.bankTransaction.update({ where: { id: existing.id }, data });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    res.json({ transaction: updated });
  }),
);

/**
 * Une facture de vente historique (import Excel) existe au grand livre SANS lien avec son Document de
 * l'appli : les deux ressortaient dans les propositions de rapprochement, et choisir le Document créait une
 * 2e écriture (vente comptée deux fois). On retire donc le Document et on propose à sa place l'écriture
 * existante, la seule qui compte dans les finances.
 */
async function splitLedgerTwins<D extends { number: string | null }>(docs: D[]) {
  const nums = docs.map((d) => d.number).filter((n): n is string => !!n);
  if (!nums.length) return { docs, twins: [] };
  const twins = await prisma.ledgerEntry.findMany({
    where: { documentId: null, direction: { in: ['sale', 'credit_note'] }, docNumber: { in: nums } },
    include: { worksite: { select: { ref: true, title: true } } },
  });
  const have = new Set(twins.map((t) => (t.docNumber ?? '').trim().toUpperCase()));
  return { docs: docs.filter((d) => !d.number || !have.has(d.number.trim().toUpperCase())), twins };
}

/**
 * Candidates déjà soldées : une écriture du grand livre ou un Document dont les paiements bancaires déjà rapprochés
 * (à d'AUTRES transactions) couvrent le total, ou une facture marquée payée/créditée, ne se reproposent plus dans les
 * suggestions automatiques — elles n'ont plus rien à recevoir. La recherche manuelle applique les mêmes soldes.
 */
async function alreadySettled(
  ledgers: { id: string; ttc: number | null; ht: number; direction: string; docNumber: string | null; contactId: string | null; paymentStatus?: string | null }[],
  docs: { id: string; totalTtc: number; status: string; paidAmount?: number }[],
) {
  const snapshot = await allocationSnapshot();
  const numbers = ledgers.filter(l => l.direction === 'sale' && l.docNumber).map(l => l.docNumber!);
  const originals = numbers.length ? await prisma.document.findMany({ where: { number: { in: numbers }, kind: { in: ['invoice', 'deposit_invoice'] } } }) : [];
  const ledgerRemaining = new Map(ledgers.map(l => [l.id, snapshot.ledgerPaid.has(l.id) ? (l.direction === 'purchase' ? purchaseRemaining(Math.abs(l.ttc ?? l.ht), snapshot.ledgerPaid.get(l.id) ?? 0) : Math.max(0, Math.round((Math.abs(l.ttc ?? l.ht) - (snapshot.ledgerPaid.get(l.id) ?? 0)) * 100) / 100)) : /^payé$/i.test(l.paymentStatus ?? '') ? 0 : Math.abs(l.ttc ?? l.ht)]));
  for (const l of ledgers) {
    if (l.direction !== 'sale' || snapshot.ledgerPaid.has(l.id)) continue;
    const twins = originals.filter(d => d.number === l.docNumber && (!l.contactId || d.contactId === l.contactId));
    if (twins.length !== 1) continue;
    const d = twins[0]!;
    const paid = snapshot.docPaid.get(d.id) ?? d.paidAmount;
    ledgerRemaining.set(l.id, ['paid', 'credited', 'draft', 'declined'].includes(d.status) && !snapshot.docPaid.has(d.id) ? 0 : Math.max(0, Math.round((Math.abs(l.ttc ?? l.ht) - paid) * 100) / 100));
  }
  const docRemaining = new Map(docs.map(d => [d.id, ['credited', 'declined', 'draft'].includes(d.status) ? 0 : snapshot.docPaid.has(d.id) ? Math.max(0, Math.round((Math.abs(d.totalTtc) - (snapshot.docPaid.get(d.id) ?? 0)) * 100) / 100) : d.status === 'paid' ? 0 : Math.max(0, Math.abs(d.totalTtc) - (d.paidAmount ?? 0))]));
  return { ledger: new Set([...ledgerRemaining].filter(([,a]) => a <= 0.01).map(([id]) => id)), doc: new Set([...docRemaining].filter(([,a]) => a <= 0.01).map(([id]) => id)), ledgerRemaining, docRemaining };
}

/** Suggère des écritures du grand livre à rapprocher d'une transaction. */
financeRouter.get(
  '/bank/:id/suggestions',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const tx = await prisma.bankTransaction.findUnique({ where: { id: req.params.id }, include: { matches: true } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');
    const allocations = await allocationSnapshot();
    const remaining = Math.max(0, Math.round((Math.abs(tx.amount ?? 0) - (allocations.transactions.get(tx.id) ?? 0)) * 100) / 100);
    if (remaining <= 0.01) return res.json({ items: [], remaining });
    const inc = { worksite: { select: { ref: true, title: true } } };

    // déjà rapproché à CETTE transaction — jamais reproposé (un paiement peut en couvrir
    // plusieurs autres en revanche, donc pas d'exclusion cross-transaction)
    const usedLedgerIds = tx.matches.map((m) => m.ledgerEntryId).filter((x): x is string => !!x);
    const usedDocIds = tx.matches.map((m) => m.documentId).filter((x): x is string => !!x);

    // recherche manuelle : l'utilisateur cherche lui-même (n° facture, fournisseur, chantier…)
    // au lieu de se limiter aux propositions automatiques (montant/date proches) — utile
    // quand il n'y a aucune proposition ou que la bonne facture n'y figure pas
    const q = (req.query.q as string | undefined)?.trim().toLowerCase();
    if (q) {
      const [ledgers, docs] = await Promise.all([
        prisma.ledgerEntry.findMany({
          where: {
            id: { notIn: usedLedgerIds },
            documentId: null, // sinon la même facture ressort 2x : la LedgerEntry synchronisée ET son Document d'origine (voir plus bas)
            OR: [
              { docNumber: { contains: q, ...insensitive } },
              { supplierName: { contains: q, ...insensitive } },
              { worksite: { ref: { contains: q, ...insensitive } } },
              { worksite: { title: { contains: q, ...insensitive } } },
              { contact: { name: { contains: q, ...insensitive } } },
            ],
          },
          take: 20, include: inc, orderBy: { date: 'desc' },
        }),
        prisma.document.findMany({
          where: {
            id: { notIn: usedDocIds },
            kind: { in: ['invoice', 'deposit_invoice'] },
            OR: [
              { number: { contains: q, ...insensitive } },
              { contact: { name: { contains: q, ...insensitive } } },
              { worksite: { ref: { contains: q, ...insensitive } } },
              { worksite: { title: { contains: q, ...insensitive } } },
            ],
          },
          take: 15, orderBy: { issuedOn: 'desc' },
          select: { id: true, number: true, kind: true, totalTtc: true, issuedOn: true, status: true, paidAmount: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
        }),
      ]);
      const split = await splitLedgerTwins(docs);
      const known = new Set(ledgers.map((l) => l.id));
      const twinLedgers = split.twins.filter((t) => !known.has(t.id) && !usedLedgerIds.includes(t.id));
      const settled = await alreadySettled([...ledgers, ...twinLedgers], split.docs);
      return res.json({
        remaining,
        items: [
          ...[...ledgers, ...twinLedgers].filter(l => !settled.ledger.has(l.id) && l.direction === ((tx.amount ?? 0) < 0 ? "purchase" : "sale")).map((l) => ({
            kind: 'ledger' as const,
            id: l.id,
            label: [l.docNumber, l.supplierName].filter(Boolean).join(' · ') || (l.direction === 'sale' ? 'Vente' : 'Achat'),
            amount: settled.ledgerRemaining.get(l.id) ?? 0,
            date: l.date,
            direction: l.direction,
            worksiteRef: l.worksite?.ref ?? l.worksiteRef ?? null,
          })),
          ...split.docs.filter(d => !settled.doc.has(d.id) && (tx.amount ?? 0) > 0).map((d) => ({
            kind: 'document' as const,
            id: d.id,
            label: [d.number, d.contact?.name].filter(Boolean).join(' · ') || 'Facture de vente',
            amount: settled.docRemaining.get(d.id) ?? 0,
            date: d.issuedOn,
            direction: 'sale' as const,
            worksiteRef: d.worksite?.ref ?? null,
            status: d.status,
          })),
        ],
      });
    }

    // déjà partiellement affecté (ex. acompte de 10 000 € réparti sur plusieurs factures) :
    // les propositions par montant visent ce qu'il reste à couvrir, pas le montant total du
    // virement — sinon plus aucune facture ne matcherait après le premier rapprochement.
    const amount = remaining;

    const window = tx.bookingDate
      ? { date: { gte: new Date(tx.bookingDate.getTime() - 20 * 86400000), lte: new Date(tx.bookingDate.getTime() + 20 * 86400000) } }
      : {};

    const byComm = !tx.matches.length && tx.structuredComm && tx.structuredComm.length >= 10
      ? await prisma.ledgerEntry.findMany({ where: { bankComm: { contains: tx.structuredComm.slice(0, 12) }, id: { notIn: usedLedgerIds }, documentId: null }, take: 5, include: inc })
      : [];
    const byAmount = await prisma.ledgerEntry.findMany({
      // documentId: null — sinon la même facture ressort 2x (LedgerEntry synchronisée + son Document d'origine, voir docItems plus bas)
      where: { ttc: { gte: amount - 1, lte: amount + 1 }, id: { notIn: usedLedgerIds }, documentId: null, ...window },
      take: 40, include: inc, orderBy: { date: 'desc' },
    });
    const seen = new Set<string>();
    const ledgerRaw = [...byComm, ...byAmount].filter((l) => (seen.has(l.id) ? false : seen.add(l.id)));

    // factures de vente créées dans l'app (Document) — mêmes critères
    const docWindow = tx.bookingDate
      ? { issuedOn: { gte: new Date(tx.bookingDate.getTime() - 25 * 86400000), lte: new Date(tx.bookingDate.getTime() + 25 * 86400000) } }
      : {};
    const docs = await prisma.document.findMany({
      where: {
        kind: { in: ['invoice', 'deposit_invoice'] },
        id: { notIn: usedDocIds },
        totalTtc: { gte: amount - 1, lte: amount + 1 },
        ...docWindow,
      },
      take: 30,
      orderBy: { issuedOn: 'desc' },
      select: { id: true, number: true, kind: true, totalTtc: true, issuedOn: true, status: true, paidAmount: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
    });
    const autoSplit = await splitLedgerTwins(docs);
    const autoKnown = new Set(ledgerRaw.map((l) => l.id));
    const twinsToAdd = autoSplit.twins.filter((t) => !autoKnown.has(t.id) && !usedLedgerIds.includes(t.id));
    // ce qui est déjà soldé par d'autres paiements n'est plus proposé
    const settled = await alreadySettled([...ledgerRaw, ...twinsToAdd], autoSplit.docs);
    const ledgerItems = [...ledgerRaw, ...twinsToAdd]
      .filter((l) => !settled.ledger.has(l.id) && l.direction === ((tx.amount ?? 0) < 0 ? "purchase" : "sale"))
      .slice(0, 12)
      .map((l) => ({
        kind: 'ledger' as const,
        id: l.id,
        label: [l.docNumber, l.supplierName].filter(Boolean).join(' · ') || (l.direction === 'sale' ? 'Vente' : 'Achat'),
        amount: settled.ledgerRemaining.get(l.id) ?? 0,
        date: l.date,
        direction: l.direction,
        worksiteRef: l.worksite?.ref ?? l.worksiteRef ?? null,
      }));
    const docItems = autoSplit.docs.filter((d) => !settled.doc.has(d.id) && (tx.amount ?? 0) > 0).slice(0, 8).map((d) => ({
      kind: 'document' as const,
      id: d.id,
      label: [d.number, d.contact?.name].filter(Boolean).join(' · ') || 'Facture de vente',
      amount: settled.docRemaining.get(d.id) ?? 0,
      date: d.issuedOn,
      direction: 'sale' as const,
      worksiteRef: d.worksite?.ref ?? null,
      status: d.status,
    }));

    res.json({ items: [...ledgerItems, ...docItems], remaining: Math.round(remaining * 100) / 100 });
  }),
);

/** Add or edit a share, atomically bounded by both invoice and payment balances. */
async function saveAllocation(txId: string, body: Record<string, unknown>, matchId?: string) {
  return prisma.$transaction(async db => {
    const tx = await db.bankTransaction.findUnique({ where: { id: txId } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');
    const previous = matchId ? await db.bankTransactionMatch.findFirst({ where: { id: matchId, bankTransactionId: txId } }) : null;
    if (matchId && !previous) throw new HttpError(404, 'Rapprochement introuvable');
    const ledgerId = previous?.ledgerEntryId ?? (typeof body.ledgerId === 'string' ? body.ledgerId : null);
    const documentId = previous?.documentId ?? (typeof body.documentId === 'string' ? body.documentId : null);
    if (!!ledgerId === !!documentId) throw new HttpError(422, 'Choisissez une seule facture');
    const ledger = ledgerId ? await db.ledgerEntry.findUnique({ where: { id: ledgerId } }) : null;
    const doc = documentId ? await db.document.findUnique({ where: { id: documentId } }) : null;
    if (!ledger && !doc) throw new HttpError(404, 'Facture introuvable');
    if (doc && (!['invoice', 'deposit_invoice'].includes(doc.kind) || ['draft', 'credited', 'declined'].includes(doc.status))) throw new HttpError(422, 'Cette facture ne peut pas recevoir de paiement');
    if (ledger && !['purchase', 'sale'].includes(ledger.direction)) throw new HttpError(422, 'Choisissez une facture d’achat ou de vente');
    if ((tx.amount ?? 0) === 0 || ((tx.amount ?? 0) < 0) !== (ledger?.direction === 'purchase')) throw new HttpError(422, 'Le sens du paiement ne correspond pas à la facture');
    let canonicalDocId = documentId ?? ledger?.documentId;
    if (!canonicalDocId && ledger?.direction === 'sale' && ledger.docNumber) {
      const twins = await db.document.findMany({ where: { number: ledger.docNumber, kind: { in: ['invoice', 'deposit_invoice'] }, ...(ledger.contactId ? { contactId: ledger.contactId } : {}) }, select: { id: true } });
      if (twins.length === 1) canonicalDocId = twins[0]!.id;
    }
    const original = doc ?? (canonicalDocId ? await db.document.findUnique({ where: { id: canonicalDocId } }) : null);
    if (original && ['draft', 'credited', 'declined'].includes(original.status)) throw new HttpError(422, 'Cette facture ne peut pas recevoir de paiement');
    const snapshot = await freezeLegacyAllocations(db, { transactionId: txId, ledgerId, documentId: canonicalDocId });
    if (!previous && snapshot.matches.some(m => m.bankTransactionId === txId && (ledgerId && m.ledgerEntryId === ledgerId || canonicalDocId && snapshot.invoiceKeys.get(m.id) === `document:${canonicalDocId}`))) throw new HttpError(409, 'Cette facture est déjà liée à ce paiement : modifiez son montant');
    const oldAmount = previous ? snapshot.amounts.get(previous.id) ?? 0 : 0;
    const total = Math.abs(doc?.totalTtc ?? ledger?.ttc ?? ledger?.ht ?? 0);
    const paid = documentId ? snapshot.docPaid.get(documentId) ?? 0 : snapshot.ledgerPaid.get(ledgerId!) ?? (canonicalDocId ? snapshot.docPaid.get(canonicalDocId) ?? 0 : 0);
    const hasMatches = documentId ? snapshot.docPaid.has(documentId) : snapshot.ledgerPaid.has(ledgerId!) || !!canonicalDocId && snapshot.docPaid.has(canonicalDocId);
    const markedPaid = original?.status === 'paid' || /^payé$/i.test(ledger?.paymentStatus ?? '');
    const invoiceRemaining = Math.max(0, Math.round((total - (hasMatches ? paid : markedPaid ? total : 0) + oldAmount) * 100) / 100);
    const txRemaining = Math.max(0, Math.round((Math.abs(tx.amount ?? 0) - (snapshot.transactions.get(txId) ?? 0) + oldAmount) * 100) / 100);
    const requested = body.amount === undefined ? Math.min(invoiceRemaining, txRemaining) : parseAmount(body.amount);
    if (requested == null || !Number.isFinite(requested) || requested <= 0) throw new HttpError(422, 'Saisissez un montant positif');
    const amount = Math.round(requested * 100) / 100;
    if (amount <= 0 || amount > invoiceRemaining || amount > txRemaining) throw new HttpError(409, 'Montant supérieur au solde de la facture ou du paiement');
    if (previous) await db.bankTransactionMatch.update({ where: { id: previous.id }, data: { amount } });
    else await db.bankTransactionMatch.create({ data: { bankTransactionId: txId, ledgerEntryId: ledgerId, documentId, amount } });
    const contactId = ledger?.contactId ?? doc?.contactId;
    await db.bankTransaction.update({ where: { id: txId }, data: { matchConfidence: 'manual', matchedAt: new Date(), ...(!tx.contactId && contactId ? { contactId } : {}) } });
    if (ledger && !ledger.documentId) await db.ledgerEntry.update({ where: { id: ledger.id }, data: { paymentStatus: (ledger.direction === 'purchase' ? purchaseRemaining(total, paid - oldAmount + amount) === 0 : paid - oldAmount + amount + 0.01 >= total) ? 'Payé' : 'Partiel', paidOn: tx.bookingDate ?? new Date() } });
    return { ledgerId, documentId, amount };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}
async function refreshAllocationDocument(ledgerId: string | null, documentId: string | null) {
  const id = documentId ?? (ledgerId ? await documentIdForLedger(ledgerId) : null);
  if (id) await recomputeDocumentPayment(id);
}
financeRouter.post('/bank/:id/matches', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const saved = await saveAllocation(req.params.id!, req.body);
  await refreshAllocationDocument(saved.ledgerId, saved.documentId);
  res.status(201).json({ ok: true, amount: saved.amount });
}));
financeRouter.patch('/bank/:id/matches/:matchId', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const saved = await saveAllocation(req.params.id!, req.body, req.params.matchId);
  await refreshAllocationDocument(saved.ledgerId, saved.documentId);
  res.json({ ok: true, amount: saved.amount });
}));
financeRouter.delete('/bank/:id/matches/:matchId', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const m = await prisma.$transaction(async db => {
    await freezeLegacyAllocations(db, { transactionId: req.params.id! });
    const found = await db.bankTransactionMatch.findFirst({ where: { id: req.params.matchId, bankTransactionId: req.params.id } });
    if (!found) throw new HttpError(404, 'Rapprochement introuvable');
    await db.bankTransactionMatch.delete({ where: { id: found.id } });
    const snapshot = await allocationSnapshot(db);
    if (found.ledgerEntryId) {
      const l = await db.ledgerEntry.findUnique({ where: { id: found.ledgerEntryId } });
      if (l && !l.documentId) {
        const paid = snapshot.ledgerPaid.get(l.id) ?? 0;
        await db.ledgerEntry.update({ where: { id: l.id }, data: { paymentStatus: paid === 0 ? 'Non payé' : (l.direction === 'purchase' ? purchaseRemaining(Math.abs(l.ttc ?? l.ht), paid) === 0 : paid + 0.01 >= Math.abs(l.ttc ?? l.ht)) ? 'Payé' : 'Partiel', paidOn: paid > 0 ? l.paidOn : null } });
      }
    }
    if (!await db.bankTransactionMatch.count({ where: { bankTransactionId: req.params.id } })) await db.bankTransaction.update({ where: { id: req.params.id }, data: { matchConfidence: null, matchedAt: null } });
    return found;
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  await refreshAllocationDocument(m.ledgerEntryId, m.documentId);
  res.json({ ok: true });
}));

/** Renomme en masse le libellé « banque/carte » (ex. faute de frappe au moment de l'import). */
financeRouter.post(
  '/bank/rename',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const from = String(req.body?.from ?? '').trim();
    const to = String(req.body?.to ?? '').trim();
    if (!from || !to) throw new HttpError(422, 'Ancien et nouveau libellé requis.');
    const { count } = await prisma.bankTransaction.updateMany({ where: { bank: from }, data: { bank: to } });
    res.json({ renamed: count });
  }),
);

/** Rapprochement automatique de toutes les transactions non liées. */
financeRouter.post(
  '/bank/auto-match',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json(await autoMatchAll());
  }),
);

/**
 * Import d'un relevé que le flux Ponto ne remonte pas :
 *  - CSV (extraits banque, cartes exportables)
 *  - PDF « État des dépenses » de carte (Belfius / Atos Worldline)
 * Champ multipart « file », option « bank » (libellé).
 */
financeRouter.post(
  '/bank/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const bankLabel = String(req.body?.bank ?? '').trim();
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.buffer.subarray(0, 5).toString() === '%PDF-';

    if (isPdf) {
      if (!(await pdftotextAvailable())) {
        throw new HttpError(503, 'Lecture PDF indisponible sur ce serveur (poppler-utils non installé).');
      }
      const text = await pdfToRawText(req.file.buffer);
      const st = parseCardStatement(text);
      if (st.rows.length === 0) throw new HttpError(422, 'Aucune transaction trouvée dans ce PDF (format de relevé non reconnu).');
      const { imported, duplicates } = await insertBankRows(st.rows, bankLabel || `Carte ${st.cardRef ?? ''}`.trim(), 'pdf');
      const match = await autoMatchAll();
      return res.json({ imported, duplicates, kind: 'pdf', cardRef: st.cardRef, period: st.period, total: st.total, match });
    }

    const parsed = parseBankCsv(decodeCsvBuffer(req.file.buffer));
    if (parsed.rows.length === 0) {
      throw new HttpError(422,
        `Aucune ligne exploitable. Colonnes détectées : ${parsed.headers.join(', ') || '—'}. `
        + `Champs reconnus : ${parsed.mapped.join(', ') || 'aucun'} (il faut au minimum une date et un montant).`);
    }
    const { imported, duplicates } = await insertBankRows(parsed.rows, bankLabel || 'CSV', 'csv');
    const match = await autoMatchAll();
    res.json({ imported, duplicates, kind: 'csv', skipped: parsed.skipped, mapped: parsed.mapped, headers: parsed.headers, match });
  }),
);

/**
 * Import à partir d'une ou plusieurs captures d'écran de l'appli d'une carte prépayée (JPEG/PNG)
 * — pour rapprocher les dépenses bien avant l'arrivée du relevé PDF officiel du mois. Lecture par
 * IA (vision Claude) : nécessite une clé Anthropic configurée côté serveur (voir env.ts).
 * Champ multipart « files » (jusqu'à 10), option « bank » (libellé).
 */
financeRouter.post(
  '/bank/import-screenshot',
  requireAuth(...OFFICE),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    if (!screenshotImportAvailable()) throw new HttpError(503, 'Lecture par IA non configurée (clé Anthropic absente côté serveur).');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new HttpError(422, 'Aucune image');
    const bankLabel = String(req.body?.bank ?? '').trim() || 'Carte (capture)';
    const rows = await parseScreenshots(files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype })));
    if (!rows.length) throw new HttpError(422, 'Aucune transaction lisible sur ces captures.');
    const { imported, duplicates } = await insertBankRows(rows, bankLabel, 'screenshot');
    const match = await autoMatchAll();
    res.json({ imported, duplicates, kind: 'screenshot', match });
  }),
);

/**
 * Rapprochement grand livre <-> devis/factures/NC de vente émis dans l'appli : liste les
 * documents émis qui n'ont pas (encore) d'écriture synchronisée (voir syncLedgerEntryForDocument),
 * en distinguant deux cas — une écriture existante partage déjà le même numéro (import Excel ou
 * rattrapage manuel antérieur : à lier plutôt qu'à dupliquer), ou rien du tout (vrai trou : une
 * écriture neuve peut être créée sans risque de doublon).
 */
/**
 * Factures de vente HISTORIQUES : écritures du grand livre (import Excel) qui n'ont pas de document dans l'appli. On les liste (recherche
 * par n° / client / chantier) pour pouvoir en tirer un document, puis une note de crédit (POST /api/documents/from-ledger/:id).
 */
financeRouter.get(
  '/ledger-sync/historical',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const q = String((req.query as Record<string, string>).q ?? '').trim();
    const where: Prisma.LedgerEntryWhereInput = { direction: 'sale', documentId: null, docNumber: { not: null } };
    if (q) where.OR = [{ docNumber: { contains: q, ...insensitive } }, { supplierName: { contains: q, ...insensitive } }, { worksiteRef: { contains: q, ...insensitive } }];
    const [items, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where, orderBy: [{ date: 'desc' }, { docNumber: 'desc' }], take: 60,
        select: { id: true, docNumber: true, date: true, ht: true, ttc: true, paymentStatus: true, supplierName: true, worksiteRef: true, worksite: { select: { ref: true } } },
      }),
      prisma.ledgerEntry.count({ where }),
    ]);
    res.json({ items: items.map(({ worksite, ...e }) => ({ ...e, worksiteRef: worksite?.ref ?? e.worksiteRef })), total });
  }),
);

financeRouter.get(
  '/ledger-sync/gaps',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const docs = await prisma.document.findMany({
      where: {
        kind: { in: ['invoice', 'deposit_invoice', 'credit_note'] },
        lockedAt: { not: null },
        source: { not: 'demo' },
        ledgerEntry: null,
      },
      select: {
        id: true, kind: true, number: true, issuedOn: true, totalTtc: true, status: true,
        worksite: { select: { ref: true } },
        contact: { select: { name: true } },
      },
      orderBy: { issuedOn: 'asc' },
    });
    const numbers = docs.map((d) => d.number).filter((n): n is string => !!n);
    const candidates = numbers.length
      ? await prisma.ledgerEntry.findMany({
          where: { docNumber: { in: numbers }, documentId: null, direction: { in: ['sale', 'credit_note'] } },
          select: { id: true, docNumber: true, date: true, ht: true, ttc: true, paymentStatus: true, source: true },
        })
      : [];
    const byNumber = new Map(candidates.map((c) => [c.docNumber, c]));
    const items = docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      number: d.number,
      issuedOn: d.issuedOn,
      totalTtc: d.totalTtc,
      status: d.status,
      worksiteRef: d.worksite?.ref ?? null,
      contactName: d.contact?.name ?? null,
      match: (d.number && byNumber.get(d.number)) || null,
    }));
    res.json({
      items,
      missingCount: items.filter((i) => !i.match).length,
      matchableCount: items.filter((i) => i.match).length,
    });
  }),
);

/** Crée l'écriture manquante (pas de doublon possible : upsert par documentId). */
financeRouter.post(
  '/ledger-sync/gaps/:id/create',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await syncLedgerEntryForDocument(req.params.id as string);
    res.json({ ok: true });
  }),
);

/** Lie le document à une écriture existante (import Excel / rattrapage manuel) au lieu d'en créer une neuve. */
financeRouter.post(
  '/ledger-sync/gaps/:id/link',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { ledgerEntryId } = req.body as { ledgerEntryId?: string };
    if (!ledgerEntryId) throw new HttpError(422, 'ledgerEntryId requis');
    const entry = await prisma.ledgerEntry.findUnique({ where: { id: ledgerEntryId } });
    if (!entry) throw new HttpError(404, 'Écriture introuvable');
    if (entry.documentId) throw new HttpError(409, 'Écriture déjà liée à un autre document');
    await prisma.ledgerEntry.update({ where: { id: ledgerEntryId }, data: { documentId: req.params.id } });
    res.json({ ok: true });
  }),
);
