import { prisma } from '../db.js';

export interface ReactionSummary { emoji: string; count: number; mine: boolean }

/** Réactions regroupées par émoji pour une liste de messages (« mine » = réaction de l'utilisateur courant). */
export async function reactionsFor(messageIds: string[], userId: string): Promise<Map<string, ReactionSummary[]>> {
  const out = new Map<string, ReactionSummary[]>();
  if (!messageIds.length) return out;
  const rows = await prisma.messageReaction.findMany({ where: { messageId: { in: messageIds } }, orderBy: { createdAt: 'asc' }, select: { messageId: true, userId: true, emoji: true } });
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    const hit = list.find((x) => x.emoji === r.emoji);
    if (hit) { hit.count++; if (r.userId === userId) hit.mine = true; }
    else list.push({ emoji: r.emoji, count: 1, mine: r.userId === userId });
    out.set(r.messageId, list);
  }
  return out;
}

/** Ajoute la réaction si elle n'existe pas pour cet utilisateur, la retire sinon. */
export async function toggleReaction(messageId: string, userId: string, emoji: string): Promise<void> {
  const existing = await prisma.messageReaction.findFirst({ where: { messageId, userId, emoji }, select: { id: true } });
  if (existing) await prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });
  else await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
}
