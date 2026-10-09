import { Router } from 'express';
import {
  ROLE_LABEL, ENTITY_LABEL, WORKSITE_STATUS_LABEL, CRM_STAGE_LABEL,
  CRM_LOST_REASON_LABEL, CLIENT_KIND_LABEL, WORKER_CONTRACT_LABEL, LEGAL_DOC_LABEL,
} from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { bureauDashboard } from '../lib/dashboard.js';
import { scopeStore } from '../lib/entity-scope.js';

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
    const [clients, buildings, people, worksites, syndics, promoters] = await Promise.all([
      prisma.contact.findMany({ where: { OR: [{ type: 'client' }, { type: 'both' }] }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.contact.findMany({ where: { kind: { in: ['acp', 'developer'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, syndicId: true, promoterId: true } }),
      prisma.person.findMany({ where: { active: true }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, displayName: true, role: true } }),
      // les chantiers clôturés/archivés restent choisissables (reprise d'anciens dossiers, recoupement
      // des paiements) : en fin de liste, avec un suffixe — jamais cachés
      prisma.worksite.findMany({
        where: { kind: 'project', source: { not: 'demo' } },
        orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
        take: 5000,
        select: { id: true, ref: true, title: true, clientId: true, acpId: true, city: true, managerId: true, archived: true, status: true },
      }),
      prisma.syndic.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.promoter.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    // compte limité à une entité : seuls les clients et immeubles de SES chantiers sont proposés
    const scoped = scopeStore.getStore();
    const clientIds = new Set(worksites.map((w) => w.clientId).filter(Boolean));
    const acpIds = new Set(worksites.map((w) => w.acpId).filter(Boolean));
    res.json({
      clients: scoped ? clients.filter((c) => clientIds.has(c.id)) : clients,
      buildings: scoped ? buildings.filter((b) => acpIds.has(b.id)) : buildings,
      syndics: scoped ? [] : syndics,
      promoters: scoped ? [] : promoters,
      people: people.map((p) => ({ id: p.id, name: p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim(), role: p.role })),
      worksites: worksites.map((w) => ({ id: w.id, name: `${w.ref} · ${w.title}${w.status === 'closed' ? ' (clôturé)' : w.archived ? ' (archivé)' : ''}`, clientId: w.clientId, city: w.city, managerId: w.managerId })),
    });
  }),
);

metaRouter.get(
  '/syndics',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.syndic.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: { where: { kind: { in: ['acp', 'developer'] } } } } } },
    });
    res.json({ items: items.map((s) => ({ ...s, _count: { buildings: s._count.contacts } })) });
  }),
);

metaRouter.get(
  '/promoters',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.promoter.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: { where: { kind: 'developer' } } } } },
    });
    res.json({ items: items.map((p) => ({ ...p, _count: { projects: p._count.contacts } })) });
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
    // Une écriture "Facture de vente" (ou une note de crédit, vente ou achat confondus) est
    // invisible dans la vue achats par défaut (direction exclue tant qu'elle n'est pas demandée
    // explicitement, cf. buildWhere dans expenses.ts) — sans ce paramètre le lien ne retrouvait
    // jamais rien pour ces cas, même quand la ligne existait bel et bien.
    const typeRaw = typeof d.typeRaw === 'string' ? d.typeRaw.toLowerCase() : '';
    const type = typeRaw.includes('vente') ? 'sale' : typeRaw.includes('crédit') || typeRaw.includes('credit') ? 'credit_note' : '';
    const params = new URLSearchParams({ q: d.ref });
    if (type) params.set('type', type);
    return { label: 'Chercher dans Achats', href: `/app/achats?${params}` };
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
