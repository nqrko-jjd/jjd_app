import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { env } from '../env.js';
import {
  pontoConfigured, buildAuthUrl, handleCallback, refreshAccounts,
  fetchAccountTransactions, pontoDisconnect,
} from '../lib/ponto.js';
import { autoMatchAll } from '../lib/bank-match.js';

export const pontoRouter = Router();

pontoRouter.get(
  '/status',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const configured = pontoConfigured();
    const tokens = configured ? await prisma.setting.findUnique({ where: { key: 'ponto:tokens' } }) : null;
    const accounts = await prisma.bankAccount.findMany({ orderBy: { label: 'asc' } });
    res.json({
      configured,
      connected: !!tokens,
      redirectUri: env.ponto.redirectUri,
      accounts: accounts.map((a) => ({
        id: a.id, iban: a.iban, label: a.label, balance: a.balance,
        balanceAt: a.balanceAt, lastSyncAt: a.lastSyncAt,
      })),
    });
  }),
);

/** URL de consentement Ponto (l'utilisateur choisit sa banque et autorise l'accès). */
pontoRouter.get(
  '/connect',
  requireAuth('admin'),
  asyncHandler(async (_req, res) => {
    res.json({ url: await buildAuthUrl() });
  }),
);

/** Redirection retour de Ponto après consentement. */
pontoRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    const back = `${env.webUrl}/app/finances/banque`;
    if (error) return res.redirect(`${back}?ponto=error`);
    if (!code || !state) return res.redirect(`${back}?ponto=missing`);
    try {
      await handleCallback(code, state);
      await refreshAccounts();
      res.redirect(`${back}?ponto=connected`);
    } catch (e) {
      res.redirect(`${back}?ponto=error&msg=${encodeURIComponent((e as Error).message)}`);
    }
  }),
);

/** Synchronise les comptes : tire les nouvelles transactions puis rapproche. */
pontoRouter.post(
  '/sync',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!pontoConfigured()) throw new HttpError(400, 'Ponto non configuré');
    await refreshAccounts();
    const accounts = await prisma.bankAccount.findMany({ where: { externalId: { not: null } } });
    let imported = 0;
    for (const acc of accounts) {
      const txs = await fetchAccountTransactions({ id: acc.id, externalId: acc.externalId!, syncCursor: acc.syncCursor });
      for (const t of txs) {
        const created = await prisma.bankTransaction.upsert({
          where: { externalId: t.externalId },
          create: {
            externalId: t.externalId, accountId: acc.id, bookingDate: t.bookingDate, valueDate: t.valueDate,
            bank: acc.label, amount: t.amount, currency: t.currency, counterpartyName: t.counterpartyName,
            counterpartyAccount: t.counterpartyAccount, description: t.description, communication: t.communication,
            structuredComm: t.structuredComm, side: t.side, source: 'ponto',
          },
          update: {
            amount: t.amount, counterpartyName: t.counterpartyName, description: t.description,
            communication: t.communication, structuredComm: t.structuredComm, side: t.side,
          },
        });
        if (created.createdAt.getTime() > Date.now() - 5000) imported++;
      }
    }
    const match = await autoMatchAll();
    res.json({ accounts: accounts.length, imported, match });
  }),
);

pontoRouter.post(
  '/disconnect',
  requireAuth('admin'),
  asyncHandler(async (_req, res) => {
    await pontoDisconnect();
    res.json({ ok: true });
  }),
);
