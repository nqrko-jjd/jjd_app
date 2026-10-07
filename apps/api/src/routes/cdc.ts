import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DOCUMENT_LOGO } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, STAFF } from '../lib/auth.js';
import { buildCdc, cdcToDocx, cdcToHtml, todoCount, type CdcContent } from '../lib/cdc.js';
import { renderHtmlPdf } from '../lib/pdf.js';
import { getCompany } from '../lib/documents.js';
import { aiGenerateJson } from '../lib/ai-generate.js';
import { CDC_SYSTEM, aiCdcSchema, applyAiToCdc, cdcPrompt } from '../lib/ai-cdc.js';

/** Cahiers des charges : générés depuis un devis, puis édités (voir lib/cdc.ts). */
export const cdcRouter = Router();

const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: z.string().max(8000) }),
  z.object({ type: z.literal('note'), text: z.string().max(4000) }),
  z.object({ type: z.literal('ul'), items: z.array(z.string().max(2000)).max(200) }),
  z.object({ type: z.literal('table'), head: z.array(z.string().max(200)).min(1).max(8), rows: z.array(z.array(z.string().max(2000)).max(8)).max(400) }),
]);
const contentSchema = z.object({
  meta: z.object({
    title: z.string().max(300), reference: z.string().max(60), clientName: z.string().max(300), clientAddress: z.string().max(500),
    worksiteAddress: z.string().max(500), quoteRef: z.string().max(60), quoteDate: z.string().max(60), generatedAt: z.string().max(60),
  }),
  sections: z.array(z.object({ id: z.string().max(80), title: z.string().max(300), blocks: z.array(block).max(80) })).max(60),
});

const view = (r: { id: string; worksiteId: string | null; quoteId: string | null; title: string; status: string; content: unknown; createdAt: Date; updatedAt: Date }) => {
  const content = r.content as CdcContent;
  return { id: r.id, worksiteId: r.worksiteId, quoteId: r.quoteId, title: r.title, status: r.status, content, todo: todoCount(content), createdAt: r.createdAt, updatedAt: r.updatedAt };
};
const companyBlock = async () => {
  const co = await getCompany();
  return { name: co.name, address: [co.address, co.postalCode, co.city].filter(Boolean).join(' '), phone: co.phone, email: co.email };
};

/** Liste (par chantier et/ou devis), sans le contenu. */
cdcRouter.get('/', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const { worksiteId, quoteId } = req.query as Record<string, string>;
  const rows = await prisma.scopeDoc.findMany({
    where: { ...(worksiteId ? { worksiteId } : {}), ...(quoteId ? { quoteId } : {}) },
    orderBy: { updatedAt: 'desc' }, take: 100,
    select: { id: true, worksiteId: true, quoteId: true, title: true, status: true, updatedAt: true, createdAt: true },
  });
  res.json({ items: rows });
}));

/** Génère un cahier des charges depuis un devis (brouillon à relire). { fresh: true } crée une nouvelle version même s'il en existe déjà une. */
cdcRouter.post('/from-quote/:quoteId', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const quote = await prisma.document.findUnique({
    where: { id: req.params.quoteId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      worksite: { select: { id: true, ref: true, title: true, address: true, postalCode: true, city: true, client: { select: { name: true, address: true, postalCode: true, city: true } } } },
      contact: { select: { name: true, address: true, postalCode: true, city: true } },
    },
  });
  if (!quote) throw new HttpError(404, 'Devis introuvable');
  if (quote.kind !== 'quote') throw new HttpError(422, 'Un cahier des charges se génère depuis un devis.');
  if (!quote.worksite) throw new HttpError(422, 'Rattachez d’abord ce devis à un chantier : le cahier des charges est lié au chantier.');
  if (!quote.lines.some((l) => l.kind === 'item')) throw new HttpError(422, 'Ce devis n’a pas encore de lignes de travaux.');
  const existing = await prisma.scopeDoc.findFirst({ where: { quoteId: quote.id }, orderBy: { updatedAt: 'desc' } });
  if (existing && req.body?.fresh !== true) { res.json({ cdc: view(existing), existing: true }); return; }
  const input = {
    worksite: quote.worksite,
    client: quote.contact ?? quote.worksite.client,
    quote: { number: quote.number, issuedOn: quote.issuedOn, totalHt: quote.totalHt, title: quote.title, lines: quote.lines.map((l) => ({ kind: l.kind, label: l.label, description: l.description, qty: l.qty, unit: l.unit, totalHt: l.totalHt })) },
  };
  let content = buildCdc(input);
  // Rédaction par l'IA (budget de l'assistant, direction seulement) ; en cas de problème on garde la génération de base et on dit pourquoi
  let ai: { used: boolean; reason?: string; costEuro?: number } = { used: false, reason: 'Génération par l’IA non demandée.' };
  if (req.body?.ai !== false) {
    const r = await aiGenerateJson(req.user!, { system: CDC_SYSTEM, prompt: cdcPrompt(input), schema: aiCdcSchema, maxOutput: 8000 });
    if (!r.ok) ai = { used: false, reason: r.reason };
    else {
      const merged = applyAiToCdc(content, r.data, input);
      if (merged) { content = merged; ai = { used: true, costEuro: r.costEuro }; }
      else ai = { used: false, reason: 'La réponse de l’IA ne correspondait pas aux lots du devis : génération de base utilisée.' };
    }
  }
  const created = await prisma.scopeDoc.create({
    data: { worksiteId: quote.worksite.id, quoteId: quote.id, title: `Cahier des charges — ${quote.worksite.title}`, content: content as unknown as Prisma.InputJsonValue, createdById: req.user!.id },
  });
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'create', entity: 'scopeDoc', entityId: created.id, meta: { quote: quote.number, ai: ai.used, aiCostEuro: ai.costEuro } } });
  res.status(201).json({ cdc: view(created), existing: false, ai });
}));

cdcRouter.get('/:id', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const r = await prisma.scopeDoc.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, 'Cahier des charges introuvable');
  res.json({ cdc: view(r) });
}));

cdcRouter.put('/:id', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const body = z.object({ title: z.string().trim().min(1).max(300).optional(), status: z.enum(['draft', 'validated']).optional(), content: contentSchema.optional() }).parse(req.body);
  const r = await prisma.scopeDoc.update({
    where: { id: req.params.id },
    data: { title: body.title, status: body.status, ...(body.content ? { content: body.content as unknown as Prisma.InputJsonValue } : {}) },
  }).catch(() => null);
  if (!r) throw new HttpError(404, 'Cahier des charges introuvable');
  res.json({ cdc: view(r) });
}));

cdcRouter.delete('/:id', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  await prisma.scopeDoc.delete({ where: { id: req.params.id } }).catch(() => { throw new HttpError(404, 'Cahier des charges introuvable'); });
  res.status(204).end();
}));

const safeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'CDC';

cdcRouter.get('/:id/pdf', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const r = await prisma.scopeDoc.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, 'Cahier des charges introuvable');
  const content = r.content as unknown as CdcContent;
  const pdf = await renderHtmlPdf(cdcToHtml(content, await companyBlock(), DOCUMENT_LOGO));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="CDC_${safeName(content.meta.reference)}.pdf"`);
  res.send(pdf);
}));

cdcRouter.get('/:id/docx', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const r = await prisma.scopeDoc.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, 'Cahier des charges introuvable');
  const content = r.content as unknown as CdcContent;
  const buf = cdcToDocx(content, await companyBlock());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="CDC_${safeName(content.meta.reference)}.docx"`);
  res.send(Buffer.from(buf));
}));
