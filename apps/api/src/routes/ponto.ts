import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { env } from '../env.js';
import {
  pontoConfigured, pontoMode, buildAuthUrl, handleCallback, refreshAccounts, pontoDisconnect,
} from '../lib/ponto.js';
import { syncPonto } from '../lib/ponto-sync.js';

export const pontoRouter = Router();

pontoRouter.get(
  '/status',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const configured = pontoConfigured();
    const mode = pontoMode();
    // intégration personnalisée : pas de consentement à donner, les comptes sont ceux liés dans le tableau de bord Ponto
    const tokens = configured && mode === 'connect' ? await prisma.setting.findUnique({ where: { key: 'ponto:tokens' } }) : null;
    const accounts = await prisma.bankAccount.findMany({ orderBy: { label: 'asc' } });
    res.json({
      configured,
      mode,
      connected: configured && (mode === 'custom' || !!tokens),
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
    res.json(await syncPonto());
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
