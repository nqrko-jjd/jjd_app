import { Router } from 'express';
import { ROLES } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, hashPassword } from '../lib/auth.js';

export const usersRouter = Router();

function label(u: {
  email: string;
  person: { firstName: string; lastName: string | null; displayName: string | null } | null;
  contact: { name: string } | null;
  syndic: { name: string } | null;
  building: { name: string } | null;
}) {
  if (u.person) return u.person.displayName || `${u.person.firstName} ${u.person.lastName ?? ''}`.trim();
  if (u.contact) return u.contact.name;
  if (u.syndic) return `${u.syndic.name} (syndic)`;
  if (u.building) return `${u.building.name} (résident)`;
  return u.email;
}

/** Liste tous les comptes de connexion (équipe + portail) pour la gestion centralisée. */
usersRouter.get(
  '/',
  requireAuth('admin'),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        person: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        contact: { select: { id: true, name: true } },
        syndic: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
      },
    });
    res.json({
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        active: u.active,
        portalAccess: u.portalAccess,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        label: label(u),
        link: u.person ? `/app/equipe/${u.person.id}` : u.contact ? `/app/contacts/${u.contact.id}` : u.building ? `/app/immeubles/${u.building.id}` : null,
      })),
    });
  }),
);

/** Change le rôle et/ou active/désactive un compte. */
usersRouter.patch(
  '/:id',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    const { role, active, portalAccess } = req.body as { role?: string; active?: boolean; portalAccess?: string };
    if (req.params.id === req.user!.id && (active === false || (role && role !== 'admin'))) {
      throw new HttpError(409, 'Impossible de te désactiver ou de changer ton propre rôle depuis cet écran.');
    }
    const data: Record<string, unknown> = {};
    if (role !== undefined) {
      if (!ROLES.includes(role as (typeof ROLES)[number])) throw new HttpError(422, 'Rôle invalide');
      data.role = role;
    }
    if (active !== undefined) data.active = !!active;
    if (portalAccess !== undefined) data.portalAccess = portalAccess === 'limited' ? 'limited' : 'full';
    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    res.json({ user: { id: user.id, role: user.role, active: user.active, portalAccess: user.portalAccess } });
  }),
);

/** Génère un nouveau mot de passe temporaire, renvoyé une seule fois (à communiquer à la main). */
usersRouter.post(
  '/:id/reset-password',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    const password = Math.random().toString(36).slice(2, 8);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: await hashPassword(password) } });
    res.json({ email: user.email, password });
  }),
);

/** Supprime un compte de connexion (la fiche personne/contact liée n'est pas touchée). */
usersRouter.delete(
  '/:id',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) throw new HttpError(409, 'Impossible de supprimer ton propre compte.');
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
