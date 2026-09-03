import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { HttpError } from './http.js';

export interface PortalUser {
  id: string;
  email: string;
  contactId: string | null;
  syndicId: string | null;
  label: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalUser?: PortalUser;
    }
  }
}

export function signPortalToken(userId: string): string {
  return jwt.sign({ sub: userId, portal: true }, env.jwtSecret, { expiresIn: '30d' });
}

export async function attachPortalUser(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next();
  try {
    const p = jwt.verify(h.slice(7), env.jwtSecret) as { sub: string; portal?: boolean };
    if (!p.portal) return next();
    const u = await prisma.user.findUnique({ where: { id: p.sub }, include: { contact: true, syndic: true } });
    if (u && u.active && u.role === 'client') {
      req.portalUser = {
        id: u.id,
        email: u.email,
        contactId: u.contactId,
        syndicId: u.syndicId,
        label: u.syndic?.name ?? u.contact?.name ?? u.email,
      };
    }
  } catch {
    /* token invalide */
  }
  next();
}

export function requirePortal(req: Request, _res: Response, next: NextFunction) {
  if (!req.portalUser) throw new HttpError(401, 'Connexion requise');
  next();
}

/** Clause Prisma : les chantiers visibles par ce client. */
export function worksiteScope(u: PortalUser): object {
  if (u.syndicId) {
    return { building: { syndicId: u.syndicId } };
  }
  return {
    OR: [
      { clientId: u.contactId },
      { building: { clientId: u.contactId } },
    ],
  };
}

export function buildingScope(u: PortalUser): object {
  if (u.syndicId) return { syndicId: u.syndicId };
  return { OR: [{ clientId: u.contactId }, { worksites: { some: { clientId: u.contactId } } }] };
}
