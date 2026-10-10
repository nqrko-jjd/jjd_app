import { Router } from 'express';
import { z } from 'zod';
import { prisma, nextCounter } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { cloneLineRows, refreshDocTotals, getCompany, docInclude } from '../lib/documents.js';
import { renderHtmlPdf } from '../lib/pdf.js';
import { loadProgress, createStatement, saveStatementLines, invoiceLinesFor, quoteItems, round2 } from '../lib/progress.js';

/** États d'avancement des devis (bureau uniquement) — voir lib/progress.ts. */
export const progressRouter = Router();

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Liste globale : états d'avancement pas encore facturés. */
progressRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.progressStatement.findMany({
      where: { status: { in: ['draft', 'validated'] } },
      orderBy: { createdAt: 'desc' },
      include: { lines: true, quote: { select: { id: true, number: true, draftRef: true, title: true, worksite: { select: { id: true, ref: true, title: true } }, contact: { select: { name: true } } } } },
    });
    res.json({ items: rows.map((s) => ({ id: s.id, number: s.number, status: s.status, createdAt: s.createdAt, totalHt: round2(s.lines.reduce((t, l) => t + l.amountHt, 0)), quote: s.quote })) });
  }),
);

progressRouter.get('/quote/:quoteId', requireAuth(...OFFICE), asyncHandler(async (req, res) => { res.json(await loadProgress(req.params.quoteId!)); }));

progressRouter.post(
  '/quote/:quoteId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await createStatement(req.params.quoteId!);
    res.status(201).json(await loadProgress(req.params.quoteId!));
  }),
);

const patchInput = z.object({ lines: z.array(z.object({ quoteLineId: z.string(), cumulativePct: z.coerce.number() })), note: z.string().max(500).nullish() });
progressRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const body = patchInput.parse(req.body);
    const st = await prisma.progressStatement.findUnique({ where: { id: req.params.id } });
    if (!st) throw new HttpError(404, 'État d’avancement introuvable');
    await saveStatementLines(st.id, body.lines);
    if (body.note !== undefined) await prisma.progressStatement.update({ where: { id: st.id }, data: { note: body.note ?? null } });
    res.json(await loadProgress(st.quoteId));
  }),
);

progressRouter.post(
  '/:id/validate',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const st = await prisma.progressStatement.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!st) throw new HttpError(404, 'État d’avancement introuvable');
    if (st.status !== 'draft') throw new HttpError(422, 'Cet état est déjà validé.');
    if (st.lines.every((l) => l.amountHt <= 0.004)) throw new HttpError(422, 'Aucun avancement saisi : rien à valider.');
    await prisma.progressStatement.update({ where: { id: st.id }, data: { status: 'validated', validatedAt: new Date() } });
    res.json(await loadProgress(st.quoteId));
  }),
);

progressRouter.post(
  '/:id/reopen',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const st = await prisma.progressStatement.findUnique({ where: { id: req.params.id } });
    if (!st) throw new HttpError(404, 'État d’avancement introuvable');
    if (st.status !== 'validated') throw new HttpError(422, 'Seul un état validé non facturé peut être rouvert.');
    const later = await prisma.progressStatement.count({ where: { quoteId: st.quoteId, seq: { gt: st.seq } } });
    if (later) throw new HttpError(422, 'Un état plus récent existe déjà.');
    await prisma.progressStatement.update({ where: { id: st.id }, data: { status: 'draft', validatedAt: null } });
    res.json(await loadProgress(st.quoteId));
  }),
);

progressRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const st = await prisma.progressStatement.findUnique({ where: { id: req.params.id } });
    if (!st) throw new HttpError(404, 'État d’avancement introuvable');
    if (st.status !== 'draft') throw new HttpError(422, 'Seul un état en brouillon se supprime.');
    await prisma.progressStatement.delete({ where: { id: st.id } });
    res.json(await loadProgress(st.quoteId));
  }),
);

/** Facture brouillon de cet état (validé automatiquement s'il était en brouillon), acomptes déduits au prorata. */
progressRouter.post(
  '/:id/invoice',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const st0 = await prisma.progressStatement.findUnique({ where: { id: req.params.id } });
    if (!st0) throw new HttpError(404, 'État d’avancement introuvable');
    if (st0.status === 'invoiced' && st0.invoiceId && await prisma.document.findUnique({ where: { id: st0.invoiceId }, select: { id: true } })) throw new HttpError(422, 'Cet état est déjà facturé.');
    const { statement, lines } = await invoiceLinesFor(st0.id);
    if (!lines.length) throw new HttpError(422, 'Aucun avancement à facturer sur cet état.');
    const quote = await prisma.document.findUnique({ where: { id: statement.quoteId } });
    if (!quote) throw new HttpError(404, 'Devis introuvable');
    const seq = await nextCounter('doc:draft');
    const inv = await prisma.document.create({
      data: {
        kind: 'invoice', direction: 'sale', draftRef: `BROUILLON-${seq}`, status: 'draft',
        worksiteId: quote.worksiteId, contactId: quote.contactId, title: quote.title, terms: quote.terms,
        parentId: quote.id, source: 'manual', createdById: req.user!.id,
        note: `État d’avancement ${statement.number} (devis ${quote.number ?? quote.draftRef})`,
      },
    });
    const rows = cloneLineRows(inv.id, lines.map((l) => ({
      kind: 'item' as const, label: l.label, description: null, qty: 1, unit: 'forfait', unitPriceHt: l.unitPriceHt, discountPct: 0, vatRate: l.vatRate, priceItemId: null,
    })) as never);
    await prisma.documentLine.createMany({ data: rows });
    await refreshDocTotals(inv.id);
    await prisma.progressStatement.update({ where: { id: statement.id }, data: { status: 'invoiced', invoiceId: inv.id, validatedAt: statement.validatedAt ?? new Date() } });
    const full = await prisma.document.findUnique({ where: { id: inv.id }, include: docInclude });
    res.status(201).json({ document: full });
  }),
);

