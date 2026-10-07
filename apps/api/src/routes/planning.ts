import { Router } from 'express';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import multer from 'multer';
import { planningEventInput, teamInput, consumableInput, vehicleInput, vehicleDocInput, vehicleRepairInput, vehicleCostPerKm, absenceInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { upsertEvent, deleteEvent, gcalEnabled } from '../lib/gcal.js';
import { composeGcalEvent, composeGcalGroup } from '../lib/gcal-format.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';
import { vehicleCostBreakdown } from '../lib/vehicle-cost.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';

const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** Résout le chemin disque d'un fichier « /uploads/… » stocké par storeFile. */
function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

export const planningRouter = Router();

const SLOT_INCLUDE = {
  worksite: {
    select: {
      ref: true, title: true, address: true, box: true, postalCode: true, city: true,
      manager: { select: { displayName: true, firstName: true } },
      acp: { select: { digicode: true, accessNote: true } },
      contacts: { orderBy: { position: 'asc' as const }, select: { role: true, name: true, phone: true } },
    },
  },
  team: { select: { name: true } },
  vehicles: { include: { vehicle: { select: { plate: true, model: true, brand: true, code: true } }, driver: { select: { displayName: true, firstName: true } } } },
  assignments: { include: { person: { select: { displayName: true, firstName: true } } } },
  equipment: { include: { equipment: { select: { name: true } } } },
  consumables: { include: { consumable: { select: { name: true, unit: true } } } },
};

/** jour calendaire (AAAA-MM-JJ) à Bruxelles */
const brusselsDay = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(d);

/**
 * Pousse un créneau vers Google Agenda. Les interventions d'un même chantier le même jour (matin / après-midi, plusieurs équipes…)
 * ne forment qu'UNE fiche Google (voir syncGroup) ; les rendez-vous et les fiches importées de Google gardent la leur.
 * Renvoie l'id de la fiche Google qui représente ce créneau.
 */
async function syncToGoogle(eventId: string): Promise<string | null> {
  const head = await prisma.planningEvent.findUnique({ where: { id: eventId }, select: { worksiteId: true, startAt: true, kind: true, source: true } });
  if (!head) return null;
  if (head.kind !== 'intervention' || head.source) return syncSingle(eventId);
  return syncGroup(head.worksiteId, brusselsDay(head.startAt));
}

async function syncSingle(eventId: string): Promise<string | null> {
  const ev = await prisma.planningEvent.findUnique({ where: { id: eventId }, include: SLOT_INCLUDE });
  if (!ev) return null;
  // même présentation que les anciennes fiches Google Agenda (titre complet, blocs avec icônes) : voir lib/gcal-format.ts
  const { summary, description, location, colorId } = composeGcalEvent(ev);
  const gid = await upsertEvent(ev.googleEventId, { summary, description, location, colorId, start: ev.startAt, end: ev.endAt, allDay: ev.allDay });
  if (gid && gid !== ev.googleEventId) await prisma.planningEvent.update({ where: { id: ev.id }, data: { googleEventId: gid } });
  return gid;
}

/** Une fiche Google pour tous les créneaux d'intervention d'un chantier un jour donné ; les anciennes fiches en double sont supprimées. */
async function syncGroup(worksiteId: string, day: string): Promise<string | null> {
  const d0 = new Date(`${day}T00:00:00Z`).getTime();
  const near = await prisma.planningEvent.findMany({
    where: { worksiteId, kind: 'intervention', source: null, startAt: { gte: new Date(d0 - 86400000), lt: new Date(d0 + 2 * 86400000) } },
    include: SLOT_INCLUDE,
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
  });
  const slots = near.filter((s) => brusselsDay(s.startAt) === day);
  if (slots.length === 0) return null;
  // la fiche Google déjà existante est conservée (le premier créneau qui en a une), sinon on en crée une
  const primary = slots.find((s) => s.googleEventId) ?? slots[0]!;
  const merged = composeGcalGroup(slots);
  const gid = await upsertEvent(primary.googleEventId, {
    summary: merged.summary, description: merged.description, location: merged.location, colorId: merged.colorId,
    start: merged.start, end: merged.end, allDay: merged.allDay,
  });
  for (const s of slots) {
    if (s.id === primary.id || !s.googleEventId) continue;
    await deleteEvent(s.googleEventId);
    await prisma.planningEvent.update({ where: { id: s.id }, data: { googleEventId: null } });
  }
  if (gid && gid !== primary.googleEventId) await prisma.planningEvent.update({ where: { id: primary.id }, data: { googleEventId: gid } });
  return gid;
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
        worksite: { select: { id: true, ref: true, title: true, city: true, address: true, box: true, postalCode: true, acp: { select: { photoThumbUrl: true } } } },
        team: { select: { id: true, name: true, color: true } },
        vehicles: {
          include: {
            vehicle: { select: { id: true, plate: true, model: true, brand: true, code: true, seats: true } },
            driver: { select: { id: true, displayName: true, firstName: true } },
          },
        },
        assignments: { include: { person: { select: { id: true, displayName: true, firstName: true, phone: true } } } },
        equipment: { include: { equipment: { select: { id: true, name: true } } } },
        consumables: { include: { consumable: { select: { id: true, name: true, unit: true } } } },
        leadPerson: { select: { id: true, displayName: true, firstName: true } },
        driverPerson: { select: { id: true, displayName: true, firstName: true } },
      },
    });
    res.json({ items, googleSync: gcalEnabled() });
  }),
);

