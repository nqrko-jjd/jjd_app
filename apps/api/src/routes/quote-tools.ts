import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { estimateLots, scheduleLots, brusselsToDate, nextWorkingDay, isWorkingDay, DEFAULT_PLAN, type QuoteLine } from '../lib/quote-plan.js';

/** Outils « depuis un devis » : planning prévisionnel selon le budget (la liste d'achats est dans purchase-lists.ts). */
export const quoteToolsRouter = Router();

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const paramsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  teamSize: z.number().int().min(1).max(20).default(DEFAULT_PLAN.teamSize),
  dayRate: z.number().min(50).max(5000).default(DEFAULT_PLAN.dayRate),
  labourShare: z.number().min(0.05).max(0.95).default(DEFAULT_PLAN.labourShare),
  personIds: z.array(z.string().max(60)).max(30).optional(),
  replace: z.boolean().optional(),
});

async function loadQuote(id: string) {
  const q = await prisma.document.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: 'asc' }, include: { priceItem: { select: { category: true } } } }, worksite: { select: { id: true, ref: true, title: true } } },
  });
  if (!q || q.kind !== 'quote') throw new HttpError(404, 'Devis introuvable');
  if (!q.worksite) throw new HttpError(422, 'Rattachez d’abord ce devis à un chantier.');
  const lines: QuoteLine[] = q.lines.map((l) => ({ kind: l.kind, label: l.label, description: l.description, qty: l.qty, unit: l.unit, totalHt: l.totalHt, category: l.priceItem?.category ?? null }));
  return { q, lines };
}

function compute(lines: QuoteLine[], raw: unknown) {
  const p = paramsSchema.parse(raw ?? {});
  const startDate = nextWorkingDay(p.startDate ?? (() => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })());
  const params = { startDate, teamSize: p.teamSize, dayRate: p.dayRate, labourShare: p.labourShare };
  const lots = estimateLots(lines, params);
  if (!lots.length) throw new HttpError(422, 'Ce devis n’a pas de poste chiffré : rien à planifier.');
  const slots = scheduleLots(lots, startDate);
  return { params, lots, slots, totalDays: lots.reduce((s, l) => s + l.days, 0), endDate: slots.at(-1)!.date, personIds: p.personIds ?? [], replace: p.replace === true };
}

/** Aperçu : durées par lot et créneaux proposés, sans rien créer. */
quoteToolsRouter.post('/:quoteId/plan/preview', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const { q, lines } = await loadQuote(req.params.quoteId!);
  const c = compute(lines, req.body);
  const [existing, confirmed] = await Promise.all([
    prisma.programLot.count({ where: { quoteId: q.id } }),
    prisma.programLot.count({ where: { quoteId: q.id, plannedAt: { not: null } } }),
  ]);
  res.json({ quote: { id: q.id, number: q.number, totalHt: q.totalHt }, worksite: q.worksite, params: c.params, lots: c.lots, slots: c.slots, totalDays: c.totalDays, endDate: c.endDate, existing, confirmed });
}));

/**
 * Enregistre le programme proposé (un lot par poste, avec ses dates) pour l'afficher dans le Gantt du chantier.
 * N'ÉCRIT RIEN dans le planning des équipes ni dans Google Agenda : voir « program/to-planning » pour l'y créer, après validation.
 */
quoteToolsRouter.post('/:quoteId/plan/create', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const { q, lines } = await loadQuote(req.params.quoteId!);
  const c = compute(lines, req.body);
  const existing = await prisma.programLot.count({ where: { quoteId: q.id } });
  if (existing && !c.replace) throw new HttpError(409, `Un programme existe déjà pour ce devis (${existing} lot${existing > 1 ? 's' : ''}). Remplacez-le ou supprimez-le d’abord.`);
  const rows = c.lots.map((l, i) => {
    const s = c.slots.filter((x) => x.lot === i + 1);
    const first = s[0]!, last = s[s.length - 1]!;
    return {
      worksiteId: q.worksite!.id, quoteId: q.id, position: i, title: l.title, budgetHt: l.budgetHt, manDays: l.manDays, days: l.days,
      startDay: first.date, startPart: first.start < '12:00' ? 0 : 0.5, endDay: last.date, endPart: last.end <= '12:30' ? 0.5 : 1, items: l.items as never,
    };
  });
  await prisma.$transaction([
    ...(c.replace ? [prisma.programLot.deleteMany({ where: { quoteId: q.id, plannedAt: null } })] : []),
    prisma.programLot.createMany({ data: rows }),
  ]);
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'program-from-quote', entity: 'document', entityId: q.id, meta: { lots: rows.length, days: c.totalDays } } });
  res.status(201).json({ created: rows.length, totalDays: c.totalDays, endDate: c.endDate, worksiteId: q.worksite!.id });
}));

