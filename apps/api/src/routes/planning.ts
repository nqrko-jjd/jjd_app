import { Router } from 'express';
import { planningEventInput, teamInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { upsertEvent, deleteEvent, gcalEnabled } from '../lib/gcal.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';

export const planningRouter = Router();

async function syncToGoogle(eventId: string) {
  const ev = await prisma.planningEvent.findUnique({
    where: { id: eventId },
    include: {
      worksite: { select: { ref: true, title: true, address: true, city: true } },
      team: { select: { name: true } },
      vehicle: { select: { plate: true, model: true } },
      assignments: { include: { person: { select: { displayName: true, firstName: true } } } },
    },
  });
  if (!ev) return;
  const people = ev.assignments.map((a) => a.person.displayName || a.person.firstName).join(', ');
  const lines = [
    ev.team ? `Équipe : ${ev.team.name}` : null,
    people ? `Ouvriers : ${people}` : null,
    ev.vehicle ? `Véhicule : ${[ev.vehicle.plate, ev.vehicle.model].filter(Boolean).join(' ')}` : null,
    ev.materialsNote ? `Matériel : ${ev.materialsNote}` : null,
    ev.note ?? null,
  ].filter(Boolean);
  const gid = await upsertEvent(ev.googleEventId, {
    summary: `${ev.worksite.ref} — ${ev.title || ev.worksite.title}`,
    description: lines.join('\n'),
    location: [ev.worksite.address, ev.worksite.city].filter(Boolean).join(', ') || undefined,
    start: ev.startAt,
    end: ev.endAt,
    allDay: ev.allDay,
  });
  if (gid && gid !== ev.googleEventId) {
    await prisma.planningEvent.update({ where: { id: ev.id }, data: { googleEventId: gid } });
  }
}

planningRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { from, to, worksiteId, personId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (from || to) where.startAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    if (worksiteId) where.worksiteId = worksiteId;
    if (personId) where.assignments = { some: { personId } };
    const items = await prisma.planningEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: {
        worksite: { select: { id: true, ref: true, title: true, city: true } },
        team: { select: { id: true, name: true, color: true } },
        vehicle: { select: { id: true, plate: true, model: true } },
        assignments: { include: { person: { select: { id: true, displayName: true, firstName: true } } } },
      },
    });
    res.json({ items, googleSync: gcalEnabled() });
  }),
);

planningRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = planningEventInput.parse(req.body);
    const ev = await prisma.planningEvent.create({
      data: {
        worksiteId: d.worksiteId,
        title: d.title ?? null,
        startAt: d.startAt,
        endAt: d.endAt,
        allDay: d.allDay,
        teamId: d.teamId ?? null,
        vehicleId: d.vehicleId ?? null,
        materialsNote: d.materialsNote ?? null,
        note: d.note ?? null,
        createdById: req.user!.id,
        assignments: { create: d.personIds.map((personId) => ({ personId })) },
      },
    });
    await syncToGoogle(ev.id);
    res.status(201).json({ event: await withIncludes(ev.id) });
  }),
);

planningRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = planningEventInput.partial().parse(req.body);
    await prisma.planningEvent.update({
      where: { id: req.params.id },
      data: {
        worksiteId: d.worksiteId ?? undefined,
        title: d.title,
        startAt: d.startAt ?? undefined,
        endAt: d.endAt ?? undefined,
        allDay: d.allDay ?? undefined,
        teamId: d.teamId,
        vehicleId: d.vehicleId,
        materialsNote: d.materialsNote,
        note: d.note,
        ...(d.personIds
          ? { assignments: { deleteMany: {}, create: d.personIds.map((personId) => ({ personId })) } }
          : {}),
      },
    });
    await syncToGoogle(req.params.id!);
    res.json({ event: await withIncludes(req.params.id!) });
  }),
);

planningRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ev = await prisma.planningEvent.findUnique({ where: { id: req.params.id } });
    if (!ev) throw new HttpError(404, 'Événement introuvable');
    if (ev.googleEventId) await deleteEvent(ev.googleEventId);
    await prisma.planningEvent.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

async function withIncludes(id: string) {
  return prisma.planningEvent.findUnique({
    where: { id },
    include: {
      worksite: { select: { id: true, ref: true, title: true, city: true } },
      team: true,
      vehicle: true,
      assignments: { include: { person: { select: { id: true, displayName: true, firstName: true } } } },
    },
  });
}

// ── Équipes

export const teamsRouter = Router();

teamsRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.team.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { members: { include: { person: { select: { id: true, displayName: true, firstName: true } } } } },
    });
    res.json({ items });
  }),
);

teamsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = teamInput.parse(req.body);
    const team = await prisma.team.create({
      data: { name: d.name, color: d.color ?? null, members: { create: d.memberIds.map((personId) => ({ personId })) } },
    });
    res.status(201).json({ team });
  }),
);

teamsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = teamInput.partial().parse(req.body);
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: {
        name: d.name ?? undefined,
        color: d.color,
        ...(d.memberIds ? { members: { deleteMany: {}, create: d.memberIds.map((personId) => ({ personId })) } } : {}),
      },
    });
    res.json({ team });
  }),
);

// ── Véhicules (lecture — import Excel)

export const vehiclesRouter = Router();
attachPhotoRoutes(vehiclesRouter, (id, data) => prisma.vehicle.update({ where: { id }, data }));

vehiclesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.vehicle.findMany({
      orderBy: [{ status: 'asc' }, { brand: 'asc' }],
      include: {
        insurances: { take: 1 },
        _count: { select: { fines: true, payments: true } },
      },
    });
    res.json({ items });
  }),
);

vehiclesRouter.get(
  '/fines',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const unpaidOnly = req.query.unpaid === '1';
    const items = await prisma.fine.findMany({
      where: unpaidOnly ? { OR: [{ status: null }, { status: { not: 'Payé' } }] } : {},
      orderBy: { date: 'desc' },
      take: 500,
      include: { vehicle: { select: { id: true, brand: true, model: true, plate: true } } },
    });
    res.json({ items });
  }),
);

vehiclesRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const v = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: {
        insurances: true,
        fines: { orderBy: { date: 'desc' }, take: 50 },
        payments: { orderBy: { dueOn: 'asc' } },
      },
    });
    if (!v) throw new HttpError(404, 'Véhicule introuvable');
    res.json({ vehicle: v });
  }),
);
