import { Router } from 'express';
import { worksiteTaskInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

export const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, email: true, person: { select: { displayName: true, firstName: true } } } } },
  },
} as const;

interface TaskAssigneeUser { id: string; email: string; person: { displayName: string | null; firstName: string } | null }
interface RawTask { assignees: { user: TaskAssigneeUser }[]; [key: string]: unknown }

function assigneeLabel(u: TaskAssigneeUser): string {
  return u.person?.displayName || u.person?.firstName || u.email;
}

export function serializeTask(t: RawTask) {
  return { ...t, assignees: t.assignees.map((a) => ({ id: a.user.id, name: assigneeLabel(a.user) })) };
}

async function myName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Terrain';
}

async function setAssignees(taskId: string, userIds: string[]) {
  await prisma.taskAssignment.deleteMany({ where: { taskId } });
  if (userIds.length) await prisma.taskAssignment.createMany({ data: userIds.map((userId) => ({ taskId, userId })) });
}

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
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        dueOn: data.dueOn ?? null,
        position: count,
        createdById: req.user!.id,
        assignees: { create: data.assigneeIds.map((userId) => ({ userId })) },
      },
      include: taskInclude,
    });
    res.status(201).json({ task: serializeTask(task) });
  }),
);

/* -------------------------------------------------------- sous /api/tasks */

export const tasksRouter = Router();

/** `?mine=1` : mes tâches (chantier + générales) ; sinon : tâches générales (sans chantier). */
tasksRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const mine = req.query.mine === '1';
    const items = await prisma.worksiteTask.findMany({
      where: mine ? { assignees: { some: { userId: req.user!.id } } } : { worksiteId: null },
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
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        dueOn: data.dueOn ?? null,
        position: count,
        createdById: req.user!.id,
        assignees: { create: data.assigneeIds.map((userId) => ({ userId })) },
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
