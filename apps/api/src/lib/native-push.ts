import { prisma } from '../db.js';
import { STAFF } from './auth.js';

export const isExpoToken = (s: unknown): s is string => typeof s === 'string' && /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(s) && s.length < 256;

/** Generic lock-screen content: no client, worksite address or message text. */
export async function notifyMobile(userIds: string[], route: string, title: string): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(userIds)] }, user: { active: true } } });
  const mobile = subs.filter(s => isExpoToken(s.endpoint));
  for (let offset = 0; offset < mobile.length; offset += 100) {
    const batch = mobile.slice(offset, offset + 100);
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(batch.map(s => ({ to: s.endpoint, title, body: 'Ouvrez JJD Chantier pour consulter les nouveautés.', sound: 'default', channelId: 'jjd', data: { route, userId: s.userId } }))),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) { console.warn('[mobile-push] delivery request failed', response.status); continue; }
      const result = await response.json() as { data?: { status: string; details?: { error?: string } }[] };
      for (const [i, ticket] of (result.data ?? []).entries()) {
        if (ticket.details?.error === 'DeviceNotRegistered' && batch[i]) await prisma.pushSubscription.deleteMany({ where: { id: batch[i]!.id, endpoint: batch[i]!.endpoint } });
        else if (ticket.status === 'error') console.warn('[mobile-push] ticket error', ticket.details?.error ?? 'unknown');
      }
    } catch { console.warn('[mobile-push] service unavailable'); }
  }
}

export async function notifyMessage(authorId: string, worksiteId?: string): Promise<void> {
  const users = await prisma.user.findMany({ where: {
    active: true, id: { not: authorId }, role: { in: STAFF },
    ...(worksiteId ? { AND: [
      { OR: [{ role: { in: ['admin', 'office'] } }, { person: { timeEntries: { some: { worksiteId } } } }, { person: { eventAssignments: { some: { event: { worksiteId } } } } }] },
      // A scoped user must not learn about another entity's activity.
      { OR: [{ entityScope: null }, { entityScope: (await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { entity: true } }))?.entity ?? '__none__' }] },
    ] } : {}),
  }, select: { id: true } });
  await notifyMobile(users.map(u => u.id), worksiteId ? `/fil/${worksiteId}` : '/fil-general', 'Nouveau message JJD');
}

export async function notifyPlanning(eventId: string, authorId: string): Promise<void> {
  const event = await prisma.planningEvent.findUnique({ where: { id: eventId }, include: { assignments: true } });
  if (!event) return;
  const ids = [...event.assignments.map(a => a.personId), event.leadPersonId, event.driverPersonId].filter((x): x is string => !!x);
  const users = await prisma.user.findMany({ where: { active: true, id: { not: authorId }, role: { in: STAFF }, personId: { in: ids } }, select: { id: true } });
  await notifyMobile(users.map(u => u.id), '/planning', 'Votre planning a été mis à jour');
}
