import { Router } from 'express';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF } from '../lib/auth.js';
import { pushConfigured } from '../lib/push.js';
import { mentionCandidates } from '../lib/mentions.js';

export const pushRouter = Router();

/** Clé publique VAPID + si la fonctionnalité est activée côté serveur (clés configurées) —
 *  le bouton "Activer les notifications" reste masqué sinon, plutôt que d'échouer en silence. */
pushRouter.get(
  '/public-key',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    res.json({ configured: pushConfigured, publicKey: pushConfigured ? env.webPush.publicKey : null });
  }),
);

/** Enregistre un abonnement Web Push pour cet appareil/navigateur (upsert par endpoint —
 *  un même navigateur qui se réabonne écrase son ancien enregistrement). */
pushRouter.post(
  '/subscribe',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) throw new HttpError(422, 'Abonnement incomplet');
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id },
      update: { p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id },
    });
    res.status(201).json({ ok: true });
  }),
);

pushRouter.post(
  '/unsubscribe',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const endpoint = String(req.body?.endpoint ?? '');
    if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
    res.json({ ok: true });
  }),
);

/** Coéquipiers "mentionnables" avec un @ — alimente le sélecteur du composer. */
pushRouter.get(
  '/mentionable',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    res.json({ items: await mentionCandidates() });
  }),
);
