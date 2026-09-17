import { INTERNAL_ROLES } from '@jjd/shared';
import { prisma } from '../db.js';
import { sendPushToUser } from './push.js';

export interface MentionCandidate { id: string; name: string }

/** Toute personne "mentionnable" avec un @ dans un message interne — l'équipe (comptes
 *  admin/office/foreman/worker), pas les clients ni les syndics. */
export async function mentionCandidates(): Promise<MentionCandidate[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: INTERNAL_ROLES }, active: true },
    include: { person: { select: { firstName: true, lastName: true, displayName: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.person?.displayName || `${u.person?.firstName ?? ''} ${u.person?.lastName ?? ''}`.trim() || u.email,
  }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Repère les "@Nom" dans un texte parmi les personnes mentionnables. La saisie passe
 *  normalement par le sélecteur du composer (qui insère le nom complet exact), mais on
 *  tolère aussi un simple "@Prénom" tapé à la main. Le nom le plus long d'abord, pour
 *  qu'"@Julien Dupont" ne matche pas juste "@Julien" en laissant traîner "Dupont". */
export function findMentions(body: string, candidates: MentionCandidate[]): string[] {
  if (!body?.includes('@')) return [];
  const sorted = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const found = new Set<string>();
  for (const c of sorted) {
    if (!c.name) continue;
    const re = new RegExp(`@${escapeRe(c.name)}\\b`, 'iu');
    if (re.test(body)) { found.add(c.id); continue; }
    const first = c.name.split(/\s+/)[0];
    if (first && first.length >= 3 && new RegExp(`@${escapeRe(first)}\\b`, 'iu').test(body)) {
      found.add(c.id);
    }
  }
  return [...found];
}

/** Résout les userId mentionnés (table MessageMention) en noms affichables, pour que le
 *  frontend puisse surligner "@Nom" dans le texte sans avoir à interroger la liste des
 *  coéquipiers lui-même. Les noms sont résolus à la lecture (pas figés à l'envoi) — un
 *  changement de nom se répercute donc sur l'historique. */
export async function mentionNamesFor(messages: { id: string; mentions: { userId: string }[] }[]): Promise<Map<string, string[]>> {
  const candidates = await mentionCandidates();
  const nameById = new Map(candidates.map((c) => [c.id, c.name]));
  const out = new Map<string, string[]>();
  for (const m of messages) {
    out.set(m.id, m.mentions.map((x) => nameById.get(x.userId)).filter((n): n is string => !!n));
  }
  return out;
}

/** À appeler juste après la création d'un message texte : repère les @mentions, les
 *  enregistre (pour l'affichage) et notifie chaque mentionné par push — jamais l'auteur
 *  lui-même. Best-effort, ne doit jamais faire échouer l'envoi du message. */
export async function processMentions(
  messageId: string, body: string, authorId: string | null, authorLabel: string, url: string,
): Promise<void> {
  if (!body?.includes('@')) return;
  const candidates = (await mentionCandidates()).filter((c) => c.id !== authorId);
  const userIds = findMentions(body, candidates);
  if (userIds.length === 0) return;
  await prisma.messageMention.createMany({ data: userIds.map((userId) => ({ messageId, userId })) });
  await Promise.all(userIds.map((userId) => sendPushToUser(userId, {
    title: `${authorLabel} t’a mentionné`,
    body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
    url,
  })));
}
