import { Router } from 'express';
import { documentInput, priceItemInput, DOC_KIND_LABEL } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { docInclude, buildLineRows, cloneLineRows, refreshDocTotals, issueDocument, getCompany } from '../lib/documents.js';

export const documentsRouter = Router();

/* ---------------------------------------------------------------- Documents */

documentsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { kind, status, q, worksiteId, contactId, scope } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind;
    if (status) where.status = status;
    if (worksiteId) where.worksiteId = worksiteId;
    if (contactId) where.contactId = contactId;
    if (scope === 'drafts') where.lockedAt = null;
    if (scope === 'issued') where.lockedAt = { not: null };
    if (q) {
      where.OR = [
        { number: { contains: q } },
        { draftRef: { contains: q } },
        { title: { contains: q } },
        { billingName: { contains: q } },
        { contact: { name: { contains: q } } },
        { worksite: { ref: { contains: q } } },
      ];
    }
    const items = await prisma.document.findMany({
      where,
      orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
      take: 400,
      include: {
        worksite: { select: { id: true, ref: true, title: true } },
        contact: { select: { id: true, name: true } },
      },
    });
    res.json({ items });
  }),
);

documentsRouter.get(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: docInclude });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const company = await getCompany();
    res.json({ document: doc, company });
  }),
);

documentsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = documentInput.parse(req.body);
    const seq = await nextCounter('doc:draft');
    const doc = await prisma.document.create({
      data: {
        kind: data.kind,
        direction: data.kind === 'credit_note' ? 'credit_note' : 'sale',
        draftRef: `BROUILLON-${seq}`,
        status: 'draft',
        worksiteId: data.worksiteId ?? null,
        contactId: data.contactId ?? null,
        title: data.title ?? null,
        intro: data.intro ?? null,
        terms: data.terms ?? null,
        issuedOn: data.issuedOn ?? null,
        dueOn: data.dueOn ?? null,
        validUntil: data.validUntil ?? null,
        note: data.note ?? null,
        parentId: data.parentId ?? null,
        source: 'manual',
        createdById: req.user!.id,
      },
    });
    if (data.lines.length) {
      await prisma.documentLine.createMany({ data: buildLineRows(doc.id, data.lines) });
      await refreshDocTotals(doc.id);
    }
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'create', entity: 'document', entityId: doc.id, meta: { kind: doc.kind } },
    });
    const full = await prisma.document.findUnique({ where: { id: doc.id }, include: docInclude });
    res.status(201).json({ document: full });
  }),
);

documentsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Document introuvable');
    const data = documentInput.partial().parse(req.body);

    if (existing.lockedAt && (data.lines || data.kind)) {
      throw new HttpError(409, 'Document émis : les lignes ne sont plus modifiables. Créez une note de crédit.');
    }

    await prisma.document.update({
      where: { id: existing.id },
      data: {
        worksiteId: data.worksiteId === undefined ? undefined : data.worksiteId,
        contactId: data.contactId === undefined ? undefined : data.contactId,
        title: data.title ?? undefined,
        intro: data.intro ?? undefined,
        terms: data.terms ?? undefined,
        note: data.note ?? undefined,
        issuedOn: data.issuedOn ?? undefined,
        dueOn: data.dueOn ?? undefined,
        validUntil: data.validUntil ?? undefined,
      },
    });

    if (data.lines) {
      await prisma.documentLine.deleteMany({ where: { documentId: existing.id } });
      if (data.lines.length) await prisma.documentLine.createMany({ data: buildLineRows(existing.id, data.lines) });
      await refreshDocTotals(existing.id);
    }
    const full = await prisma.document.findUnique({ where: { id: existing.id }, include: docInclude });
    res.json({ document: full });
  }),
);

documentsRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    if (doc.lockedAt) throw new HttpError(409, 'Document émis : impossible à supprimer.');
    await prisma.documentLine.deleteMany({ where: { documentId: doc.id } });
    await prisma.document.delete({ where: { id: doc.id } });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'delete', entity: 'document', entityId: doc.id },
    });
    res.json({ ok: true });
  }),
);

documentsRouter.post(
  '/:id/issue',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const body = req.body as { issuedOn?: string; dueDays?: number };
    const doc = await issueDocument(req.params.id as string, {
      issuedOn: body.issuedOn ? new Date(body.issuedOn) : undefined,
      dueDays: body.dueDays,
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'issue', entity: 'document', entityId: doc.id, meta: { number: doc.number } },
    });
    res.json({ document: doc });
  }),
);

/** Duplication en brouillon (mêmes lignes). */
documentsRouter.post(
  '/:id/duplicate',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const src = await prisma.document.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!src) throw new HttpError(404, 'Document introuvable');
    const seq = await nextCounter('doc:draft');
    const copy = await prisma.document.create({
      data: {
        kind: src.kind,
        direction: src.direction,
        draftRef: `BROUILLON-${seq}`,
        status: 'draft',
        worksiteId: src.worksiteId,
        contactId: src.contactId,
        title: src.title,
        intro: src.intro,
        terms: src.terms,
        note: src.note,
        source: 'manual',
        createdById: req.user!.id,
      },
    });
    if (src.lines.length) {
      await prisma.documentLine.createMany({ data: cloneLineRows(copy.id, src.lines) });
      await refreshDocTotals(copy.id);
    }
    const full = await prisma.document.findUnique({ where: { id: copy.id }, include: docInclude });
    res.status(201).json({ document: full });
  }),
);

