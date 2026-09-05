import { Router } from 'express';
import { planningEventInput, teamInput, consumableInput, vehicleInput, vehicleCostPerKm } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { upsertEvent, deleteEvent, gcalEnabled } from '../lib/gcal.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';
import { vehicleCostBreakdown } from '../lib/vehicle-cost.js';

export const planningRouter = Router();

async function syncToGoogle(eventId: string) {
  const ev = await prisma.planningEvent.findUnique({
    where: { id: eventId },
    include: {
      worksite: { select: { ref: true, title: true, address: true, city: true } },
      team: { select: { name: true } },
      vehicle: { select: { plate: true, model: true } },
      assignments: { include: { person: { select: { displayName: true, firstName: true } } } },
      equipment: { include: { equipment: { select: { name: true } } } },
      consumables: { include: { consumable: { select: { name: true, unit: true } } } },
    },
  });
  if (!ev) return;
  const people = ev.assignments.map((a) => a.person.displayName || a.person.firstName).join(', ');
  const equipmentList = ev.equipment.map((e) => e.equipment.name).join(', ');
  const consumablesList = ev.consumables.map((c) => `${c.consumable.name} (${c.qty} ${c.consumable.unit})`).join(', ');
  const lines = [
    ev.team ? `Équipe : ${ev.team.name}` : null,
    people ? `Ouvriers : ${people}` : null,
    ev.vehicle ? `Véhicule : ${[ev.vehicle.plate, ev.vehicle.model].filter(Boolean).join(' ')}` : null,
    equipmentList ? `Matériel : ${equipmentList}` : null,
    consumablesList ? `Consommables : ${consumablesList}` : null,
    ev.materialsNote ? `Autre matériel : ${ev.materialsNote}` : null,
    ev.note ? `Instructions : ${ev.note}` : null,
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
        worksite: { select: { id: true, ref: true, title: true, city: true, address: true } },
        team: { select: { id: true, name: true, color: true } },
        vehicle: { select: { id: true, plate: true, model: true } },
        assignments: { include: { person: { select: { id: true, displayName: true, firstName: true, phone: true } } } },
        equipment: { include: { equipment: { select: { id: true, name: true } } } },
        consumables: { include: { consumable: { select: { id: true, name: true, unit: true } } } },
      },
    });
    res.json({ items, googleSync: gcalEnabled() });
  }),
);

planningRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const ev = await withIncludes(req.params.id!);
    if (!ev) throw new HttpError(404, 'Affectation introuvable');
    res.json({ event: ev });
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
        equipment: { create: d.equipmentIds.map((equipmentId) => ({ equipmentId })) },
        consumables: { create: d.consumables.map((c) => ({ consumableId: c.consumableId, qty: c.qty })) },
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
        ...(d.equipmentIds
          ? { equipment: { deleteMany: {}, create: d.equipmentIds.map((equipmentId) => ({ equipmentId })) } }
          : {}),
        ...(d.consumables
          ? { consumables: { deleteMany: {}, create: d.consumables.map((c) => ({ consumableId: c.consumableId, qty: c.qty })) } }
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

/** Fiche de chantier imprimable : tout ce qu'il faut donner à l'équipe. */
planningRouter.get(
  '/:id/fiche',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const ev = await prisma.planningEvent.findUnique({
      where: { id: req.params.id },
      include: {
        worksite: {
          select: {
            id: true,
            ref: true,
            title: true,
            description: true,
            address: true,
            postalCode: true,
            city: true,
            client: { select: { name: true, phone: true } },
            building: {
              select: {
                name: true,
                digicode: true,
                accessNote: true,
                contacts: { orderBy: { position: 'asc' }, select: { role: true, name: true, phone: true } },
              },
            },
            manager: { select: { displayName: true, firstName: true, phone: true } },
            tasks: {
              where: { status: { not: 'done' } },
              orderBy: { position: 'asc' },
              select: { id: true, title: true, assignee: { select: { displayName: true, firstName: true } } },
            },
          },
        },
        team: { select: { name: true } },
        vehicle: { select: { code: true, brand: true, model: true, plate: true } },
        assignments: {
          include: { person: { select: { displayName: true, firstName: true, role: true, phone: true } } },
        },
        equipment: { include: { equipment: { select: { name: true, reference: true } } } },
        consumables: { include: { consumable: { select: { name: true, unit: true } } } },
        createdBy: { select: { email: true } },
      },
    });
    if (!ev) throw new HttpError(404, 'Affectation introuvable');

    const w = ev.worksite;
    const address = [w.address, [w.postalCode, w.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

    res.json({
      fiche: {
        id: ev.id,
        title: ev.title,
        startAt: ev.startAt,
        endAt: ev.endAt,
        allDay: ev.allDay,
        instructions: ev.note,
        worksite: { id: w.id, ref: w.ref, title: w.title, description: w.description, address },
        client: w.client,
        building: w.building
          ? { name: w.building.name, digicode: w.building.digicode, accessNote: w.building.accessNote, contacts: w.building.contacts }
          : null,
        manager: w.manager ? { name: w.manager.displayName || w.manager.firstName, phone: w.manager.phone } : null,
        team: ev.team?.name ?? null,
        vehicle: ev.vehicle
          ? { label: [ev.vehicle.code, ev.vehicle.brand, ev.vehicle.model].filter(Boolean).join(' '), plate: ev.vehicle.plate }
          : null,
        people: ev.assignments.map((a) => ({
          name: a.person.displayName || a.person.firstName,
          role: a.person.role,
          phone: a.person.phone,
        })),
        equipment: ev.equipment.map((e) => ({ name: e.equipment.name, reference: e.equipment.reference })),
        consumables: ev.consumables.map((c) => ({ name: c.consumable.name, qty: c.qty, unit: c.consumable.unit })),
        tasks: w.tasks.map((t) => ({ title: t.title, assignee: t.assignee ? (t.assignee.displayName || t.assignee.firstName) : null })),
      },
    });
  }),
);

async function withIncludes(id: string) {
  return prisma.planningEvent.findUnique({
    where: { id },
    include: {
      worksite: { select: { id: true, ref: true, title: true, city: true, address: true } },
      team: true,
      vehicle: true,
      assignments: { include: { person: { select: { id: true, displayName: true, firstName: true, phone: true } } } },
      equipment: { include: { equipment: { select: { id: true, name: true } } } },
      consumables: { include: { consumable: { select: { id: true, name: true, unit: true } } } },
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
    const rows = await prisma.vehicle.findMany({
      orderBy: [{ status: 'asc' }, { brand: 'asc' }],
      include: {
        insurances: { take: 1 },
        _count: { select: { fines: true, payments: true } },
      },
    });
    res.json({ items: rows.map((v) => ({ ...v, costPerKm: vehicleCostPerKm(v) })) });
  }),
);

vehiclesRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = vehicleInput.partial().parse(req.body);
    const keys = [
      'brand', 'model', 'plate', 'type', 'fuel', 'vin', 'km', 'firstRegistration', 'nextInspection',
      'circulationTax', 'biv', 'driver', 'equipment', 'depot', 'status', 'note',
      'fuelConsoL100', 'fuelPricePerL', 'costPerKmExtra', 'parkingMonthly', 'otherMonthly',
    ] as const;
    const data: Record<string, unknown> = {};
    for (const k of keys) {
      if (!(k in d)) continue;
      if (k === 'status') { if (d.status) data.status = d.status; continue; } // colonne non nullable
      data[k] = d[k] ?? null;
    }
    await prisma.vehicle.update({ where: { id: req.params.id }, data });
    res.json({ vehicle: await withCost(req.params.id!) });
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

async function withCost(id: string) {
  const v = await prisma.vehicle.findUnique({ where: { id }, include: { insurances: true } });
  if (!v) throw new HttpError(404, 'Véhicule introuvable');
  return { ...v, costPerKm: vehicleCostPerKm(v), costBreakdown: await vehicleCostBreakdown(id) };
}

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
    res.json({ vehicle: { ...v, costPerKm: vehicleCostPerKm(v), costBreakdown: await vehicleCostBreakdown(v.id) } });
  }),
);

// ── Matériel (outillage réservable pour une affectation)

export const equipmentRouter = Router();

equipmentRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.equipment.findMany({ orderBy: { name: 'asc' } });
    res.json({ items });
  }),
);

equipmentRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Nom requis');
    const item = await prisma.equipment.create({
      data: { name, reference: req.body?.reference?.trim() || null },
    });
    res.status(201).json({ item });
  }),
);

// ── Consommables (catalogue + quantités par affectation)

export const consumablesRouter = Router();

consumablesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (_req, res) => {
    const items = await prisma.consumable.findMany({ orderBy: { name: 'asc' } });
    res.json({ items });
  }),
);

consumablesRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = consumableInput.parse(req.body);
    const item = await prisma.consumable.create({ data: { name: d.name, unit: d.unit, note: d.note ?? null } });
    res.status(201).json({ item });
  }),
);
