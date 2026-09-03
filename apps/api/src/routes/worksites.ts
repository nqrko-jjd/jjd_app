import { Router } from 'express';
import { worksiteInput } from '@jjd/shared';
import { prisma, nextWorksiteRef } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { worksiteMargin } from '../lib/worksite-margin.js';

export const worksitesRouter = Router();

worksitesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { status, entity, q, archived } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { archived: archived === '1' ? true : false };
    if (status) where.status = status;
    if (entity) where.entity = entity;
    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { title: { contains: q } },
        { city: { contains: q } },
      ];
    }
    const items = await prisma.worksite.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 300,
      include: {
        client: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
        manager: { select: { id: true, displayName: true, firstName: true } },
      },
    });
    res.json({ items });
  }),
);

worksitesRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const ws = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        building: { include: { syndic: true } },
        manager: true,
        documents: { orderBy: { issuedOn: 'desc' } },
        events: { orderBy: { startAt: 'desc' }, take: 20, include: { assignments: { include: { person: true } }, vehicle: true } },
      },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const margin = req.user!.role === 'worker' ? null : await worksiteMargin(ws.id);
    res.json({ worksite: ws, margin });
  }),
);

worksitesRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = worksiteInput.parse(req.body);
    const ref = await nextWorksiteRef();
    const ws = await prisma.worksite.create({
      data: {
        ref,
        title: data.title,
        entity: data.entity,
        status: data.status,
        priority: data.priority,
        statusTags: data.statusTags,
        clientId: data.clientId ?? null,
        buildingId: data.buildingId ?? null,
        managerId: data.managerId ?? null,
        address: data.address ?? null,
        postalCode: data.postalCode ?? null,
        city: data.city ?? null,
        startedOn: data.startedOn ?? null,
        endedOn: data.endedOn ?? null,
        quotedHt: data.quotedHt ?? null,
        description: data.description ?? null,
        source: 'manual',
      },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'create', entity: 'worksite', entityId: ws.id },
    });
    res.status(201).json({ worksite: ws });
  }),
);

worksitesRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = worksiteInput.partial().parse(req.body);
    const ws = await prisma.worksite.update({
      where: { id: req.params.id },
      data: {
        ...data,
        statusTags: data.statusTags ?? undefined,
      },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'update', entity: 'worksite', entityId: ws.id, meta: data },
    });
    res.json({ worksite: ws });
  }),
);
