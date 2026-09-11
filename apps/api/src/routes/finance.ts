import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requirePartner, OFFICE } from '../lib/auth.js';
import { consolidatedPnl, profitShare } from '../lib/consolidated.js';
import { analytics } from '../lib/analytics.js';
import { autoMatchAll } from '../lib/bank-match.js';
import { parseBankCsv, decodeCsvBuffer, type ParsedBankRow } from '../lib/bank-csv.js';
import { parseCardStatement, pdfToRawText, pdftotextAvailable } from '../lib/bank-pdf.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';
import { parseAmount, parseLooseDate } from '@jjd/shared';

export const financeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function derive(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

/** Insère des lignes de relevé (dédoublonnage par externalId + inter-sources). */
async function insertBankRows(rows: ParsedBankRow[], bankLabel: string, source: string) {
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  let imported = 0;
  let duplicates = 0;
  for (const r of rows) {
    if (await prisma.bankTransaction.findUnique({ where: { externalId: r.externalId } })) { duplicates++; continue; }
    if (r.bookingDate && r.amount != null) {
      const sameDay = new Date(r.bookingDate); sameDay.setUTCHours(0, 0, 0, 0);
      const next = new Date(sameDay); next.setUTCDate(next.getUTCDate() + 1);
      const near = await prisma.bankTransaction.findMany({
        where: { amount: r.amount, bookingDate: { gte: new Date(sameDay.getTime() - 3 * 86400000), lt: next } },
        select: { counterpartyName: true },
      });
      if (near.some((n) => !r.counterpartyName || !n.counterpartyName
        || norm(n.counterpartyName) === norm(r.counterpartyName)
        || norm(n.counterpartyName).includes(norm(r.counterpartyName).slice(0, 6)))) {
        duplicates++; continue;
      }
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
    const { matched, q, from, bank, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const and: Record<string, unknown>[] = [];
    if (matched === '1') and.push({ OR: [{ matchedLedgerId: { not: null } }, { matchedDocumentId: { not: null } }] });
    if (matched === '0') and.push({ matchedLedgerId: null }, { matchedDocumentId: null });
    if (from) and.push({ bookingDate: { gte: new Date(from) } });
    if (bank) and.push({ bank });
    if (q) and.push({ OR: [{ counterpartyName: { contains: q } }, { description: { contains: q } }, { communication: { contains: q } }] });
    const where: Record<string, unknown> = and.length ? { AND: and } : {};

    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));

    const [items, filteredCount, stats] = await Promise.all([
      prisma.bankTransaction.findMany({
        where, orderBy: { bookingDate: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
        include: { account: { select: { label: true, iban: true } } },
      }),
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.groupBy({
        by: ['bank'],
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    // libellé de la facture rapprochée (pour l'affichage)
    const ledgerIds = items.map((t) => t.matchedLedgerId).filter((x): x is string => !!x);
    const docIds = items.map((t) => t.matchedDocumentId).filter((x): x is string => !!x);
    const [ledgers, docs] = await Promise.all([
      ledgerIds.length
        ? prisma.ledgerEntry.findMany({
            where: { id: { in: ledgerIds } },
            select: { id: true, docNumber: true, supplierName: true, direction: true, ttc: true, worksite: { select: { ref: true } } },
          })
        : [],
      docIds.length
        ? prisma.document.findMany({
            where: { id: { in: docIds } },
            select: { id: true, number: true, kind: true, totalTtc: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
          })
        : [],
    ]);
    const ledgerMap = new Map(ledgers.map((l) => [l.id, l]));
    const docMap = new Map(docs.map((d) => [d.id, d]));
    const total = await prisma.bankTransaction.count();
    const done = await prisma.bankTransaction.count({ where: { OR: [{ matchedLedgerId: { not: null } }, { matchedDocumentId: { not: null } }] } });
    res.json({
      items: items.map((t) => ({
        ...t,
        matchedLedger: t.matchedLedgerId ? ledgerMap.get(t.matchedLedgerId) ?? null : null,
        matchedDocument: t.matchedDocumentId ? docMap.get(t.matchedDocumentId) ?? null : null,
      })),
      byBank: stats, matched: done, total,
      page, pageSize, totalCount: filteredCount, totalPages: Math.max(1, Math.ceil(filteredCount / pageSize)),
    });
  }),
);

/** Suggère des écritures du grand livre à rapprocher d'une transaction. */
financeRouter.get(
  '/bank/:id/suggestions',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const tx = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');
    const inc = { worksite: { select: { ref: true, title: true } } };

    // recherche manuelle : l'utilisateur cherche lui-même (n° facture, fournisseur, chantier…)
    // au lieu de se limiter aux propositions automatiques (montant/date proches) — utile
    // quand il n'y a aucune proposition ou que la bonne facture n'y figure pas
    const q = (req.query.q as string | undefined)?.trim();
    if (q) {
      const [ledgers, docs] = await Promise.all([
        prisma.ledgerEntry.findMany({
          where: {
            OR: [
              { docNumber: { contains: q } },
              { supplierName: { contains: q } },
              { worksite: { ref: { contains: q } } },
              { worksite: { title: { contains: q } } },
              { contact: { name: { contains: q } } },
            ],
          },
          take: 20, include: inc, orderBy: { date: 'desc' },
        }),
        prisma.document.findMany({
          where: {
            OR: [
              { number: { contains: q } },
              { contact: { name: { contains: q } } },
              { worksite: { ref: { contains: q } } },
              { worksite: { title: { contains: q } } },
            ],
          },
          take: 15, orderBy: { issuedOn: 'desc' },
          select: { id: true, number: true, kind: true, totalTtc: true, issuedOn: true, status: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
        }),
      ]);
      return res.json({
        items: [
          ...ledgers.map((l) => ({
            kind: 'ledger' as const,
            id: l.id,
            label: [l.docNumber, l.supplierName].filter(Boolean).join(' · ') || (l.direction === 'sale' ? 'Vente' : 'Achat'),
            amount: l.ttc ?? l.ht,
            date: l.date,
            direction: l.direction,
            worksiteRef: l.worksite?.ref ?? l.worksiteRef ?? null,
          })),
          ...docs.map((d) => ({
            kind: 'document' as const,
            id: d.id,
            label: [d.number, d.contact?.name].filter(Boolean).join(' · ') || 'Facture de vente',
            amount: d.totalTtc,
            date: d.issuedOn,
            direction: 'sale' as const,
            worksiteRef: d.worksite?.ref ?? null,
            status: d.status,
          })),
        ],
      });
    }

    const amount = Math.abs(tx.amount ?? 0);
    const window = tx.bookingDate
      ? { date: { gte: new Date(tx.bookingDate.getTime() - 20 * 86400000), lte: new Date(tx.bookingDate.getTime() + 20 * 86400000) } }
      : {};

    const byComm = tx.structuredComm && tx.structuredComm.length >= 10
      ? await prisma.ledgerEntry.findMany({ where: { bankComm: { contains: tx.structuredComm.slice(0, 12) } }, take: 5, include: inc })
      : [];
    const byAmount = await prisma.ledgerEntry.findMany({
      where: { ttc: { gte: amount - 1, lte: amount + 1 }, ...window },
      take: 12, include: inc, orderBy: { date: 'desc' },
    });
    const seen = new Set<string>();
    const ledgerItems = [...byComm, ...byAmount]
      .filter((l) => (seen.has(l.id) ? false : seen.add(l.id)))
      .map((l) => ({
        kind: 'ledger' as const,
        id: l.id,
        label: [l.docNumber, l.supplierName].filter(Boolean).join(' · ') || (l.direction === 'sale' ? 'Vente' : 'Achat'),
        amount: l.ttc ?? l.ht,
        date: l.date,
        direction: l.direction,
        worksiteRef: l.worksite?.ref ?? l.worksiteRef ?? null,
      }));

    // factures de vente créées dans l'app (Document) — mêmes critères
    const docWindow = tx.bookingDate
      ? { issuedOn: { gte: new Date(tx.bookingDate.getTime() - 25 * 86400000), lte: new Date(tx.bookingDate.getTime() + 25 * 86400000) } }
      : {};
    const docs = await prisma.document.findMany({
      where: {
        kind: { in: ['invoice', 'deposit_invoice', 'credit_note'] },
        totalTtc: { gte: amount - 1, lte: amount + 1 },
        ...docWindow,
      },
      take: 8,
      orderBy: { issuedOn: 'desc' },
      select: { id: true, number: true, kind: true, totalTtc: true, issuedOn: true, status: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
    });
    const docItems = docs.map((d) => ({
      kind: 'document' as const,
      id: d.id,
      label: [d.number, d.contact?.name].filter(Boolean).join(' · ') || 'Facture de vente',
      amount: d.totalTtc,
      date: d.issuedOn,
      direction: 'sale' as const,
      worksiteRef: d.worksite?.ref ?? null,
      status: d.status,
    }));

    res.json({ items: [...ledgerItems, ...docItems] });
  }),
);

/**
 * Rapproche une transaction bancaire d'une facture d'achat (grand livre) OU
 * d'une facture de vente (Document). Lier => la facture passe « payé » ;
 * délier => elle repasse « non payé ».
 */
financeRouter.post(
  '/bank/:id/match',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ledgerId: string | null = req.body.ledgerId ?? null;
    const documentId: string | null = req.body.documentId ?? null;
    const current = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, 'Transaction introuvable');

    // 1. défaire l'ancien rapprochement (repasse la cible en non payé)
    if (current.matchedLedgerId && current.matchedLedgerId !== ledgerId) {
      await prisma.ledgerEntry.update({
        where: { id: current.matchedLedgerId },
        data: { paymentStatus: 'Non payé', paidOn: null },
      }).catch(() => {});
    }
    if (current.matchedDocumentId && current.matchedDocumentId !== documentId) {
      await prisma.document.update({
        where: { id: current.matchedDocumentId },
        data: { status: 'sent', paidAmount: 0, paidOn: null },
      }).catch(() => {});
    }

    // 2. appliquer le nouveau
    if (ledgerId) {
      await prisma.ledgerEntry.update({
        where: { id: ledgerId },
        data: { paymentStatus: 'Payé', paidOn: current.bookingDate ?? new Date() },
      });
    }
    if (documentId) {
      const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { totalTtc: true } });
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'paid',
          paidAmount: doc?.totalTtc ?? 0,
          paidOn: current.bookingDate ?? new Date(),
        },
      });
    }

    const tx = await prisma.bankTransaction.update({
      where: { id: req.params.id },
      data: {
        matchedLedgerId: ledgerId,
        matchedDocumentId: documentId,
        matchConfidence: ledgerId || documentId ? 'manual' : null,
        matchedAt: ledgerId || documentId ? new Date() : null,
      },
    });
    res.json({ transaction: tx });
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
