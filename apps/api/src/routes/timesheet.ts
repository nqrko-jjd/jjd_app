import { Router } from 'express';
import { timeEntryInput, timerStartInput, timerStopInput, round2, distanceMeters, DEFAULT_GEO_RADIUS } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { monthlyStatement, teamMonthlyStatement } from '../lib/statement.js';

export const timesheetRouter = Router();

/** Qui suis-je côté "personne" (compte ouvrier lié à une fiche). */
function myPersonId(req: { user?: { personId: string | null } }): string {
  const id = req.user?.personId;
  if (!id) throw new HttpError(403, 'Ton compte n’est pas encore lié à une fiche personne. Demande au bureau.');
  return id;
}

/** Le compteur en cours de l'ouvrier connecté (null si pas de fiche liée). */
timesheetRouter.get(
  '/timer',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    if (!req.user?.personId) {
      res.json({ running: null, linked: false });
      return;
    }
    const running = await prisma.timeEntry.findFirst({
      where: { personId: req.user.personId, status: 'running' },
      include: { worksite: { select: { ref: true, title: true } } },
    });
    res.json({ running, linked: true });
  }),
);

timesheetRouter.post(
  '/timer/start',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = timerStartInput.parse(req.body);
    const personId = myPersonId(req);
    const existing = await prisma.timeEntry.findFirst({ where: { personId, status: 'running' } });
    if (existing) throw new HttpError(409, 'Un compteur tourne déjà');
    const person = await prisma.person.findUnique({ where: { id: personId } });
    const worksite = await prisma.worksite.findUnique({ where: { id: d.worksiteId }, select: { id: true, lat: true, lng: true } });

    // géolocalisation (mode souple : jamais bloquant, juste signalé)
    let geoDistance: number | null = null;
    let geoFlag = false;
    const hasPos = typeof d.lat === 'number' && typeof d.lng === 'number';
    if (hasPos && worksite) {
      if (worksite.lat == null || worksite.lng == null) {
        // 1er pointage sur place -> devient le point de référence du chantier
        await prisma.worksite.update({ where: { id: worksite.id }, data: { lat: d.lat!, lng: d.lng!, geoSetAt: new Date() } });
      } else {
        geoDistance = distanceMeters(worksite.lat, worksite.lng, d.lat!, d.lng!);
        const row = await prisma.setting.findUnique({ where: { key: 'geoRadius' } });
        const radius = Number((row?.value as { m?: number })?.m) || DEFAULT_GEO_RADIUS;
        geoFlag = geoDistance > radius;
      }
    }

    const entry = await prisma.timeEntry.create({
      data: {
        personId,
        worksiteId: d.worksiteId,
        startedAt: d.startedAt ?? new Date(),
        date: d.startedAt ?? new Date(),
        task: d.task ?? null,
        rateUsed: person?.hourlyRate ?? null,
        startLat: hasPos ? d.lat : null,
        startLng: hasPos ? d.lng : null,
        geoDistance,
        geoFlag,
        status: 'running',
        source: 'timer',
      },
    });
    res.status(201).json({ entry, geoFlag, geoDistance });
  }),
);

timesheetRouter.post(
  '/timer/stop',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = timerStopInput.parse(req.body);
    const personId = myPersonId(req);
    const running = await prisma.timeEntry.findFirst({ where: { personId, status: 'running' } });
    if (!running) throw new HttpError(404, 'Aucun compteur en cours');
    const end = d.endedAt ?? new Date();
    const started = running.startedAt ?? end;
    const hours = round2(Math.max(0, (end.getTime() - started.getTime()) / 3_600_000));
    const rate = running.rateUsed ?? 0;
    const entry = await prisma.timeEntry.update({
      where: { id: running.id },
      data: {
        endedAt: end,
        hours,
        amount: rate ? round2(hours * rate) : null,
        note: d.note ?? running.note,
        status: 'submitted',
      },
    });
    res.json({ entry });
  }),
);

/** Mes pointages (ouvrier) — sur une période. */
timesheetRouter.get(
  '/mine',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    if (!req.user?.personId) {
      res.json({ items: [], linked: false });
      return;
    }
    const { from, to } = req.query as Record<string, string>;
    const items = await prisma.timeEntry.findMany({
      where: {
        personId: req.user.personId,
        date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) },
      },
      orderBy: { date: 'desc' },
      include: { worksite: { select: { ref: true, title: true } } },
      take: 200,
    });
    res.json({ items });
  }),
);

/** Saisie / correction manuelle (bureau, chef). */
timesheetRouter.post(
  '/entries',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const d = timeEntryInput.parse(req.body);
    const person = await prisma.person.findUnique({ where: { id: d.personId } });
    const rate = person?.hourlyRate ?? null;
    const entry = await prisma.timeEntry.create({
      data: {
        personId: d.personId,
        worksiteId: d.worksiteId ?? null,
        date: d.date,
        hours: d.hours ?? null,
        amount: d.amount ?? (d.hours && rate ? round2(d.hours * rate) : null),
        rateUsed: rate,
        task: d.task ?? null,
        note: d.note ?? null,
        status: req.user!.role === 'worker' ? 'submitted' : 'approved',
        approvedById: req.user!.role === 'worker' ? null : req.user!.id,
        source: 'manual',
      },
    });
    res.status(201).json({ entry });
  }),
);

/** File de validation (chef / bureau). */
timesheetRouter.get(
  '/pending',
  requireAuth('admin', 'office', 'foreman'),
  asyncHandler(async (_req, res) => {
    const items = await prisma.timeEntry.findMany({
      where: { status: 'submitted' },
      orderBy: { date: 'asc' },
      include: {
        person: { select: { displayName: true, firstName: true } },
        worksite: { select: { ref: true, title: true } },
      },
      take: 300,
    });
    res.json({ items });
  }),
);

timesheetRouter.post(
  '/entries/:id/approve',
  requireAuth('admin', 'office', 'foreman'),
  asyncHandler(async (req, res) => {
    const entry = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: { status: 'approved', approvedById: req.user!.id },
    });
    res.json({ entry });
  }),
);

timesheetRouter.post(
  '/entries/:id/reject',
  requireAuth('admin', 'office', 'foreman'),
  asyncHandler(async (req, res) => {
    const entry = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: { status: 'rejected', approvedById: req.user!.id, note: req.body.note ?? undefined },
    });
    res.json({ entry });
  }),
);

timesheetRouter.patch(
  '/entries/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = timeEntryInput.partial().parse(req.body);
    const entry = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: { hours: d.hours ?? undefined, amount: d.amount ?? undefined, task: d.task, note: d.note, worksiteId: d.worksiteId },
    });
    res.json({ entry });
  }),
);

// ── Décomptes mensuels

export const statementsRouter = Router();

statementsRouter.get(
  '/:personId',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const year = Number(req.query.year ?? now.getFullYear());
    const month = Number(req.query.month ?? now.getMonth() + 1);
    res.json(await monthlyStatement(req.params.personId!, year, month));
  }),
);

statementsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const year = Number(req.query.year ?? now.getFullYear());
    const month = Number(req.query.month ?? now.getMonth() + 1);
    res.json(await teamMonthlyStatement(year, month));
  }),
);
