import { Router } from 'express';
import { worksiteTaskInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';

const taskInclude = {
  assignee: { select: { id: true, displayName: true, firstName: true } },
} as const;

async function myName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
  return u?.person?.displayName || u?.person?.firstName || u?.email || 'Terrain';
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
    res.json({ items });
  }),
);

worksiteTasksRouter.post(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const worksiteId = req.params.worksiteId as string;
    const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const data = worksiteTaskInput.parse(req.body);
    const count = await prisma.worksiteTask.count({ where: { worksiteId } });
    const task = await prisma.worksiteTask.create({
      data: {
        worksiteId,
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        assigneeId: data.assigneeId ?? null,
        dueOn: data.dueOn ?? null,
        position: count,
        createdById: req.user!.id,
      },
      include: taskInclude,
    });
    res.status(201).json({ task });
  }),
);

/* -------------------------------------------------------- sous /api/tasks/:id */

export const tasksRouter = Router();

tasksRouter.patch(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const existing = await prisma.worksiteTask.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Tâche introuvable');
    const data = worksiteTaskInput.partial().parse(req.body);
    const becomesDone = data.status === 'done' && existing.status !== 'done';
    const leavesDone = data.status && data.status !== 'done' && existing.status === 'done';
    const task = await prisma.worksiteTask.update({
      where: { id: existing.id },
      data: {
        title: data.title ?? undefined,
        description: data.description === undefined ? undefined : data.description,
        status: data.status ?? undefined,
        assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
        dueOn: data.dueOn === undefined ? undefined : data.dueOn,
        doneAt: becomesDone ? new Date() : leavesDone ? null : undefined,
        doneByName: becomesDone ? await myName(req.user!.id) : leavesDone ? null : undefined,
      },
      include: taskInclude,
    });
    res.json({ task });
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
