import { Router } from 'express';
import { buildingInput, buildingContactInput, buildingUnitInput, normalizeName } from '@jjd/shared';
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
        _count: { select: { worksites: true, units: true } },
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
        contacts: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { contact: { select: { id: true, name: true } } } },
        units: { orderBy: [{ position: 'asc' }, { label: 'asc' }] },
        worksites: {
          orderBy: { updatedAt: 'desc' },
          include: {
            manager: { select: { firstName: true, displayName: true } },
            documents: { where: { number: { not: null } }, select: { id: true, kind: true, number: true, status: true, totalTtc: true, issuedOn: true } },
          },
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
        lotCount: data.lotCount ?? null,
        source: 'manual',
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

/* ------------------------------------------------------ Contacts clés */

buildingsRouter.post(
  '/:id/contacts',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingContactInput.parse(req.body);
    const count = await prisma.buildingContact.count({ where: { buildingId: req.params.id } });
    const contact = await prisma.buildingContact.create({
      data: {
        buildingId: req.params.id as string,
        role: data.role,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        note: data.note ?? null,
        contactId: data.contactId ?? null,
        position: count,
      },
    });
    res.status(201).json({ contact });
  }),
);

buildingsRouter.patch(
  '/:id/contacts/:cid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingContactInput.partial().parse(req.body);
    const contact = await prisma.buildingContact.update({
      where: { id: req.params.cid },
      data: { ...data, email: data.email === undefined ? undefined : data.email || null },
    });
    res.json({ contact });
  }),
);

buildingsRouter.delete(
  '/:id/contacts/:cid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.buildingContact.delete({ where: { id: req.params.cid } });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------ Lots & occupants */

buildingsRouter.post(
  '/:id/units',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingUnitInput.parse(req.body);
    const count = await prisma.buildingUnit.count({ where: { buildingId: req.params.id } });
    const unit = await prisma.buildingUnit.create({
      data: {
        buildingId: req.params.id as string,
        label: data.label,
        floor: data.floor ?? null,
        door: data.door ?? null,
        occupantName: data.occupantName ?? null,
        occupantPhone: data.occupantPhone ?? null,
        occupantEmail: data.occupantEmail || null,
        occupantKind: data.occupantKind ?? null,
        note: data.note ?? null,
        position: count,
      },
    });
    res.status(201).json({ unit });
  }),
);

buildingsRouter.patch(
  '/:id/units/:uid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingUnitInput.partial().parse(req.body);
    const unit = await prisma.buildingUnit.update({
      where: { id: req.params.uid },
      data: { ...data, occupantEmail: data.occupantEmail === undefined ? undefined : data.occupantEmail || null },
    });
    res.json({ unit });
  }),
);

buildingsRouter.delete(
  '/:id/units/:uid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.buildingUnit.delete({ where: { id: req.params.uid } });
    res.json({ ok: true });
  }),
);
