import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requirePartner, OFFICE } from '../lib/auth.js';
import { consolidatedPnl, profitShare } from '../lib/consolidated.js';

export const financeRouter = Router();

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
      prisma.bankTransaction.findMany({ where, orderBy: { bookingDate: 'desc' }, take: 300 }),
      prisma.bankTransaction.groupBy({
        by: ['bank'],
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    const total = await prisma.bankTransaction.count();
    const done = await prisma.bankTransaction.count({ where: { matchedLedgerId: { not: null } } });
    res.json({ items, byBank: stats, matched: done, total });
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
    const items = await prisma.ledgerEntry.findMany({
      where: {
        ttc: { gte: amount - 1, lte: amount + 1 },
        ...(tx.bookingDate
          ? { date: { gte: new Date(tx.bookingDate.getTime() - 20 * 86400000), lte: new Date(tx.bookingDate.getTime() + 20 * 86400000) } }
          : {}),
      },
      take: 12,
      include: { worksite: { select: { ref: true, title: true } } },
      orderBy: { date: 'desc' },
    });
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
      data: { matchedLedgerId: ledgerId },
    });
    res.json({ transaction: tx });
  }),
);
