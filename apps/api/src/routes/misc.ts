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
    const [clients, buildings, people, worksites, syndics, staff] = await Promise.all([
      prisma.contact.findMany({ where: { OR: [{ type: 'client' }, { type: 'both' }] }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.building.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, syndicId: true } }),
      prisma.person.findMany({ where: { active: true }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, displayName: true } }),
      prisma.worksite.findMany({ where: { archived: false, kind: 'project', source: { not: 'demo' } }, orderBy: { updatedAt: 'desc' }, take: 5000, select: { id: true, ref: true, title: true, clientId: true } }),
      prisma.syndic.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { active: true, role: { in: STAFF } },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, person: { select: { displayName: true, firstName: true } } },
      }),
    ]);
    res.json({
      clients,
      buildings,
      syndics,
      people: people.map((p) => ({ id: p.id, name: p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim() })),
      worksites: worksites.map((w) => ({ id: w.id, name: `${w.ref} · ${w.title}`, clientId: w.clientId })),
      staff: staff.map((u) => ({ id: u.id, name: u.person?.displayName || u.person?.firstName || u.email })),
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

/**
 * La file de contrôle pointe vers des lignes du fichier Excel d'origine
 * (sheet/rowRef), inaccessible depuis l'app. On résout chaque issue vers
 * l'endroit de l'app où on peut réellement corriger le problème :
 * - chantier trouvé (juste incomplet, ex. "sans client") -> lien direct vers sa fiche.
 * - référence de chantier inconnue (ligne orpheline dans le grand livre / pointage)
 *   -> recherche pré-remplie dans Achats ou Équipe, pour la retrouver et la corriger
 *   (via le formulaire, ou un import/export CSV pour un gros lot).
 */
async function resolveIssueLink(entity: string, rawData: unknown): Promise<{ label: string; href: string } | null> {
  const d = (rawData ?? {}) as Record<string, unknown>;
  if (entity === 'worksite' && typeof d.ref === 'string') {
    const w = await prisma.worksite.findFirst({ where: { ref: d.ref }, select: { id: true } });
    if (w) return { label: 'Ouvrir le chantier', href: `/app/chantiers/${w.id}` };
  }
  if (entity === 'ledger' && typeof d.ref === 'string') {
    return { label: 'Chercher dans Achats', href: `/app/achats?q=${encodeURIComponent(d.ref)}` };
  }
  if (entity === 'time_entry' && typeof d.workerName === 'string') {
    return { label: 'Chercher l’ouvrier', href: `/app/equipe?q=${encodeURIComponent(d.workerName)}` };
  }
  if (entity === 'person' && typeof d.name === 'string') {
    const first = d.name.split(/[/,]/)[0]!.trim();
    return { label: 'Chercher l’ouvrier', href: `/app/equipe?q=${encodeURIComponent(first)}` };
  }
  if (entity === 'contact' && typeof d.name === 'string') {
    return { label: 'Chercher le contact', href: `/app/contacts?q=${encodeURIComponent(d.name)}` };
  }
  return null;
}

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
    const withLinks = await Promise.all(items.map(async (i) => ({ ...i, link: await resolveIssueLink(i.entity, i.rawData) })));
    res.json({ items: withLinks, openBySeverity: Object.fromEntries(counts.map((c) => [c.severity, c._count])) });
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
