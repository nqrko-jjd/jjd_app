import { prisma } from '../db.js';
import { STAFF } from './auth.js';

export type NotifType = 'messages' | 'planning' | 'departure' | 'peppol';
export const NOTIF_TYPES: NotifType[] = ['messages', 'planning', 'departure', 'peppol'];
const prefKey = (userId: string) => `notifPrefs:${userId}`;
/** Préférences de notification d'un utilisateur : tout est activé tant qu'il n'a rien désactivé. */
export async function getNotifPrefs(userId: string): Promise<Record<NotifType, boolean>> {
  const row = await prisma.setting.findUnique({ where: { key: prefKey(userId) } }).catch(() => null);
  const v = (row?.value ?? {}) as Partial<Record<NotifType, boolean>>;
  return { messages: v.messages !== false, planning: v.planning !== false, departure: v.departure !== false, peppol: v.peppol !== false };
}
export async function setNotifPrefs(userId: string, input: Partial<Record<NotifType, unknown>>): Promise<Record<NotifType, boolean>> {
  const next = { ...(await getNotifPrefs(userId)) };
  for (const t of NOTIF_TYPES) if (typeof input[t] === 'boolean') next[t] = input[t] as boolean;
  await prisma.setting.upsert({ where: { key: prefKey(userId) }, create: { key: prefKey(userId), value: next }, update: { value: next } });
  return next;
}
async function allowed(userIds: string[], type?: NotifType): Promise<string[]> {
  if (!type) return userIds;
  const ids = [...new Set(userIds)];
  const rows = await prisma.setting.findMany({ where: { key: { in: ids.map(prefKey) } } });
  const off = new Set(rows.filter((r) => (r.value as Partial<Record<NotifType, boolean>> | null)?.[type] === false).map((r) => r.key.slice('notifPrefs:'.length)));
  return ids.filter((id) => !off.has(id));
}

export const isExpoToken = (s: unknown): s is string => typeof s === 'string' && /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(s) && s.length < 256;

/** Contenu de l'alerte : par défaut générique ; les appelants peuvent y mettre chantier, auteur ou fournisseur (appareils du personnel uniquement). */
export async function notifyMobile(userIds: string[], route: string, title: string, body: string | undefined = 'Ouvrez JJD Chantier pour consulter les nouveautés.', type?: NotifType): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: await allowed(userIds, type) }, user: { active: true } } });
  const mobile = subs.filter(s => isExpoToken(s.endpoint));
  for (let offset = 0; offset < mobile.length; offset += 100) {
    const batch = mobile.slice(offset, offset + 100);
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(batch.map(s => ({ to: s.endpoint, title, body, sound: 'default', channelId: 'jjd', data: { route, userId: s.userId } }))),
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

export async function notifyMessage(authorId: string, worksiteId?: string, preview?: { kind?: string; body?: string | null }): Promise<void> {
  const users = await prisma.user.findMany({ where: {
    active: true, id: { not: authorId }, role: { in: STAFF },
    ...(worksiteId ? { AND: [
      { OR: [{ role: { in: ['admin', 'office'] } }, { person: { timeEntries: { some: { worksiteId } } } }, { person: { eventAssignments: { some: { event: { worksiteId } } } } }] },
      // A scoped user must not learn about another entity's activity.
      { OR: [{ entityScope: null }, { entityScope: (await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { entity: true } }))?.entity ?? '__none__' }] },
    ] } : {}),
  }, select: { id: true } });
  const [author, site] = await Promise.all([
    prisma.user.findUnique({ where: { id: authorId }, select: { email: true, person: { select: { displayName: true, firstName: true } } } }).catch(() => null),
    worksiteId ? prisma.worksite.findUnique({ where: { id: worksiteId }, select: { ref: true, title: true } }).catch(() => null) : null,
  ]);
  const who = (author?.person?.displayName || author?.person?.firstName || '').trim();
  const where = site ? `${site.ref}${site.title ? ` · ${site.title}` : ''}` : 'Messagerie générale';
  const what = preview?.kind === 'audio' ? '🎤 Message vocal' : preview?.kind === 'photo' && !preview.body ? '📷 Photo' : (preview?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const title = who ? `${who} · ${where}` : where;
  await notifyMobile(users.map(u => u.id), worksiteId ? `/fil/${worksiteId}` : '/fil-general', title, what || undefined, 'messages');
}

export async function notifyPlanning(eventId: string, authorId: string): Promise<void> {
  const event = await prisma.planningEvent.findUnique({ where: { id: eventId }, include: { assignments: true } });
  if (!event) return;
  const ids = [...event.assignments.map(a => a.personId), event.leadPersonId, event.driverPersonId].filter((x): x is string => !!x);
  const users = await prisma.user.findMany({ where: { active: true, id: { not: authorId }, role: { in: STAFF }, personId: { in: ids } }, select: { id: true } });
  await notifyMobile(users.map(u => u.id), '/planning', 'Votre planning a été mis à jour', undefined, 'planning');
}
