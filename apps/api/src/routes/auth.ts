import { Router } from 'express';
import { loginSchema } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { signToken, verifyPassword, requireAuth } from '../lib/auth.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, 'E-mail ou mot de passe incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    res.json({
      token: signToken(user.id),
      user: {
        id: user.id, email: user.email, role: user.role,
        isPartner: user.isPartner, locale: user.locale,
      },
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