/** Supprime le programme proposé (et d'anciens créneaux « à confirmer » issus de la première version de cet outil). */
quoteToolsRouter.delete('/:quoteId/plan', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const [lots, events] = await Promise.all([
    prisma.programLot.deleteMany({ where: { quoteId: req.params.quoteId, plannedAt: null } }),
    prisma.planningEvent.deleteMany({ where: { fromQuoteId: req.params.quoteId, status: 'tentative' } }),
  ]);
  res.json({ deleted: lots.count + events.count });
}));

/** Programme d'un chantier (Gantt du chantier). */
quoteToolsRouter.get('/worksite/:worksiteId/program', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const lots = await prisma.programLot.findMany({ where: { worksiteId: req.params.worksiteId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  res.json({ lots });
}));

const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const lotPatch = z.object({ startDay: z.string().regex(dayRe).optional(), startPart: z.union([z.literal(0), z.literal(0.5)]).optional(), endDay: z.string().regex(dayRe).optional(), endPart: z.union([z.literal(0.5), z.literal(1)]).optional() });
/** Ajuste les dates d'un lot du programme (rien n'est écrit dans le planning). */
quoteToolsRouter.patch('/program/:lotId', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const d = lotPatch.parse(req.body);
  const cur = await prisma.programLot.findUnique({ where: { id: req.params.lotId } });
  if (!cur) throw new HttpError(404, 'Lot introuvable');
  const next = { startDay: d.startDay ?? cur.startDay, startPart: d.startPart ?? cur.startPart, endDay: d.endDay ?? cur.endDay, endPart: d.endPart ?? cur.endPart };
  if (next.endDay < next.startDay || (next.endDay === next.startDay && next.endPart <= next.startPart)) throw new HttpError(422, 'La fin doit venir après le début.');
  res.json({ lot: await prisma.programLot.update({ where: { id: cur.id }, data: next }) });
}));

/** Créneaux d'un lot : un par jour ouvrable entre son début et sa fin (matin 08:30–12:30, après-midi 13:00–17:00). */
export function lotSlots(l: { startDay: string; startPart: number; endDay: string; endPart: number }): { date: string; start: string; end: string }[] {
  const out: { date: string; start: string; end: string }[] = [];
  for (let t = new Date(`${l.startDay}T00:00:00Z`).getTime(), max = new Date(`${l.endDay}T00:00:00Z`).getTime(); t <= max; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (!isWorkingDay(date)) continue;
    out.push({ date, start: date === l.startDay && l.startPart === 0.5 ? '13:00' : '08:30', end: date === l.endDay && l.endPart === 0.5 ? '12:30' : '17:00' });
  }
  return out;
}

/** Crée dans le planning des équipes les lots du programme pas encore planifiés, en « à confirmer » (rien n'est envoyé à Google tant qu'on ne confirme pas). */
quoteToolsRouter.post('/worksite/:worksiteId/program/to-planning', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const body = z.object({ lotIds: z.array(z.string()).optional(), personIds: z.array(z.string().max(60)).max(30).optional() }).parse(req.body ?? {});
  const lots = await prisma.programLot.findMany({ where: { worksiteId: req.params.worksiteId, plannedAt: null, ...(body.lotIds ? { id: { in: body.lotIds } } : {}) }, orderBy: { position: 'asc' } });
  if (!lots.length) throw new HttpError(409, 'Aucun lot à créer : le programme est déjà dans le planning, ou vide.');
  const personIds = body.personIds?.length ? (await prisma.person.findMany({ where: { id: { in: body.personIds }, active: true }, select: { id: true } })).map((p) => p.id) : [];
  const all = await prisma.programLot.findMany({ where: { worksiteId: req.params.worksiteId }, select: { id: true, position: true }, orderBy: { position: 'asc' } });
  let created = 0;
  for (const l of lots) {
    const n = all.findIndex((x) => x.id === l.id) + 1;
    const items = Array.isArray(l.items) ? (l.items as string[]) : [];
    for (const s of lotSlots(l)) {
      await prisma.planningEvent.create({
        data: {
          worksiteId: l.worksiteId, title: `Lot ${n} — ${l.title}`, startAt: brusselsToDate(s.date, s.start), endAt: brusselsToDate(s.date, s.end),
          status: 'tentative', kind: 'intervention', tasksNote: items.map((x) => `- ${x}`).join('\n'),
          note: 'Créé depuis le programme du chantier (proposition d’après le devis).', fromQuoteId: l.quoteId, createdById: req.user!.id,
          assignments: { create: personIds.map((personId) => ({ personId })) },
        },
      });
      created++;
    }
    await prisma.programLot.update({ where: { id: l.id }, data: { plannedAt: new Date() } });
  }
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'program-to-planning', entity: 'worksite', entityId: req.params.worksiteId, meta: { lots: lots.length, slots: created } } });
  res.status(201).json({ lots: lots.length, created });
}));
