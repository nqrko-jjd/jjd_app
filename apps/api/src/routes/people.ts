import { Router } from 'express';
import { personInput, legalDocInput, normalizeName } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

export const peopleRouter = Router();

function fullName(p: { firstName: string; lastName?: string | null }) {
  return `${p.firstName} ${p.lastName ?? ''}`.trim();
}

peopleRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { role, active, q } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (active === '1') where.active = true;
    if (active === '0') where.active = false;
    if (q) where.OR = [{ firstName: { contains: q } }, { lastName: { contains: q } }, { displayName: { contains: q } }];
    const items = await prisma.person.findMany({
      where,
      orderBy: [{ active: 'desc' }, { firstName: 'asc' }],
      include: { _count: { select: { legalDocs: true, timeEntries: true } } },
    });
    res.json({ items });
  }),
);

peopleRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findUnique({
      where: { id: req.params.id },
      include: {
        legalDocs: { orderBy: { expiresOn: 'asc' } },
        equipment: true,
        user: { select: { id: true, email: true, role: true } },
      },
    });
    if (!person) throw new HttpError(404, 'Fiche introuvable');

    // décompte du mois courant
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const month = await prisma.timeEntry.aggregate({
      where: { personId: person.id, date: { gte: monthStart }, status: { in: ['approved', 'submitted'] } },
      _sum: { hours: true, amount: true },
    });
    res.json({
      person,
      monthStatement: { hours: month._sum.hours ?? 0, amount: month._sum.amount ?? 0 },
    });
  }),
);

peopleRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personInput.parse(req.body);
    const person = await prisma.person.create({
      data: {
        ...data,
        email: data.email || null,
        displayName: data.displayName || data.firstName,
        normalizedName: normalizeName(fullName(data)),
        languages: data.languages,
        source: 'manual',
      },
    });
    res.status(201).json({ person });
  }),
);

peopleRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personInput.partial().parse(req.body);
    const person = await prisma.person.update({
      where: { id: req.params.id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
        languages: data.languages ?? undefined,
      },
    });
    res.json({ person });
  }),
);

peopleRouter.post(
  '/:id/legal-docs',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = legalDocInput.parse({ ...req.body, personId: req.params.id });
    const doc = await prisma.legalDoc.create({ data });
    res.status(201).json({ doc });
  }),
);

peopleRouter.delete(
  '/:id/legal-docs/:docId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.legalDoc.delete({ where: { id: req.params.docId } });
    res.status(204).end();
  }),
);
