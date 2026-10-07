import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { latestSignatureForDocument, revokeSignature, publicSignatureView, publicSignaturePdf, signQuote, declineQuote } from '../lib/quote-sign.js';

/** Côté bureau : état de la signature d'un devis, annulation d'un lien en attente. */
export const quoteSignRouter = Router();

quoteSignRouter.get('/document/:documentId', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  res.json({ signature: await latestSignatureForDocument(req.params.documentId!) });
}));

quoteSignRouter.post('/:id/revoke', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const r = await prisma.quoteSignature.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, 'Demande de signature introuvable');
  await revokeSignature(r.id);
  res.json({ signature: await latestSignatureForDocument(r.documentId) });
}));

/** Côté client : page publique, sans compte, jeton secret dans le lien. */
export const publicSignRouter = Router();

const hits = new Map<string, number[]>();
const throttled = (ip: string) => { const now = Date.now(); const w = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000); w.push(now); hits.set(ip, w); return w.length > 60; };
// derrière nginx : le DERNIER élément de X-Forwarded-For est l'adresse vue par le proxy (le client ne peut pas le falsifier)
const clientIp = (req: { headers: Record<string, unknown>; ip?: string }) => String(req.headers['x-forwarded-for'] ?? req.ip ?? 'inconnue').split(',').pop()!.trim();
const evidence = (req: { headers: Record<string, unknown>; ip?: string }) => ({ ip: clientIp(req), agent: String(req.headers['user-agent'] ?? '') });
const guard = (req: { headers: Record<string, unknown>; ip?: string }) => { if (throttled(clientIp(req))) throw new HttpError(429, 'Trop de requêtes, réessayez dans quelques minutes.'); };

publicSignRouter.get('/:token', asyncHandler(async (req, res) => { guard(req); res.json(await publicSignatureView(req.params.token!)); }));

publicSignRouter.get('/:token/pdf', asyncHandler(async (req, res) => {
  guard(req);
  const { buffer, filename } = await publicSignaturePdf(req.params.token!);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}));

publicSignRouter.post('/:token/sign', asyncHandler(async (req, res) => {
  guard(req);
  const body = z.object({ name: z.string().min(1).max(200), accepted: z.boolean() }).strict().parse(req.body);
  res.json(await signQuote(req.params.token!, body, evidence(req)));
}));

publicSignRouter.post('/:token/decline', asyncHandler(async (req, res) => {
  guard(req);
  const body = z.object({ comment: z.string().trim().max(1000).default('') }).strict().parse(req.body ?? {});
  res.json(await declineQuote(req.params.token!, body.comment, evidence(req)));
}));
