/**
 * Parc d'outillage partagé avec Bricoloc — vue « bureau » JJD.
 * Proxy authentifié vers l'API partenaire Bricoloc. Le chantier JJD est
 * identifié côté Bricoloc par son `worksite.id` (externalRef).
 */
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import {
  bricolocEnabled,
  createLoan,
  getChantierReport,
  getConsumables,
  getStock,
  getUnit,
  logConsumption,
  returnLoan,
  syncChantier,
  type WorksiteLike,
} from '../lib/bricoloc.js';

export const materielRouter = Router();

const WS_SELECT = {
  id: true,
  ref: true,
  title: true,
  address: true,
  postalCode: true,
  city: true,
  status: true,
  archived: true,
  client: { select: { name: true } },
} as const;

async function ensureChantierSynced(worksiteId: string): Promise<WorksiteLike> {
  const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: WS_SELECT });
  if (!ws) throw new HttpError(404, 'Chantier introuvable');
  await syncChantier(ws);
  return ws;
}

function actorName(req: import('express').Request): string | undefined {
  return req.user?.email?.split('@')[0];
}

materielRouter.get(
  '/status',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => res.json({ enabled: bricolocEnabled() })),
);

/** Chantiers JJD éligibles pour une sortie (projets actifs). */
materielRouter.get(
  '/worksites',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.worksite.findMany({
      where: { kind: 'project', archived: false, status: { notIn: ['done', 'closed', 'cancelled'] } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, ref: true, title: true, city: true, client: { select: { name: true } } },
      take: 400,
    });
    res.json({ items });
  }),
);

materielRouter.get(
  '/stock',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json(await getStock(q));
  }),
);

materielRouter.get(
  '/consumables',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => res.json(await getConsumables())),
);

materielRouter.get(
  '/units/:code',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => res.json(await getUnit(req.params.code!))),
);

/** Fiche matériel d'un chantier (outils présents + consommables). */
materielRouter.get(
  '/worksites/:id/report',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    await ensureChantierSynced(req.params.id!);
    res.json(await getChantierReport(req.params.id!));
  }),
);

/** Sortie chantier : scanne un outil, l'affecte à un chantier JJD. */
materielRouter.post(
  '/loans',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { code, worksiteId, note } = req.body ?? {};
    if (!code || !worksiteId) throw new HttpError(422, 'code et worksiteId requis');
    await ensureChantierSynced(worksiteId);
    res.status(201).json(
      await createLoan({ code, chantierRef: worksiteId, takenBy: actorName(req), note }),
    );
  }),
);

materielRouter.post(
  '/returns',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { code, note, toState, storageLocation } = req.body ?? {};
    if (!code) throw new HttpError(422, 'code requis');
    if (!storageLocation) throw new HttpError(422, 'Emplacement de rangement requis (scanner la zone où l’outil est remis)');
    res.json(await returnLoan({ code, returnedBy: actorName(req), note, toState, storageLocation }));
  }),
);

materielRouter.post(
  '/consumption',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { code, productId, quantity, worksiteId, note } = req.body ?? {};
    if ((!code && !productId) || !quantity || !worksiteId)
      throw new HttpError(422, '(code ou productId), quantity et worksiteId requis');
    await ensureChantierSynced(worksiteId);
    res.status(201).json(
      await logConsumption({
        code,
        productId,
        quantity: Number(quantity),
        chantierRef: worksiteId,
        takenBy: actorName(req),
        note,
      }),
    );
  }),
);

/** Resynchronise tous les chantiers-projets actifs vers Bricoloc (admin). */
materielRouter.post(
  '/sync-worksites',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!bricolocEnabled()) throw new HttpError(503, 'Parc Bricoloc non configuré');
    const list = await prisma.worksite.findMany({
      where: { kind: 'project' },
      select: WS_SELECT,
      take: 2000,
    });
    let ok = 0;
    const errors: string[] = [];
    for (const ws of list) {
      try {
        await syncChantier(ws);
        ok++;
      } catch (e) {
        errors.push(`${ws.ref}: ${(e as Error).message}`);
      }
    }
    res.json({ synced: ok, total: list.length, errors: errors.slice(0, 20) });
  }),
);
