import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { timeEntryInput, timerStartInput, timerStopInput, round2, distanceMeters, DEFAULT_GEO_RADIUS, parseAmount, parseLooseDate } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { monthlyStatement, teamMonthlyStatement } from '../lib/statement.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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
    let geoInit = false;
    const hasPos = typeof d.lat === 'number' && typeof d.lng === 'number';
    if (hasPos && worksite) {
      if (worksite.lat == null || worksite.lng == null) {
        // 1er pointage sur place -> devient le point de référence du chantier
        await prisma.worksite.update({ where: { id: worksite.id }, data: { lat: d.lat!, lng: d.lng!, geoSetAt: new Date() } });
        geoInit = true;
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
    res.status(201).json({ entry, geoFlag, geoDistance, geoInit });
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
        // toujours "à valider", même saisi par le bureau -> passe par la même file de
        // validation qu'un pointage terrain, pas de raccourci auto-approuvé
        status: 'submitted',
        approvedById: null,
        source: 'manual',
      },
    });
    res.status(201).json({ entry });
  }),
);

const TIMESHEET_STATUS_LABEL: Record<string, string> = {
  running: 'En cours', submitted: 'À valider', approved: 'Validé', rejected: 'Refusé',
};

const TIMESHEET_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'date', label: 'Date' },
  { key: 'ouvrier', label: 'Ouvrier' },
  { key: 'chantier', label: 'Chantier' },
  { key: 'heures', label: 'Heures' },
  { key: 'montant', label: 'Montant' },
  { key: 'tache', label: 'Tâche' },
  { key: 'statut', label: 'Statut' },
  { key: 'note', label: 'Note' },
];

/** Export en CSV (éditable dans Excel) de tous les pointages sur une période. */
timesheetRouter.get(
  '/entries/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { from, to, personId, worksiteId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (personId) where.personId = personId;
    if (worksiteId) where.worksiteId = worksiteId;
    if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const items = await prisma.timeEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 5000,
      include: {
        person: { select: { displayName: true, firstName: true, lastName: true } },
        worksite: { select: { ref: true } },
      },
    });
    const rows = items.map((e) => ({
      id: e.id,
      date: e.date,
      ouvrier: e.person.displayName || `${e.person.firstName} ${e.person.lastName ?? ''}`.trim(),
      chantier: e.worksite?.ref ?? e.worksiteRef ?? '',
      heures: e.hours,
      montant: e.amount,
      tache: e.task ?? '',
      statut: TIMESHEET_STATUS_LABEL[e.status] ?? e.status,
      note: e.note ?? '',
    }));
    const csv = toCsv(TIMESHEET_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="horaires-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

/**
 * Réimporte un fichier (précédemment exporté puis corrigé dans Excel, ou nouveau).
 * Une ligne avec un `id` connu met à jour le pointage ; sans `id` (ou inconnu), un
 * nouveau pointage est créé. Comme la saisie manuelle, tout repasse par la file de
 * validation (jamais auto-approuvé) — la colonne « Statut » est informative, ignorée
 * à l'import. Une ligne absente du fichier n'est jamais supprimée.
 */
timesheetRouter.post(
  '/entries/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const rows = readTableBuffer(req.file.buffer, req.file.originalname);
    if (rows.length > 5000) throw new HttpError(422, 'Trop de lignes (5000 max)');

    let created = 0;
    let updated = 0;
    const warnings: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2;
      const id = pick(row, 'id');
      const date = parseLooseDate(pick(row, 'date'));
      if (!date) { warnings.push({ row: rowNum, message: 'Date manquante ou invalide — ligne ignorée' }); continue; }

      const ouvrierName = pick(row, 'ouvrier', 'nom');
      let personId: string | undefined;
      if (ouvrierName) {
        const p = await prisma.person.findFirst({
          where: { OR: [{ displayName: { equals: ouvrierName } }, { firstName: { equals: ouvrierName } }] },
        });
        if (p) personId = p.id;
      }
      if (!personId && !id) {
        const message = ouvrierName ? `Ouvrier « ${ouvrierName} » introuvable — ligne ignorée` : 'Ouvrier manquant et aucun id — ligne ignorée';
        warnings.push({ row: rowNum, message });
        continue;
      }

      const worksiteRef = pick(row, 'chantier', 'worksiteref');
      let worksiteId: string | null | undefined;
      if (worksiteRef) {
        const w = await prisma.worksite.findFirst({ where: { ref: worksiteRef } });
        if (w) worksiteId = w.id;
        else warnings.push({ row: rowNum, message: `Chantier « ${worksiteRef} » introuvable — non modifié` });
      }

      const hours = parseAmount(pick(row, 'heures'));
      const data: Record<string, unknown> = {
        date,
        ...(personId ? { personId } : {}),
        ...(worksiteId !== undefined ? { worksiteId } : {}),
        worksiteRef: worksiteRef || null,
        hours,
        amount: parseAmount(pick(row, 'montant')),
        task: pick(row, 'tache', 'tâche') || null,
        note: pick(row, 'note') || null,
        status: 'submitted',
        approvedById: null,
      };

      if (id) {
        const existing = await prisma.timeEntry.findUnique({ where: { id } });
        if (existing) {
          await prisma.timeEntry.update({ where: { id }, data });
          updated++;
          continue;
        }
        warnings.push({ row: rowNum, message: `id « ${id} » introuvable — ligne créée comme nouveau pointage` });
      }
      if (!personId) { warnings.push({ row: rowNum, message: 'Ouvrier introuvable — ligne ignorée' }); continue; }
      await prisma.timeEntry.create({ data: { ...data, personId, source: 'manual' } as Prisma.TimeEntryUncheckedCreateInput });
      created++;
    }

    res.json({ created, updated, warnings });
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

/** Valide en masse les pointages soumis (sauf ceux signalés « hors zone »). */
timesheetRouter.post(
  '/entries/approve-all',
  requireAuth('admin', 'office', 'foreman'),
  asyncHandler(async (req, res) => {
    const includeFlagged = req.body?.includeFlagged === true;
    const r = await prisma.timeEntry.updateMany({
      where: { status: 'submitted', ...(includeFlagged ? {} : { geoFlag: false }) },
      data: { status: 'approved', approvedById: req.user!.id },
    });
    res.json({ approved: r.count });
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
