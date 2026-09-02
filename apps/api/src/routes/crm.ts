import { Router } from 'express';
import { crmOpportunityInput, CRM_STAGES } from '@jjd/shared';
import { prisma, nextWorksiteRef } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

export const crmRouter = Router();

/** Pipeline groupé par étape (vue kanban). */
crmRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const opps = await prisma.crmOpportunity.findMany({
      where: { stage: { notIn: ['won', 'lost'] } },
      orderBy: [{ nextActionOn: 'asc' }, { updatedAt: 'desc' }],
      include: {
        contact: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
        owner: { select: { id: true, email: true } },
      },
    });
    const columns = CRM_STAGES.filter((s) => s !== 'won' && s !== 'lost').map((stage) => ({
      stage,
      items: opps.filter((o) => o.stage === stage),
    }));
    res.json({ columns });
  }),
);

crmRouter.get(
  '/closed',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { stage } = req.query as Record<string, string>;
    const items = await prisma.crmOpportunity.findMany({
      where: { stage: stage === 'won' || stage === 'lost' ? stage : { in: ['won', 'lost'] } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { contact: { select: { name: true } }, worksite: { select: { ref: true } } },
    });
    res.json({ items });
  }),
);

crmRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const data = crmOpportunityInput.parse(req.body);
    const opp = await prisma.crmOpportunity.create({
      data: { ...data, ownerId: req.user!.id },
    });
    res.status(201).json({ opportunity: opp });
  }),
);

crmRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const data = crmOpportunityInput.partial().parse(req.body);
    const opp = await prisma.crmOpportunity.update({ where: { id: req.params.id }, data });
    res.json({ opportunity: opp });
  }),
);

/** Transforme une opportunité gagnée en chantier. */
crmRouter.post(
  '/:id/win',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const opp = await prisma.crmOpportunity.findUnique({ where: { id: req.params.id } });
    if (!opp) throw new HttpError(404, 'Opportunité introuvable');
    if (opp.worksiteId) throw new HttpError(409, 'Un chantier existe déjà pour cette opportunité');

    const ref = await nextWorksiteRef();
    const ws = await prisma.worksite.create({
      data: {
        ref,
        title: opp.title,
        status: 'to_plan',
        clientId: opp.contactId,
        buildingId: opp.buildingId,
        quotedHt: opp.estimatedValue,
        source: 'crm',
      },
    });
    await prisma.crmOpportunity.update({
      where: { id: opp.id },
      data: { stage: 'won', worksiteId: ws.id },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'crm_win', entity: 'worksite', entityId: ws.id },
    });
    res.status(201).json({ worksite: ws });
  }),
);
