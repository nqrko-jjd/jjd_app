import { Router } from 'express';
import { worksiteInput } from '@jjd/shared';
import { prisma, nextWorksiteRef } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { worksiteMargin } from '../lib/worksite-margin.js';
import { geocode } from '../lib/geocode.js';
import { syncChantierSafe } from '../lib/bricoloc.js';

/** Recharge le chantier avec le client et pousse la synchro parc Bricoloc (non bloquant). */
async function pushBricoloc(id: string) {
  const ws = await prisma.worksite.findUnique({
    where: { id },
    select: {
      id: true,
      ref: true,
      title: true,
      address: true,
      postalCode: true,
      city: true,
      status: true,
      archived: true,
      client: { select: { name: true } },
    },
  });
  if (ws) syncChantierSafe(ws);
}

export const worksitesRouter = Router();

worksitesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { status, entity, q, archived, kind } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { archived: archived === '1' ? true : false, kind: kind || 'project' };
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

/** Chantiers où la personne connectée a travaillé (pointage ou affectation planning). */
worksitesRouter.get(
  '/mine',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const personId = req.user!.personId;
    const { q } = req.query as Record<string, string>;
    if (!personId) return res.json({ items: [] });
    const where: Record<string, unknown> = {
      OR: [
        { timeEntries: { some: { personId } } },
        { events: { some: { assignments: { some: { personId } } } } },
      ],
    };
    if (q) {
      where.AND = [{ OR: [{ ref: { contains: q } }, { title: { contains: q } }, { city: { contains: q } }] }];
    }
    const items = await prisma.worksite.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        client: { select: { name: true } },
        building: { select: { name: true } },
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
        reports: { orderBy: { date: 'desc' }, include: { photos: true, author: { select: { email: true } } } },
      },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const margin = req.user!.role === 'worker' ? null : await worksiteMargin(ws.id);
    res.json({ worksite: ws, margin });
  }),
);

/** Briefing terrain : adresse, à faire, équipe, matériel, contact sur place. */
worksitesRouter.get(
  '/:id/field',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const ws = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: {
        client: { select: { name: true, phone: true } },
        building: {
          select: {
            name: true, address: true, postalCode: true, city: true, digicode: true, accessNote: true,
            contacts: { orderBy: { position: 'asc' }, select: { role: true, name: true, phone: true } },
          },
        },
        manager: { select: { displayName: true, firstName: true, phone: true } },
      },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');

    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d1 = new Date(d0); d1.setDate(d1.getDate() + 7);
    const ev = await prisma.planningEvent.findFirst({
      where: { worksiteId: ws.id, startAt: { gte: d0, lt: d1 } },
      orderBy: { startAt: 'asc' },
      include: {
        assignments: { include: { person: { select: { displayName: true, firstName: true, phone: true } } } },
        vehicle: { select: { code: true, brand: true, model: true, plate: true } },
        team: { select: { name: true } },
        equipment: { include: { equipment: { select: { name: true, reference: true } } } },
        consumables: { include: { consumable: { select: { name: true, unit: true } } } },
      },
    });

    const addr = [ws.address ?? ws.building?.address, [ws.postalCode ?? ws.building?.postalCode, ws.city ?? ws.building?.city].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');

    res.json({
      worksite: { id: ws.id, ref: ws.ref, title: ws.title, status: ws.status, description: ws.description, address: addr },
      building: ws.building
        ? {
            name: ws.building.name, digicode: ws.building.digicode, accessNote: ws.building.accessNote,
            contacts: ws.building.contacts,
          }
        : null,
      client: ws.client,
      manager: ws.manager ? { name: ws.manager.displayName || ws.manager.firstName, phone: ws.manager.phone } : null,
      today: ev
        ? {
            date: ev.startAt, startAt: ev.startAt, endAt: ev.endAt, allDay: ev.allDay,
            toDo: ev.note, materials: ev.materialsNote,
            team: ev.team?.name ?? null,
            vehicle: ev.vehicle ? `${ev.vehicle.code ?? ''} ${ev.vehicle.brand ?? ''} ${ev.vehicle.model ?? ''}`.trim() : null,
            people: ev.assignments.map((a) => ({ name: a.person.displayName || a.person.firstName, phone: a.person.phone })),
            equipment: ev.equipment.map((e) => ({ name: e.equipment.name, reference: e.equipment.reference })),
            consumables: ev.consumables.map((c) => ({ name: c.consumable.name, qty: c.qty, unit: c.consumable.unit })),
          }
        : null,
    });
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
    void pushBricoloc(ws.id);
    res.status(201).json({ worksite: ws });
  }),
);

/** Point GPS de référence du chantier (pour le contrôle de pointage). */
worksitesRouter.patch(
  '/:id/geo',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { lat, lng, clear } = req.body as { lat?: number; lng?: number; clear?: boolean };
    const data = clear
      ? { lat: null, lng: null, geoSetAt: null }
      : { lat: Number(lat), lng: Number(lng), geoSetAt: new Date() };
    if (!clear && (Number.isNaN(data.lat as number) || Number.isNaN(data.lng as number))) throw new HttpError(422, 'Coordonnées invalides');
    const ws = await prisma.worksite.update({ where: { id: req.params.id }, data });
    res.json({ lat: ws.lat, lng: ws.lng, geoSetAt: ws.geoSetAt });
  }),
);

/** Géocode l'adresse du chantier (OpenStreetMap / Nominatim) -> fixe le point GPS. */
worksitesRouter.post(
  '/:id/geocode',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: { building: { select: { address: true, postalCode: true, city: true } } },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const q = [
      req.body?.address || ws.address || ws.building?.address,
      [ws.postalCode || ws.building?.postalCode, ws.city || ws.building?.city].filter(Boolean).join(' '),
      'Belgique',
    ].filter(Boolean).join(', ');
    if (!q || q === 'Belgique') throw new HttpError(422, 'Aucune adresse à géocoder');

    const hit = await geocode(q);
    if (!hit) throw new HttpError(404, `Adresse introuvable : ${q}`);

    const updated = await prisma.worksite.update({
      where: { id: ws.id },
      data: { lat: hit.lat, lng: hit.lng, geoSetAt: new Date() },
    });
    res.json({ lat: updated.lat, lng: updated.lng, matched: hit.label, query: q });
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
    void pushBricoloc(ws.id);
    res.json({ worksite: ws });
  }),
);