/**
 * Rattrapage historique : pousse vers Google Agenda les événements jamais synchronisés
 * (googleEventId encore vide) — typiquement tout ce qui a été créé avant l'activation de la
 * synchro. Ne touche JAMAIS un événement déjà synchronisé (googleEventId déjà posé) : si
 * quelqu'un a corrigé l'horaire ou ajouté un invité directement dans Google Agenda, ce
 * rattrapage ne l'écrase pas — seule une modification faite depuis l'appli le fait (voir
 * syncToGoogle, appelé sur chaque création/modification normale).
 */
planningRouter.post(
  '/gcal-backfill',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    if (!gcalEnabled()) throw new HttpError(422, 'Synchro Google Agenda non configurée');
    // ?reformat=1 : réécrit dans la nouvelle présentation les événements À VENIR déjà envoyés depuis l'appli. Jamais les événements
    // importés de Google (source « agenda-import » : fiches faites à la main) ni ceux du passé.
    const reformat = (req.query as Record<string, string>).reformat === '1';
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const missing = await prisma.planningEvent.findMany({
      where: reformat ? { googleEventId: { not: null }, source: null, startAt: { gte: startOfToday } } : { googleEventId: null },
      select: { id: true, worksiteId: true, startAt: true, kind: true, source: true },
    });
    let synced = 0;
    const errors: string[] = [];
    // les interventions d'un même chantier le même jour partagent une seule fiche Google : on ne la traite qu'une fois
    const done = new Set<string>();
    for (const ev of missing) {
      const key = ev.kind === 'intervention' && !ev.source ? `${ev.worksiteId}|${brusselsDay(ev.startAt)}` : ev.id;
      if (done.has(key)) { synced++; continue; }
      done.add(key);
      try {
        if (await syncToGoogle(ev.id)) synced++;
        else errors.push(`${ev.id} : échec silencieux (voir logs serveur)`);
      } catch (e) {
        errors.push(`${ev.id} : ${(e as Error).message}`);
      }
    }
    res.json({ total: missing.length, synced, errors });
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
        status: d.status,
        kind: d.kind,
        teamId: d.teamId ?? null,
        leadPersonId: d.leadPersonId ?? null,
        driverPersonId: d.driverPersonId ?? null,
        departureAt: d.departureAt ?? null,
        departureFrom: d.departureFrom ?? null,
        meetingOnSite: d.meetingOnSite,
        meetingAddress: d.meetingAddress ?? null,
        meetingBox: d.meetingBox ?? null,
        meetingPostalCode: d.meetingPostalCode ?? null,
        meetingCity: d.meetingCity ?? null,
        tasksNote: d.tasksNote ?? null,
        accessNote: d.accessNote ?? null,
        materialsNote: d.materialsNote ?? null,
        note: d.note ?? null,
        createdById: req.user!.id,
        assignments: { create: d.personIds.map((personId) => ({ personId })) },
        equipment: { create: d.equipmentIds.map((equipmentId) => ({ equipmentId })) },
        consumables: { create: d.consumables.map((c) => ({ consumableId: c.consumableId, qty: c.qty })) },
        vehicles: { create: d.vehicles.map((v) => ({ vehicleId: v.vehicleId, driverPersonId: v.driverPersonId ?? null })) },
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
    const before = await prisma.planningEvent.findUnique({ where: { id: req.params.id }, select: { worksiteId: true, startAt: true, kind: true, source: true } });
    await prisma.planningEvent.update({
      where: { id: req.params.id },
      data: {
        worksiteId: d.worksiteId ?? undefined,
        title: d.title,
        startAt: d.startAt ?? undefined,
        endAt: d.endAt ?? undefined,
        allDay: d.allDay ?? undefined,
        status: d.status ?? undefined,
        kind: d.kind ?? undefined,
        teamId: d.teamId,
        leadPersonId: d.leadPersonId,
        driverPersonId: d.driverPersonId,
        departureAt: d.departureAt,
        departureFrom: d.departureFrom,
        meetingOnSite: d.meetingOnSite ?? undefined,
        meetingAddress: d.meetingAddress,
        meetingBox: d.meetingBox,
        meetingPostalCode: d.meetingPostalCode,
        meetingCity: d.meetingCity,
        tasksNote: d.tasksNote,
        accessNote: d.accessNote,
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
        ...(d.vehicles
          ? { vehicles: { deleteMany: {}, create: d.vehicles.map((v) => ({ vehicleId: v.vehicleId, driverPersonId: v.driverPersonId ?? null })) } }
          : {}),
      },
    });
    await syncToGoogle(req.params.id!);
    // créneau déplacé vers un autre jour / chantier, ou changé de nature : la fiche Google qu'il quitte doit être recalculée
    if (before && before.kind === 'intervention' && !before.source) {
      const after = await prisma.planningEvent.findUnique({ where: { id: req.params.id }, select: { worksiteId: true, startAt: true, kind: true } });
      if (after && (after.worksiteId !== before.worksiteId || after.kind !== before.kind || brusselsDay(after.startAt) !== brusselsDay(before.startAt))) {
        await syncGroup(before.worksiteId, brusselsDay(before.startAt));
      }
    }
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
    // il reste peut-être d'autres créneaux ce jour-là sur ce chantier : la fiche Google commune est recalculée
    if (ev.kind === 'intervention' && !ev.source) await syncGroup(ev.worksiteId, brusselsDay(ev.startAt));
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
            acp: {
              select: {
                name: true,
                digicode: true,
                accessNote: true,
                acpKeyContacts: { orderBy: { position: 'asc' }, select: { role: true, name: true, phone: true } },
              },
            },
            manager: { select: { displayName: true, firstName: true, phone: true } },
            tasks: {
              where: { status: { not: 'done' } },
              orderBy: { position: 'asc' },
              select: {
                id: true, title: true, dueOn: true,
                assignee: { select: { displayName: true, firstName: true } }, // ancien champ (une seule personne)
                assignees: { select: { person: { select: { displayName: true, firstName: true } } } }, // responsables (plusieurs)
              },
            },
          },
        },
        team: { select: { name: true } },
        vehicles: { include: { vehicle: { select: { code: true, brand: true, model: true, plate: true } } } },
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
        // ce qui est saisi sur le créneau lui-même (formulaire d'affectation) : jusqu'ici absent de la fiche imprimée
        tasksNote: ev.tasksNote,
        accessNote: ev.accessNote,
        materialsNote: ev.materialsNote,
        departure: ev.departureAt || ev.departureFrom ? { at: ev.departureAt, from: ev.departureFrom } : null,
        worksite: { id: w.id, ref: w.ref, title: w.title, description: w.description, address },
        client: w.client,
        building: w.acp
          ? { name: w.acp.name, digicode: w.acp.digicode, accessNote: w.acp.accessNote, contacts: w.acp.acpKeyContacts }
          : null,
        manager: w.manager ? { name: w.manager.displayName || w.manager.firstName, phone: w.manager.phone } : null,
        team: ev.team?.name ?? null,
        vehicles: ev.vehicles.map((v) => ({
          label: v.vehicle.model || v.vehicle.brand || v.vehicle.plate || v.vehicle.code || 'Véhicule', plate: v.vehicle.plate,
        })),
        people: ev.assignments.map((a) => ({
          name: a.person.displayName || a.person.firstName,
          role: a.person.role,
          phone: a.person.phone,
        })),
        equipment: ev.equipment.map((e) => ({ name: e.equipment.name, reference: e.equipment.reference })),
        consumables: ev.consumables.map((c) => ({ name: c.consumable.name, qty: c.qty, unit: c.consumable.unit })),
        tasks: w.tasks.map((t) => {
          const names = t.assignees.map((a) => a.person.displayName || a.person.firstName);
          if (!names.length && t.assignee) names.push(t.assignee.displayName || t.assignee.firstName);
          return { title: t.title, assignee: names.length ? names.join(', ') : null, dueOn: t.dueOn };
        }),
      },
    });
  }),
);

