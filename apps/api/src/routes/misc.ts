import { Router } from 'express';
import {
  ROLE_LABEL, ENTITY_LABEL, WORKSITE_STATUS_LABEL, CRM_STAGE_LABEL,
  CRM_LOST_REASON_LABEL, CLIENT_KIND_LABEL, WORKER_CONTRACT_LABEL, LEGAL_DOC_LABEL,
} from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { bureauDashboard } from '../lib/dashboard.js';

export const dashboardRouter = Router();
dashboardRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => res.json(await bureauDashboard())),
);

export const metaRouter = Router();
metaRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      labels: {
        role: ROLE_LABEL,
        entity: ENTITY_LABEL,
        worksiteStatus: WORKSITE_STATUS_LABEL,
        crmStage: CRM_STAGE_LABEL,
        crmLostReason: CRM_LOST_REASON_LABEL,
        clientKind: CLIENT_KIND_LABEL,
        workerContract: WORKER_CONTRACT_LABEL,
        legalDoc: LEGAL_DOC_LABEL,
      },
    });
  }),
);

metaRouter.get(
  '/categories',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.category.findMany({ orderBy: { code: 'asc' } });
    res.json({ items });
  }),
);

/** Listes courtes pour les <select> des formulaires. */
metaRouter.get(
  '/pickers',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const [clients, buildings, people] = await Promise.all([
      prisma.contact.findMany({ where: { OR: [{ type: 'client' }, { type: 'both' }] }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.building.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.person.findMany({ where: { active: true }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, displayName: true } }),
    ]);
    res.json({
      clients,
      buildings,
      people: people.map((p) => ({ id: p.id, name: p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim() })),
    });
  }),
);

metaRouter.get(
  '/syndics',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.syndic.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { buildings: true } } },
    });
    res.json({ items });
  }),
);

export const importsRouter = Router();
importsRouter.get(
  '/issues',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { resolved, entity, severity } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (resolved === '1') where.resolved = true;
    if (resolved === '0') where.resolved = false;
    if (entity) where.entity = entity;
    if (severity) where.severity = severity;
    const [items, counts] = await Promise.all([
      prisma.importIssue.findMany({ where, orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }], take: 500 }),
      prisma.importIssue.groupBy({ by: ['severity'], where: { resolved: false }, _count: true }),
    ]);
    res.json({ items, openBySeverity: Object.fromEntries(counts.map((c) => [c.severity, c._count])) });
  }),
);

importsRouter.patch(
  '/issues/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const issue = await prisma.importIssue.update({
      where: { id: req.params.id },
      data: { resolved: req.body.resolved ?? true, resolvedNote: req.body.note ?? null },
    });
    res.json({ issue });
  }),
);