/** PDF de l'état d'avancement, à envoyer au client. */
progressRouter.get(
  '/:id/pdf',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const st = await prisma.progressStatement.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!st) throw new HttpError(404, 'État d’avancement introuvable');
    const [quote, items, prevSt, co] = await Promise.all([
      prisma.document.findUnique({ where: { id: st.quoteId }, include: { worksite: { select: { ref: true, title: true } }, contact: { select: { name: true, address: true, postalCode: true, city: true, vat: true } } } }),
      quoteItems(st.quoteId),
      prisma.progressStatement.findFirst({ where: { quoteId: st.quoteId, seq: { lt: st.seq } }, orderBy: { seq: 'desc' }, include: { lines: true } }),
      getCompany(),
    ]);
    if (!quote) throw new HttpError(404, 'Devis introuvable');
    const prev = new Map((prevSt?.lines ?? []).map((l) => [l.quoteLineId, l.cumulativePct]));
    const rows = items.map((it) => {
      const l = st.lines.find((x) => x.quoteLineId === it.id);
      const p = prev.get(it.id) ?? 0, c = l?.cumulativePct ?? p;
      return { it, p, c, amount: l?.amountHt ?? 0, cumAmount: round2((it.totalHt * c) / 100) };
    });
    const total = round2(rows.reduce((s, r) => s + r.amount, 0));
    const cumTotal = round2(rows.reduce((s, r) => s + r.cumAmount, 0));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 16mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #1f2b26; font-size: 11.5px; }
      h1 { color: #173f34; font-size: 20px; margin: 0 0 4px; } .muted { color: #6b776f; }
      .head { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; border-bottom: 3px solid #c5a35d; padding-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th { background: #173f34; color: #fff; text-align: right; padding: 7px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
      th:first-child, td:first-child { text-align: left; } td { padding: 7px 8px; border-bottom: 1px solid #e5e7df; text-align: right; font-variant-numeric: tabular-nums; }
      tr.total td { font-weight: 800; background: #e9efe9; border-bottom: none; } .foot { margin-top: 18px; color: #6b776f; font-size: 10px; }
    </style></head><body>
      <div class="head"><div><h1>État d’avancement ${esc(st.number)}</h1><div class="muted">Devis ${esc(quote.number ?? quote.draftRef)} · ${esc(quote.title)}</div>${quote.worksite ? `<div class="muted">Chantier ${esc(quote.worksite.ref)} — ${esc(quote.worksite.title)}</div>` : ''}<div class="muted">Date : ${new Date(st.validatedAt ?? st.createdAt).toLocaleDateString('fr-BE')}</div></div>
      <div style="text-align:right"><strong>${esc((co as { name?: string }).name ?? 'JJD Consult')}</strong><br>${esc(co.vat)}<br>${esc(co.email)}</div></div>
      ${quote.contact ? `<p><strong>${esc(quote.contact.name)}</strong><br>${esc([quote.contact.address, [quote.contact.postalCode, quote.contact.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</p>` : ''}
      <table><thead><tr><th>Désignation</th><th>Montant du devis HT</th><th>Avancement précédent</th><th>Avancement cumulé</th><th>Cet état HT</th><th>Total cumulé HT</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.it.label)}</td><td>${eur(r.it.totalHt)}</td><td>${r.p} %</td><td>${r.c} %</td><td>${eur(r.amount)}</td><td>${eur(r.cumAmount)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td>${eur(quote.totalHt)}</td><td></td><td>${quote.totalHt > 0 ? round2((cumTotal / quote.totalHt) * 100) : 0} %</td><td>${eur(total)}</td><td>${eur(cumTotal)}</td></tr></tbody></table>
      ${st.note ? `<p>${esc(st.note)}</p>` : ''}
      <p class="foot">Montants hors TVA. Le détail de la facturation (TVA, acomptes déjà versés) figure sur la facture correspondante.</p>
    </body></html>`;
    const pdf = await renderHtmlPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${st.number}.pdf"`);
    res.send(pdf);
  }),
);
