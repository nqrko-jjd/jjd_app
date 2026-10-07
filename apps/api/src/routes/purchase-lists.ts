import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, STAFF } from '../lib/auth.js';
import { getCompany } from '../lib/documents.js';
import { renderHtmlPdf } from '../lib/pdf.js';
import type { QuoteLine } from '../lib/quote-plan.js';
import {
  buildClientItems, buildInternalItems, clientItemSchema, internalItemSchema, mergeClientAnswers, newShareToken,
  internalListHtml, clientListHtml, type ClientItem, type InternalItem,
} from '../lib/purchase-list.js';
import { aiGenerateJson } from '../lib/ai-generate.js';
import { PURCHASE_SYSTEM, aiPurchaseSchema, applyAiPurchase, purchasePrompt } from '../lib/ai-purchase.js';

/** Listes d'achats d'un chantier : interne (tout le matériel) et client (produits proposés, lien public). Voir lib/purchase-list.ts. */
export const purchaseListsRouter = Router();
export const publicPurchaseListRouter = Router();

const asJson = (v: unknown) => v as Prisma.InputJsonValue;
type Row = { id: string; worksiteId: string | null; quoteId: string | null; title: string; shareToken: string | null; internalItems: unknown; clientItems: unknown; createdAt: Date; updatedAt: Date };

async function spentHt(worksiteId: string | null): Promise<number> {
  if (!worksiteId) return 0;
  const agg = await prisma.ledgerEntry.aggregate({ where: { worksiteId, direction: 'purchase' }, _sum: { ht: true } });
  return Math.round((agg._sum.ht ?? 0) * 100) / 100;
}
const view = async (r: Row) => ({
  id: r.id, worksiteId: r.worksiteId, quoteId: r.quoteId, title: r.title, shared: !!r.shareToken, shareToken: r.shareToken,
  internalItems: r.internalItems as InternalItem[], clientItems: r.clientItems as ClientItem[], spentHt: await spentHt(r.worksiteId), updatedAt: r.updatedAt,
});

purchaseListsRouter.get('/', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const { worksiteId, quoteId } = req.query as Record<string, string>;
  const items = await prisma.purchaseList.findMany({
    where: { ...(worksiteId ? { worksiteId } : {}), ...(quoteId ? { quoteId } : {}) }, orderBy: { updatedAt: 'desc' }, take: 50,
    select: { id: true, worksiteId: true, quoteId: true, title: true, updatedAt: true },
  });
  res.json({ items });
}));

/** Génère la liste d'achats (interne + client) depuis un devis. { fresh: true } crée une nouvelle version. */
purchaseListsRouter.post('/from-quote/:quoteId', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const quote = await prisma.document.findUnique({
    where: { id: req.params.quoteId },
    include: { lines: { orderBy: { position: 'asc' }, include: { priceItem: { select: { category: true } } } }, worksite: { select: { id: true, ref: true, title: true } } },
  });
  if (!quote || quote.kind !== 'quote') throw new HttpError(404, 'Devis introuvable');
  if (!quote.worksite) throw new HttpError(422, 'Rattachez d’abord ce devis à un chantier.');
  const existing = await prisma.purchaseList.findFirst({ where: { quoteId: quote.id }, orderBy: { updatedAt: 'desc' } });
  if (existing && req.body?.fresh !== true) { res.json({ list: await view(existing), existing: true }); return; }
  const lines: QuoteLine[] = quote.lines.map((l) => ({ kind: l.kind, label: l.label, description: l.description, qty: l.qty, unit: l.unit, totalHt: l.totalHt, category: l.priceItem?.category ?? null }));
  let internalItems = buildInternalItems(lines);
  if (!internalItems.length) throw new HttpError(422, 'Ce devis n’a pas de poste de fourniture : rien à acheter.');
  let clientItems = buildClientItems(lines);
  // Rédaction par l'IA (budget de l'assistant, direction seulement) ; sinon la liste de base, avec la raison
  let ai: { used: boolean; reason?: string; costEuro?: number } = { used: false, reason: 'Génération par l’IA non demandée.' };
  if (req.body?.ai !== false) {
    const r = await aiGenerateJson(req.user!, { system: PURCHASE_SYSTEM, prompt: purchasePrompt(lines, quote.worksite), schema: aiPurchaseSchema, maxOutput: 8000 });
    if (!r.ok) ai = { used: false, reason: r.reason };
    else {
      const merged = applyAiPurchase(lines, r.data);
      if (merged) { internalItems = merged.internal; if (merged.client.length) clientItems = merged.client; ai = { used: true, costEuro: r.costEuro }; }
      else ai = { used: false, reason: 'La réponse de l’IA n’était pas exploitable : liste de base utilisée.' };
    }
  }
  const created = await prisma.purchaseList.create({
    data: {
      worksiteId: quote.worksite.id, quoteId: quote.id, title: `Achats — ${quote.worksite.title}`,
      internalItems: asJson(internalItems), clientItems: asJson(clientItems), createdById: req.user!.id,
    },
  });
  res.status(201).json({ list: await view(created), existing: false, ai });
}));

purchaseListsRouter.get('/:id', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const r = await prisma.purchaseList.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, 'Liste d’achats introuvable');
  res.json({ list: await view(r) });
}));

