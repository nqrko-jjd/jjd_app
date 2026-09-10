import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requirePartner, OFFICE } from '../lib/auth.js';
import { consolidatedPnl, profitShare } from '../lib/consolidated.js';
import { analytics } from '../lib/analytics.js';
import { autoMatchAll } from '../lib/bank-match.js';
import { parseBankCsv, decodeCsvBuffer, type ParsedBankRow } from '../lib/bank-csv.js';
import { parseCardStatement, pdfToRawText, pdftotextAvailable } from '../lib/bank-pdf.js';

export const financeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

/* ------------------------------------------------------- rapprochement bancaire */

financeRouter.get(
  '/bank',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { matched, q, from, bank } = req.query as Record<string, string>;
    const and: Record<string, unknown>[] = [];
    if (matched === '1') and.push({ OR: [{ matchedLedgerId: { not: null } }, { matchedDocumentId: { not: null } }] });
    if (matched === '0') and.push({ matchedLedgerId: null }, { matchedDocumentId: null });
    if (from) and.push({ bookingDate: { gte: new Date(from) } });
    if (bank) and.push({ bank });
    if (q) and.push({ OR: [{ counterpartyName: { contains: q } }, { description: { contains: q } }, { communication: { contains: q } }] });
    const where: Record<string, unknown> = and.length ? { AND: and } : {};

    const [items, stats] = await Promise.all([
      prisma.bankTransaction.findMany({
        where, orderBy: { bookingDate: 'desc' }, take: 300,
        include: { account: { select: { label: true, iban: true } } },
      }),
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
    const amount = Math.abs(tx.amount ?? 0);
    const window = tx.bookingDate
      ? { date: { gte: new Date(tx.bookingDate.getTime() - 20 * 86400000), lte: new Date(tx.bookingDate.getTime() + 20 * 86400000) } }
      : {};
    const inc = { worksite: { select: { ref: true, title: true } } };

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
