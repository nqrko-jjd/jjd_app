import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { Role } from '@jjd/shared';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { HttpError } from './http.js';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  isPartner: boolean;
  personId: string | null;
  contactId: string | null;
  locale: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: '30d' });
}

async function loadUser(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    const u = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!u || !u.active) return null;
    return {
      id: u.id,
      email: u.email,
      role: u.role as Role,
      isPartner: u.isPartner,
      personId: u.personId,
      contactId: u.contactId,
      locale: u.locale,
    };
  } catch {
    return null;
  }
}

/** Attache req.user si un token valide est présent (n'échoue pas sinon). */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    req.user = (await loadUser(header.slice(7))) ?? undefined;
  }
  next();
}

/** Exige une session ; optionnellement restreint à certains rôles. */
export function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Connexion requise');
    if (roles.length && !roles.includes(req.user.role)) {
      throw new HttpError(403, 'Accès refusé');
    }
    next();
  };
}

/** Réservé aux associés (partage des bénéfices). */
export function requirePartner(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'Connexion requise');
  if (!req.user.isPartner) throw new HttpError(403, 'Réservé aux associés');
  next();
}

export const STAFF: Role[] = ['admin', 'office', 'foreman', 'worker'];
export const OFFICE: Role[] = ['admin', 'office'];
