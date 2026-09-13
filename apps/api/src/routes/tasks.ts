import { Router } from 'express';
import { worksiteTaskInput, taskPhaseInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

export const taskInclude = {
  assignees: {
    include: { person: { select: { id: true, displayName: true, firstName: true } } },
  },
} as const;

interface TaskAssigneePerson { id: string; displayName: string | null; firstName: string }
interface RawTask { assignees: { person: TaskAssigneePerson }[]; [key: string]: unknown }

function assigneeLabel(p: TaskAssigneePerson): string {
  return p.displayName || p.firstName;
}

export function serializeTask(t: RawTask) {
  return { ...t, assignees: t.assignees.map((a) => ({ id: a.person.id, name: assigneeLabel(a.person) })) };
}

async function myName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Terrain';
}

async function setAssignees(taskId: string, personIds: string[]) {
  await prisma.taskAssignment.deleteMany({ where: { taskId } });
  if (personIds.length) await prisma.taskAssignment.createMany({ data: personIds.map((personId) => ({ taskId, personId })) });
}

/* ------------------------------------- sous /api/worksites/:worksiteId/phases */

export const worksitePhasesRouter = Router({ mergeParams: true });

worksitePhasesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const items = await prisma.worksiteTaskPhase.findMany({
      where: { worksiteId: req.params.worksiteId },
      orderBy: { position: 'asc' },
    });
    res.json({ items });
  }),
);

worksitePhasesRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId as string;
    const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const data = taskPhaseInput.parse(req.body);
    const count = await prisma.worksiteTaskPhase.count({ where: { worksiteId } });
    const phase = await prisma.worksiteTaskPhase.create({ data: { worksiteId, name: data.name, position: count } });
    res.status(201).json({ phase });
  }),
);

export const phasesRouter = Router();

phasesRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const data = taskPhaseInput.partial().parse(req.body);
    const phase = await prisma.worksiteTaskPhase.update({ where: { id: req.params.id }, data: { name: data.name ?? undefined } });
    res.json({ phase });
  }),
);

phasesRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.worksiteTaskPhase.deleteMany({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

/* --------------------------------------- sous /api/worksites/:worksiteId/tasks */

export const worksiteTasksRouter = Router({ mergeParams: true });

worksiteTasksRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const items = await prisma.worksiteTask.findMany({
      where: { worksiteId: req.params.worksiteId },
      orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      include: taskInclude,
    });
    res.json({ items: items.map(serializeTask) });
  }),
);

worksiteTasksRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId as string;
    const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const data = worksiteTaskInput.parse({ ...req.body, worksiteId });
    const count = await prisma.worksiteTask.count({ where: { worksiteId } });
    const task = await prisma.worksiteTask.create({
      data: {
        worksiteId,
        phaseId: data.phaseId ?? null,
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        dueOn: data.dueOn ?? null,
        position: count,
        createdById: req.user!.id,
        assignees: { create: data.assigneeIds.map((personId) => ({ personId })) },
      },
      include: taskInclude,
    });
    res.status(201).json({ task: serializeTask(task) });
  }),
);

/* -------------------------------------------------------- sous /api/tasks */

export const tasksRouter = Router();

/**
 * Vue globale (chantier + générales), façon TrustUp. `?mine=1` restreint à mes tâches ;
 * `?view=today|week|overdue` restreint par échéance (combinable avec `mine`) ; sans
 * paramètre, retourne tout.
 */
tasksRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { mine, view } = req.query as Record<string, string>;
    const and: Record<string, unknown>[] = [];
    if (mine === '1') and.push({ assignees: { some: { personId: req.user!.personId ?? '__none__' } } });
    if (view === 'today' || view === 'week' || view === 'overdue') {
      const now = new Date();
      const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (view === 'overdue') {
        and.push({ dueOn: { lt: d0 }, status: { not: 'done' } });
      } else {
        const d1 = new Date(d0);
        d1.setDate(d1.getDate() + (view === 'today' ? 1 : 7));
        and.push({ dueOn: { gte: d0, lt: d1 } });
      }
    }
    const items = await prisma.worksiteTask.findMany({
      where: and.length ? { AND: and } : undefined,
      orderBy: [{ status: 'asc' }, { dueOn: 'asc' }, { createdAt: 'asc' }],
      include: { ...taskInclude, worksite: { select: { id: true, ref: true, title: true } } },
    });
    res.json({ items: items.map(serializeTask) });
  }),
);

tasksRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const data = worksiteTaskInput.parse(req.body);
    if (data.worksiteId) {
      const ws = await prisma.worksite.findUnique({ where: { id: data.worksiteId } });
      if (!ws) throw new HttpError(404, 'Chantier introuvable');
    }
    const count = await prisma.worksiteTask.count({ where: { worksiteId: data.worksiteId ?? null } });
    const task = await prisma.worksiteTask.create({
      data: {
        worksiteId: data.worksiteId ?? null,
        phaseId: data.worksiteId ? (data.phaseId ?? null) : null,
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        dueOn: data.dueOn ?? null,
        position: count,
        createdById: req.user!.id,
        assignees: { create: data.assigneeIds.map((personId) => ({ personId })) },
      },
      include: taskInclude,
    });
    res.status(201).json({ task: serializeTask(task) });
  }),
);

tasksRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const existing = await prisma.worksiteTask.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Tâche introuvable');
    const data = worksiteTaskInput.partial().parse(req.body);
    const becomesDone = data.status === 'done' && existing.status !== 'done';
    const leavesDone = data.status && data.status !== 'done' && existing.status === 'done';
    if (data.assigneeIds !== undefined) await setAssignees(existing.id, data.assigneeIds);
    const task = await prisma.worksiteTask.update({
      where: { id: existing.id },
      data: {
        title: data.title ?? undefined,
        description: data.description === undefined ? undefined : data.description,
        status: data.status ?? undefined,
        phaseId: data.phaseId === undefined ? undefined : data.phaseId,
        dueOn: data.dueOn === undefined ? undefined : data.dueOn,
        doneAt: becomesDone ? new Date() : leavesDone ? null : undefined,
        doneByName: becomesDone ? await myName(req.user!.id) : leavesDone ? null : undefined,
      },
      include: taskInclude,
    });
    res.json({ task: serializeTask(task) });
  }),
);

tasksRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.worksiteTask.deleteMany({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);