/** Devis accepté -> facture brouillon liée. */
documentsRouter.post(
  '/:id/convert',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const src = await prisma.document.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!src) throw new HttpError(404, 'Document introuvable');
    if (src.kind !== 'quote') throw new HttpError(422, 'Seul un devis se convertit en facture');
    const target = (req.body?.kind as string) === 'deposit_invoice' ? 'deposit_invoice' : 'invoice';
    const seq = await nextCounter('doc:draft');
    const inv = await prisma.document.create({
      data: {
        kind: target,
        direction: 'sale',
        draftRef: `BROUILLON-${seq}`,
        status: 'draft',
        worksiteId: src.worksiteId,
        contactId: src.contactId,
        title: src.title,
        terms: src.terms,
        parentId: src.id,
        source: 'manual',
        createdById: req.user!.id,
      },
    });
    const depositPct = Number(req.body?.depositPct);
    const lines = target === 'deposit_invoice' && depositPct > 0
      ? cloneLineRows(inv.id, [{
          kind: 'item',
          label: `Acompte ${depositPct} % sur devis ${src.number || src.draftRef}`,
          description: null, qty: 1, unit: 'forfait',
          unitPriceHt: Math.round(src.totalHt * (depositPct / 100) * 100) / 100,
          discountPct: 0, vatRate: src.vatRate ?? 0.21, priceItemId: null,
        }])
      : cloneLineRows(inv.id, src.lines);
    if (lines.length) {
      await prisma.documentLine.createMany({ data: lines });
      await refreshDocTotals(inv.id);
    }
    if (src.status === 'sent') await prisma.document.update({ where: { id: src.id }, data: { status: 'accepted', acceptedOn: new Date() } });
    const full = await prisma.document.findUnique({ where: { id: inv.id }, include: docInclude });
    res.status(201).json({ document: full });
  }),
);

/** Facture -> note de crédit brouillon liée (mêmes lignes, à ajuster). */
documentsRouter.post(
  '/:id/credit-note',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const src = await prisma.document.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!src) throw new HttpError(404, 'Document introuvable');
    if (src.kind !== 'invoice' && src.kind !== 'deposit_invoice') throw new HttpError(422, 'Note de crédit sur une facture uniquement');
    const seq = await nextCounter('doc:draft');
    const cn = await prisma.document.create({
      data: {
        kind: 'credit_note', direction: 'credit_note', draftRef: `BROUILLON-${seq}`,
        status: 'draft', worksiteId: src.worksiteId, contactId: src.contactId,
        title: src.title, parentId: src.id,
        note: `Note de crédit sur facture ${src.number || src.draftRef}`,
        source: 'manual', createdById: req.user!.id,
      },
    });
    if (src.lines.length) {
      await prisma.documentLine.createMany({ data: cloneLineRows(cn.id, src.lines) });
      await refreshDocTotals(cn.id);
    }
    const full = await prisma.document.findUnique({ where: { id: cn.id }, include: docInclude });
    res.status(201).json({ document: full });
  }),
);

documentsRouter.post(
  '/:id/mark-paid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const amount = typeof req.body?.amount === 'number' ? req.body.amount : doc.totalTtc;
    const paidOn = req.body?.paidOn ? new Date(req.body.paidOn) : new Date();
    const paidAmount = Math.round((doc.paidAmount + amount) * 100) / 100;
    const status = paidAmount + 0.01 >= doc.totalTtc ? 'paid' : 'partial';
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { paidAmount, paidOn: status === 'paid' ? paidOn : doc.paidOn, status },
      include: docInclude,
    });
    res.json({ document: updated });
  }),
);

documentsRouter.post(
  '/:id/status',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body as { status: string; reason?: string };
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status,
        acceptedOn: status === 'accepted' ? new Date() : doc.acceptedOn,
        declinedReason: status === 'declined' ? (reason ?? null) : doc.declinedReason,
      },
      include: docInclude,
    });
    res.json({ document: updated });
  }),
);

/**
 * Envoi. Pour l'instant : marque envoyé + met la file Peppol à "queued".
 * La transmission réelle via point d'accès Peppol sera branchée au lot 6bis
 * (TrustUp reste l'émetteur officiel tant que la conformité n'est pas validée).
 */
documentsRouter.post(
  '/:id/send',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    let doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    if (!doc.lockedAt) doc = await issueDocument(doc.id);
    const isInvoice = doc.kind === 'invoice' || doc.kind === 'deposit_invoice' || doc.kind === 'credit_note';
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        peppolStatus: isInvoice && req.body?.peppol ? 'queued' : doc.peppolStatus,
      },
      include: docInclude,
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'send', entity: 'document', entityId: doc.id, meta: { peppol: !!req.body?.peppol } },
    });
    res.json({
      document: updated,
      note: req.body?.peppol
        ? 'Mis en file Peppol. Transmission réelle non encore active — à confirmer via TrustUp.'
        : `${DOC_KIND_LABEL[doc.kind]} marqué envoyé.`,
    });
  }),
);

/* --------------------------------------------------------- Bibliothèque prix */

export const priceItemsRouter = Router();

priceItemsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { q, category } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { active: true };
    if (category) where.category = category;
    if (q) where.OR = [{ label: { contains: q } }, { ref: { contains: q } }, { description: { contains: q } }];
    const items = await prisma.priceItem.findMany({ where, orderBy: [{ category: 'asc' }, { label: 'asc' }], take: 500 });
    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
    res.json({ items, categories });
  }),
);

priceItemsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = priceItemInput.parse(req.body);
    const item = await prisma.priceItem.create({ data: { ...data, source: 'manual' } });
    res.status(201).json({ item });
  }),
);

priceItemsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = priceItemInput.partial().parse(req.body);
    const item = await prisma.priceItem.update({ where: { id: req.params.id }, data });
    res.json({ item });
  }),
);

priceItemsRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.priceItem.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ ok: true });
  }),
);
