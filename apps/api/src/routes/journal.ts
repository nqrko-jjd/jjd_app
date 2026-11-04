/** Journal d'activité : qui a fait quoi dans le logiciel. Réservé au propriétaire (David) — pas aux autres comptes admin. */
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';

export const OWNER_EMAIL = 'david@jjd-consult.be';
export const journalRouter = Router();

journalRouter.get(
  '/',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    if (req.user!.email.toLowerCase() !== OWNER_EMAIL) throw new HttpError(403, 'Journal réservé au propriétaire.');
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const actorId = typeof req.query.actorId === 'string' && req.query.actorId ? req.query.actorId : undefined;
    const entity = typeof req.query.entity === 'string' && req.query.entity ? req.query.entity : undefined;
    const where = { at: { gte: new Date(Date.now() - days * 86_400_000) }, ...(actorId ? { actorId } : {}), ...(entity ? { entity } : {}) };
    const [rows, actors, entities] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: 1000, include: { actor: { select: { id: true, email: true, role: true, personId: true } } } }),
      prisma.auditLog.findMany({ where: { at: where.at, actorId: { not: null } }, distinct: ['actorId'], select: { actor: { select: { id: true, email: true, personId: true } } } }),
      prisma.auditLog.findMany({ where: { at: where.at }, distinct: ['entity'], select: { entity: true }, take: 100 }),
    ]);
    const personIds = [...new Set([...rows.map((r) => r.actor?.personId), ...actors.map((a) => a.actor?.personId)].filter((x): x is string => !!x))];
    const people = await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, displayName: true } });
    const nameOf = (a: { email: string; personId: string | null } | null) => {
      if (!a) return 'Système';
      const p = people.find((x) => x.id === a.personId);
      return p ? p.displayName || p.firstName : a.email;
    };
    res.json({
      items: rows.map((r) => ({ id: r.id, at: r.at, who: nameOf(r.actor), whoId: r.actor?.id ?? null, role: r.actor?.role ?? null, action: r.action, entity: r.entity, entityId: r.entityId, meta: r.meta })),
      actors: actors.filter((a) => a.actor).map((a) => ({ id: a.actor!.id, name: nameOf(a.actor) })),
      entities: entities.map((e) => e.entity).sort(),
    });
  }),
);