purchaseListsRouter.put('/:id', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const body = z.object({
    title: z.string().trim().min(1).max(300).optional(),
    internalItems: z.array(internalItemSchema).max(500).optional(),
    clientItems: z.array(clientItemSchema).max(200).optional(),
  }).parse(req.body);
  const cur = await prisma.purchaseList.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new HttpError(404, 'Liste d’achats introuvable');
  const r = await prisma.purchaseList.update({
    where: { id: cur.id },
    data: {
      title: body.title,
      ...(body.internalItems ? { internalItems: asJson(body.internalItems) } : {}),
      ...(body.clientItems ? { clientItems: asJson(mergeClientAnswers(cur.clientItems as unknown as ClientItem[], body.clientItems)) } : {}),
    },
  });
  res.json({ list: await view(r) });
}));

purchaseListsRouter.delete('/:id', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  await prisma.purchaseList.delete({ where: { id: req.params.id } }).catch(() => { throw new HttpError(404, 'Liste d’achats introuvable'); });
  res.status(204).end();
}));

/** Active (ou renvoie) le lien public de la liste client ; DELETE le révoque. */
purchaseListsRouter.post('/:id/share', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const cur = await prisma.purchaseList.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new HttpError(404, 'Liste d’achats introuvable');
  const r = cur.shareToken ? cur : await prisma.purchaseList.update({ where: { id: cur.id }, data: { shareToken: newShareToken() } });
  res.json({ token: r.shareToken, path: `/liste/${r.shareToken}` });
}));
purchaseListsRouter.delete('/:id/share', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  await prisma.purchaseList.update({ where: { id: req.params.id }, data: { shareToken: null } }).catch(() => { throw new HttpError(404, 'Liste d’achats introuvable'); });
  res.status(204).end();
}));

purchaseListsRouter.get('/:id/pdf', requireAuth(...STAFF), asyncHandler(async (req, res) => {
  const r = await prisma.purchaseList.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, 'Liste d’achats introuvable');
  const ws = r.worksiteId ? await prisma.worksite.findUnique({ where: { id: r.worksiteId }, select: { ref: true } }) : null;
  const kind = req.query.kind === 'client' ? 'client' : 'internal';
  const html = kind === 'client'
    ? clientListHtml(r.title, ws?.ref ?? '', r.clientItems as unknown as ClientItem[])
    : internalListHtml(r.title, ws?.ref ?? '', r.internalItems as unknown as InternalItem[], await spentHt(r.worksiteId));
  const pdf = await renderHtmlPdf(html);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${kind === 'client' ? 'Produits' : 'Achats'}_${(ws?.ref ?? 'chantier').replace(/[^A-Za-z0-9-]/g, '')}.pdf"`);
  res.send(pdf);
}));

// ---------------------------------------------------------------- lien public (client) : sans compte, jeton secret
const hits = new Map<string, number[]>();
const throttled = (ip: string) => { const now = Date.now(); const w = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000); w.push(now); hits.set(ip, w); return w.length > 60; };
const byToken = (token: string) => (token.length >= 16 && token.length <= 64 ? prisma.purchaseList.findFirst({ where: { shareToken: token } }) : Promise.resolve(null));

publicPurchaseListRouter.get('/:token', asyncHandler(async (req, res) => {
  if (throttled(req.ip ?? 'x')) throw new HttpError(429, 'Trop de requêtes, réessayez dans quelques minutes.');
  const r = await byToken(req.params.token!);
  if (!r) throw new HttpError(404, 'Lien introuvable ou expiré.');
  const ws = r.worksiteId ? await prisma.worksite.findUnique({ where: { id: r.worksiteId }, select: { ref: true, title: true, city: true } }) : null;
  const co = await getCompany();
  // jamais de prix de revient, de fournisseur ni de budget : uniquement ce qui est proposé au client
  const items = (r.clientItems as unknown as ClientItem[]).filter((i) => i.proposal.trim() || i.detail.trim()).map((i) => ({
    id: i.id, lot: i.lot, label: i.label, proposal: i.proposal, detail: i.detail, priceTtc: i.priceTtc, url: i.url, clientChoice: i.clientChoice, clientComment: i.clientComment,
  }));
  res.json({ title: r.title, worksite: ws ? { title: ws.title, city: ws.city } : null, company: { name: co.name, email: co.email, phone: co.phone }, items });
}));

publicPurchaseListRouter.post('/:token/answer', asyncHandler(async (req, res) => {
  if (throttled(req.ip ?? 'x')) throw new HttpError(429, 'Trop de requêtes, réessayez dans quelques minutes.');
  const body = z.object({ itemId: z.string().min(1).max(40), choice: z.enum(['ok', 'other']).nullable(), comment: z.string().trim().max(1000).optional() }).parse(req.body);
  const r = await byToken(req.params.token!);
  if (!r) throw new HttpError(404, 'Lien introuvable ou expiré.');
  const items = r.clientItems as unknown as ClientItem[];
  const idx = items.findIndex((i) => i.id === body.itemId);
  if (idx < 0) throw new HttpError(404, 'Produit introuvable.');
  if (body.choice === 'other' && !body.comment) throw new HttpError(422, 'Précisez ce que vous préférez.');
  items[idx] = { ...items[idx]!, clientChoice: body.choice, clientComment: body.choice ? (body.comment ?? '') : '', answeredAt: body.choice ? new Date().toISOString() : null };
  await prisma.purchaseList.update({ where: { id: r.id }, data: { clientItems: asJson(items) } });
  res.json({ ok: true });
}));