async function withIncludes(id: string) {
  return prisma.planningEvent.findUnique({
    where: { id },
    include: {
      worksite: { select: { id: true, ref: true, title: true, city: true, address: true, box: true, postalCode: true } },
      team: true,
      vehicles: { include: { vehicle: true, driver: { select: { id: true, displayName: true, firstName: true } } } },
      assignments: { include: { person: { select: { id: true, displayName: true, firstName: true, phone: true } } } },
      equipment: { include: { equipment: { select: { id: true, name: true } } } },
      consumables: { include: { consumable: { select: { id: true, name: true, unit: true } } } },
      leadPerson: { select: { id: true, displayName: true, firstName: true } },
      driverPerson: { select: { id: true, displayName: true, firstName: true } },
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

vehiclesRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = vehicleInput.parse(req.body);
    if (d.code && (await prisma.vehicle.findUnique({ where: { code: d.code } }))) {
      throw new HttpError(409, `Le code "${d.code}" est déjà utilisé par un autre véhicule.`);
    }
    const vehicle = await prisma.vehicle.create({
      data: { ...d, status: d.status ?? 'active', excludedFromPlanning: !!d.excludedFromPlanning, source: 'manual' },
    });
    res.status(201).json({ vehicle: await withCost(vehicle.id) });
  }),
);

vehiclesRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = vehicleInput.partial().parse(req.body);
    const keys = [
      'code', 'brand', 'model', 'plate', 'type', 'seats', 'fuel', 'vin', 'km', 'firstRegistration', 'nextInspection',
      'circulationTax', 'biv', 'driver', 'equipment', 'depot', 'status', 'excludedFromPlanning', 'note',
      'fuelConsoL100', 'fuelPricePerL', 'costPerKmExtra', 'parkingMonthly', 'otherMonthly',
    ] as const;
    const data: Record<string, unknown> = {};
    for (const k of keys) {
      if (!(k in d)) continue;
      if (k === 'status') { if (d.status) data.status = d.status; continue; } // colonne non nullable
      if (k === 'excludedFromPlanning') { data.excludedFromPlanning = !!d.excludedFromPlanning; continue; } // colonne non nullable
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
      include: { vehicle: { select: { id: true, brand: true, model: true, plate: true, photoThumbUrl: true } } },
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
        docs: { orderBy: [{ expiresOn: 'asc' }, { createdAt: 'desc' }] },
        repairs: { include: { ledgerEntry: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] },
        // factures/dépenses liées (réparations facturées par un garage, pièces…) — la preuve
        // (PDF) et l'extraction automatique vivent déjà côté Achats, pas dupliquées ici.
        ledgerEntries: {
          where: { direction: { in: ['purchase', 'credit_note'] } },
          orderBy: { date: 'desc' },
          select: { id: true, date: true, docNumber: true, supplierName: true, ht: true, ttc: true, pdfPath: true, categoryRaw: true },
        },
      },
    });
    if (!v) throw new HttpError(404, 'Véhicule introuvable');
    res.json({ vehicle: { ...v, ledgerEntries: [...new Map([...v.ledgerEntries, ...v.repairs.flatMap(r => r.ledgerEntry ? [r.ledgerEntry] : [])].map(e => [e.id, e])).values()], costPerKm: vehicleCostPerKm(v), costBreakdown: await vehicleCostBreakdown(v.id) } });
  }),
);

