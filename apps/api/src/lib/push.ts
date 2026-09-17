import webpush from 'web-push';
import { prisma } from '../db.js';
import { env } from '../env.js';

export const pushConfigured = !!(env.webPush.publicKey && env.webPush.privateKey);
if (pushConfigured) {
  webpush.setVapidDetails(env.webPush.subject, env.webPush.publicKey, env.webPush.privateKey);
}

/** Envoie une notification push à un utilisateur, sur tous ses appareils abonnés —
 *  best-effort : ne doit jamais faire échouer l'action (création de message) qui l'a
 *  déclenchée. Désabonne automatiquement un appareil dont l'abonnement n'est plus valide. */
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }): Promise<void> {
  if (!pushConfigured) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }));
}
