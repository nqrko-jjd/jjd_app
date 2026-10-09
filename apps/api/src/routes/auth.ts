import { Router } from 'express';
import { loginSchema, resolveLoginEmail } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { signToken, verifyPassword, requireAuth } from '../lib/auth.js';
import { LOCALES } from '../lib/translate.js';
import { assertLoginAllowed, recordLoginFailure, clearLoginFailures } from '../lib/login-throttle.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email: identifier, password } = loginSchema.parse(req.body);
    // E-mail, ou numéro de GSM (encodé en e-mail technique : voir packages/shared/src/phone.ts).
    const loginEmail = resolveLoginEmail(identifier);
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim();
    const ip = fwd || req.ip || 'unknown';
    const account = loginEmail ?? identifier.toLowerCase();
    assertLoginAllowed(account, ip);
    const user = loginEmail ? await prisma.user.findUnique({ where: { email: loginEmail } }) : null;
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      recordLoginFailure(account, ip);
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    clearLoginFailures(account);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const person = user.personId ? await prisma.person.findUnique({ where: { id: user.personId } }) : null;
    res.json({
      token: signToken(user.id),
      user: {
        id: user.id, email: user.email, role: user.role,
        isPartner: user.isPartner, entityScope: user.entityScope ?? null, locale: user.locale, personId: user.personId,
      },
      person,
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const u = req.user!;
    let person = null;
    if (u.personId) {
      person = await prisma.person.findUnique({ where: { id: u.personId } });
    }
    res.json({ user: u, person });
  }),
);

/** Choix de la langue de l'interface et des messages (fr | en | pt-BR), mémorisé dans le compte. */
authRouter.patch(
  '/locale',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const locale = String(req.body?.locale ?? '');
    if (!(LOCALES as readonly string[]).includes(locale)) throw new HttpError(422, 'Langue non prise en charge');
    await prisma.user.update({ where: { id: req.user!.id }, data: { locale } });
    res.json({ locale });
  }),
);