/* ---------------------------------------------------- documents véhicule */

vehiclesRouter.post(
  '/:id/docs',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = vehicleDocInput.parse({ ...req.body, vehicleId: req.params.id });
    const doc = await prisma.vehicleDoc.create({ data });
    res.status(201).json({ doc });
  }),
);

vehiclesRouter.delete(
  '/:id/docs/:docId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.vehicleDoc.delete({ where: { id: req.params.docId } });
    res.status(204).end();
  }),
);

/** Joint le scan/photo du document (PDF ou image). */
vehiclesRouter.post(
  '/:id/docs/:docId/file',
  requireAuth(...OFFICE),
  docUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const okType = req.file.mimetype === 'application/pdf' || /^image\/(jpe?g|png|webp|heic)$/.test(req.file.mimetype);
    if (!okType) throw new HttpError(422, 'Format accepté : PDF ou image.');
    const doc = await prisma.vehicleDoc.findFirst({ where: { id: req.params.docId, vehicleId: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const rel = storeFile(req.file.buffer, req.file.originalname || 'document.pdf', 'vehicle-docs');
    const updated = await prisma.vehicleDoc.update({ where: { id: doc.id }, data: { fileUrl: rel } });
    res.status(201).json({ doc: updated });
  }),
);

vehiclesRouter.get(
  '/:id/docs/:docId/file',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const doc = await prisma.vehicleDoc.findFirst({ where: { id: req.params.docId, vehicleId: req.params.id } });
    if (!doc?.fileUrl) throw new HttpError(404, 'Aucune pièce jointe');
    const file = resolveUpload(doc.fileUrl);
    if (!existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename="${(doc.label ?? doc.type).replace(/[^\w.-]/g, '_')}${ext}"`);
    createReadStream(file).pipe(res);
  }),
);

/* ---------------------------------------------------- réparations véhicule (garage, hors coûts fixes) */

async function validateRepairInvoice(ledgerEntryId: string | null | undefined, vehicleId: string) {
  if (!ledgerEntryId) return;
  const entry = await prisma.ledgerEntry.findUnique({ where: { id: ledgerEntryId } });
  if (!entry || entry.direction !== 'purchase') throw new HttpError(400, 'Sélectionnez une facture d’achat valide.');
  if (entry.vehicleId && entry.vehicleId !== vehicleId) throw new HttpError(400, 'Cette facture est affectée à un autre véhicule.');
}

vehiclesRouter.post(
  '/:id/repairs',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = vehicleRepairInput.parse({ ...req.body, vehicleId: req.params.id });
    await validateRepairInvoice(data.ledgerEntryId, req.params.id!);
    const repair = await prisma.vehicleRepair.create({ data });
    res.status(201).json({ repair });
  }),
);

vehiclesRouter.patch(
  '/:id/repairs/:repairId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = vehicleRepairInput.omit({ vehicleId: true }).partial().parse(req.body);
    await validateRepairInvoice(data.ledgerEntryId, req.params.id!);
    const repair = await prisma.vehicleRepair.update({
      where: { id: req.params.repairId, vehicleId: req.params.id },
      data,
    });
    res.json({ repair });
  }),
);

vehiclesRouter.delete(
  '/:id/repairs/:repairId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.vehicleRepair.delete({ where: { id: req.params.repairId } });
    res.status(204).end();
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
    const reference = req.body?.reference?.trim() || null;
    // dédoublonne par nom (le même outil Bricoloc peut être re-sélectionné)
    const existing = await prisma.equipment.findFirst({ where: { name: { equals: name } } });
    const item = existing
      ? (reference && !existing.reference
          ? await prisma.equipment.update({ where: { id: existing.id }, data: { reference } })
          : existing)
      : await prisma.equipment.create({ data: { name, reference } });
    res.status(existing ? 200 : 201).json({ item });
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
    const existing = await prisma.consumable.findFirst({ where: { name: { equals: d.name } } });
    const item = existing ?? await prisma.consumable.create({ data: { name: d.name, unit: d.unit, note: d.note ?? null } });
    res.status(existing ? 200 : 201).json({ item });
  }),
);

// ── Absences (congés, formations…) — bloquent l'affectation de la personne sur la période

export const absencesRouter = Router();

absencesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (from || to) {
      where.AND = [
        from ? { endsOn: { gte: new Date(from) } } : {},
        to ? { startsOn: { lte: new Date(to) } } : {},
      ];
    }
    const items = await prisma.absence.findMany({
      where,
      orderBy: { startsOn: 'asc' },
      include: { person: { select: { id: true, displayName: true, firstName: true } } },
    });
    res.json({ items });
  }),
);

absencesRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = absenceInput.parse(req.body);
    const absence = await prisma.absence.create({
      data: { personId: d.personId, kind: d.kind, startsOn: d.startsOn, endsOn: d.endsOn, note: d.note ?? null },
    });
    res.status(201).json({ absence });
  }),
);

absencesRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = absenceInput.partial().parse(req.body);
    const absence = await prisma.absence.update({
      where: { id: req.params.id },
      data: {
        personId: d.personId ?? undefined,
        kind: d.kind ?? undefined,
        startsOn: d.startsOn ?? undefined,
        endsOn: d.endsOn ?? undefined,
        note: d.note,
      },
    });
    res.json({ absence });
  }),
);

absencesRouter.delete(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    await prisma.absence.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
