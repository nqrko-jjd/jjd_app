import { Router } from 'express';
import { contactInput, normalizeName } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

export const contactsRouter = Router();

contactsRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { type, q } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type && type !== 'all') where.OR = [{ type }, { type: 'both' }];
    if (q) {
      where.AND = [{ OR: [{ name: { contains: q } }, { city: { contains: q } }, { vat: { contains: q } }] }];
    }
    const items = await prisma.contact.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
      include: { syndic: { select: { id: true, name: true } }, _count: { select: { worksites: true } } },
    });
    res.json({ items });
  }),
);

contactsRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        syndic: true,
        buildings: true,
        worksites: { orderBy: { updatedAt: 'desc' }, take: 50 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 20 },
      },
    });
    if (!contact) throw new HttpError(404, 'Contact introuvable');
    res.json({ contact });
  }),
);

contactsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = contactInput.parse(req.body);
    const contact = await prisma.contact.create({
      data: {
        ...data,
        email: data.email || null,
        normalizedName: normalizeName(data.name),
        syndicId: data.syndicId ?? null,
        source: 'manual',
      },
    });
    res.status(201).json({ contact });
  }),
);

contactsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = contactInput.partial().parse(req.body);
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
        ...(data.name ? { normalizedName: normalizeName(data.name) } : {}),
      },
    });
    res.json({ contact });
  }),
);
