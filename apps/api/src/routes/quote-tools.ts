import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { estimateLots, scheduleLots, brusselsToDate, nextWorkingDay, DEFAULT_PLAN, type QuoteLine } from '../lib/quote-plan.js';

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
    prisma.planningEvent.count({ where: { fromQuoteId: q.id } }),
    prisma.planningEvent.count({ where: { fromQuoteId: q.id, status: { not: 'tentative' } } }),
  ]);
  res.json({ quote: { id: q.id, number: q.number, totalHt: q.totalHt }, worksite: q.worksite, params: c.params, lots: c.lots, slots: c.slots, totalDays: c.totalDays, endDate: c.endDate, existing, confirmed });
}));

/** Crée les créneaux « à confirmer » (jamais envoyés à Google tant qu'on ne les confirme pas). */
quoteToolsRouter.post('/:quoteId/plan/create', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const { q, lines } = await loadQuote(req.params.quoteId!);
  const c = compute(lines, req.body);
  const existing = await prisma.planningEvent.count({ where: { fromQuoteId: q.id } });
  if (existing && !c.replace) throw new HttpError(409, `Un planning proposé existe déjà pour ce devis (${existing} créneau${existing > 1 ? 'x' : ''}). Remplacez-le ou supprimez-le d’abord.`);
  if (c.replace) await prisma.planningEvent.deleteMany({ where: { fromQuoteId: q.id, status: 'tentative' } }); // les créneaux déjà confirmés ne sont jamais touchés
  const personIds = c.personIds.length ? (await prisma.person.findMany({ where: { id: { in: c.personIds }, active: true }, select: { id: true } })).map((p) => p.id) : [];
  for (const s of c.slots) {
    await prisma.planningEvent.create({
      data: {
        worksiteId: q.worksite!.id, title: `Lot ${s.lot} — ${s.title}`, startAt: brusselsToDate(s.date, s.start), endAt: brusselsToDate(s.date, s.end),
        status: 'tentative', kind: 'intervention', tasksNote: s.items.map((x) => `- ${x}`).join('\n'),
        note: `Proposition automatique d’après le budget du devis ${q.number ?? ''} (${c.params.teamSize} ouvrier${c.params.teamSize > 1 ? 's' : ''}, journée à ${c.params.dayRate} €, ${Math.round(c.params.labourShare * 100)} % de main-d’œuvre). À ajuster.`,
        fromQuoteId: q.id, createdById: req.user!.id,
        assignments: { create: personIds.map((personId) => ({ personId })) },
      },
    });
  }
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'plan-from-quote', entity: 'document', entityId: q.id, meta: { slots: c.slots.length, days: c.totalDays } } });
  res.status(201).json({ created: c.slots.length, totalDays: c.totalDays, endDate: c.endDate });
}));

/** Supprime le planning proposé qui n'a pas été confirmé. */
quoteToolsRouter.delete('/:quoteId/plan', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const r = await prisma.planningEvent.deleteMany({ where: { fromQuoteId: req.params.quoteId, status: 'tentative' } });
  res.json({ deleted: r.count });
}));
