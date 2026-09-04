import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requirePartner, OFFICE } from '../lib/auth.js';
import { consolidatedPnl, profitShare } from '../lib/consolidated.js';
import { analytics } from '../lib/analytics.js';
import { autoMatchAll } from '../lib/bank-match.js';
import { parseBankCsv, type ParsedBankRow } from '../lib/bank-csv.js';
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
    const { matched, q, from } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (matched === '1') where.matchedLedgerId = { not: null };
    if (matched === '0') where.matchedLedgerId = null;
    if (from) where.bookingDate = { gte: new Date(from) };
    if (q) where.OR = [{ counterpartyName: { contains: q } }, { description: { contains: q } }, { communication: { contains: q } }];

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
    // libellé de l'écriture rapprochée (pour l'affichage)
    const ledgerIds = items.map((t) => t.matchedLedgerId).filter((x): x is string => !!x);
    const ledgers = ledgerIds.length
      ? await prisma.ledgerEntry.findMany({
          where: { id: { in: ledgerIds } },
          select: { id: true, docNumber: true, supplierName: true, direction: true, ttc: true, worksite: { select: { ref: true } } },
        })
      : [];
    const ledgerMap = new Map(ledgers.map((l) => [l.id, l]));
    const total = await prisma.bankTransaction.count();
    const done = await prisma.bankTransaction.count({ where: { matchedLedgerId: { not: null } } });
    res.json({
      items: items.map((t) => ({ ...t, matchedLedger: t.matchedLedgerId ? ledgerMap.get(t.matchedLedgerId) ?? null : null })),
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
    const items = [...byComm, ...byAmount].filter((l) => (seen.has(l.id) ? false : seen.add(l.id)));
    res.json({ items });
  }),
);

financeRouter.post(
  '/bank/:id/match',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ledgerId: string | null = req.body.ledgerId ?? null;
    const tx = await prisma.bankTransaction.update({
      where: { id: req.params.id },
      data: {
        matchedLedgerId: ledgerId,
        matchConfidence: ledgerId ? 'manual' : null,
        matchedAt: ledgerId ? new Date() : null,
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

    const parsed = parseBankCsv(req.file.buffer.toString('utf8'));
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
