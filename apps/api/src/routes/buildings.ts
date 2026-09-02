import { Router } from 'express';
import { buildingInput, normalizeName } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

export const buildingsRouter = Router();

buildingsRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { q, syndicId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (syndicId) where.syndicId = syndicId;
    if (q) where.OR = [{ name: { contains: q } }, { city: { contains: q } }];
    const items = await prisma.building.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        syndic: { select: { id: true, name: true } },
        _count: { select: { worksites: true } },
      },
      take: 500,
    });
    res.json({ items });
  }),
);

buildingsRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const building = await prisma.building.findUnique({
      where: { id: req.params.id },
      include: {
        syndic: true,
        client: true,
        worksites: {
          orderBy: { updatedAt: 'desc' },
          include: { manager: { select: { firstName: true, displayName: true } } },
        },
      },
    });
    if (!building) throw new HttpError(404, 'Immeuble introuvable');
    res.json({ building });
  }),
);

buildingsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingInput.parse(req.body);
    const building = await prisma.building.create({
      data: {
        ...data,
        normalizedName: normalizeName(data.name),
        syndicId: data.syndicId ?? null,
        clientId: data.clientId ?? null,
      },
    });
    res.status(201).json({ building });
  }),
);

buildingsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingInput.partial().parse(req.body);
    const building = await prisma.building.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(data.name ? { normalizedName: normalizeName(data.name) } : {}),
      },
    });
    res.json({ building });
  }),
);
