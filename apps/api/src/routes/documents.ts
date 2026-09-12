import { Router } from 'express';
import path from 'node:path';
import { createReadStream, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { documentInput, priceItemInput, DOC_KIND_LABEL } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { docInclude, buildLineRows, cloneLineRows, refreshDocTotals, issueDocument, getCompany } from '../lib/documents.js';
import { renderDocumentPdf } from '../lib/pdf.js';
import { extractDocumentInfo } from '../lib/document-extract.js';
import { UPLOADS_DIR } from '../lib/media.js';
import { taskInclude, serializeTask } from './tasks.js';

export const documentsRouter = Router();
// Dérivé de UPLOADS_DIR (respecte process.env.UPLOADS_DIR en prod) plutôt que d'un chemin
// relatif au fichier compilé — un ../.. relatif à dist/src/routes/ ne pointe pas au même
// endroit qu'un ../.. relatif à src/routes/ en dev (bug qui a fait planter le PDF TrustUp
// en production : dist/uploads/documents au lieu de apps/api/uploads/documents).
const PDF_DIR = path.join(UPLOADS_DIR, 'documents');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/* ---------------------------------------------------------------- Documents */

/** Buffer PDF d'un document : celui de TrustUp s'il existe, sinon généré à la volée. */
async function getDocPdfBuffer(docId: string): Promise<{ buffer: Buffer; filename: string }> {
  const doc = await prisma.document.findUnique({ where: { id: docId }, include: docInclude });
  if (!doc) throw new HttpError(404, 'Document introuvable');
  const filename = `${(doc.number ?? doc.draftRef ?? doc.id).replace(/[/\\]/g, '-')}.pdf`;
  if (doc.originalPdf) {
    const file = path.join(PDF_DIR, path.basename(doc.originalPdf));
    if (existsSync(file)) return { buffer: readFileSync(file), filename };
  }
  const company = await getCompany();
  const buffer = await renderDocumentPdf(doc, company);
  return { buffer, filename };
}

/** Export groupé : plusieurs devis/factures/avoirs en un seul .zip (à glisser chez le comptable). */
documentsRouter.get(
  '/export.zip',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new HttpError(422, 'Aucun document sélectionné');
    if (ids.length > 300) throw new HttpError(422, 'Trop de documents sélectionnés (300 max)');

    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const id of ids) {
      const { buffer, filename } = await getDocPdfBuffer(id);
      let name = filename;
      let i = 2;
      while (used.has(name)) { name = filename.replace(/\.pdf$/, `-${i}.pdf`); i++; }
      used.add(name);
      files[name] = new Uint8Array(buffer);
    }
    const zipped = zipSync(files, { level: 6 });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="documents-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(Buffer.from(zipped));
  }),
);

/**
 * Importe un devis/facture/note de crédit externe (PDF) : crée le document
 * avec le type/client/chantier/montant détectés (best-effort, à vérifier
 * ensuite sur la fiche), et garde le PDF d'origine comme pièce de référence.
 */
documentsRouter.post(
  '/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    if (req.file.mimetype !== 'application/pdf') {
      throw new HttpError(422, 'Seuls les PDF sont lus automatiquement pour l’instant — un PDF sans texte (scan/photo) sera importé sans pré-remplissage.');
    }

    const extraction = await extractDocumentInfo(req.file.buffer, req.file.mimetype);
    const seq = await nextCounter('doc:draft');
    const doc = await prisma.document.create({
      data: {
        kind: extraction.kind ?? 'invoice',
        direction: extraction.kind === 'credit_note' ? 'credit_note' : 'sale',
        draftRef: `BROUILLON-${seq}`,
        status: 'draft',
        worksiteId: extraction.worksiteId,
        contactId: extraction.contactId,
        issuedOn: extraction.issuedOn ? new Date(extraction.issuedOn) : null,
        dueOn: extraction.dueOn ? new Date(extraction.dueOn) : null,
        source: 'import-pdf',
        createdById: req.user!.id,
      },
    });

    const ht = extraction.totalHt ?? (extraction.totalTtc != null ? Math.round((extraction.totalTtc / (1 + (extraction.vatRate ?? 0.21))) * 100) / 100 : null);
    if (ht != null && ht > 0) {
      await prisma.documentLine.createMany({
        data: buildLineRows(doc.id, [{
          kind: 'item', label: 'Montant importé (à vérifier)', description: null,
          qty: 1, unit: 'forfait', unitPriceHt: ht, discountPct: 0, vatRate: extraction.vatRate ?? 0.21, priceItemId: null,
        }]),
      });
      await refreshDocTotals(doc.id);
    }

    if (!existsSync(PDF_DIR)) mkdirSync(PDF_DIR, { recursive: true });
    const filename = `${nanoid(14)}.pdf`;
    writeFileSync(path.join(PDF_DIR, filename), req.file.buffer);
    await prisma.document.update({ where: { id: doc.id }, data: { originalPdf: filename } });

    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'import', entity: 'document', entityId: doc.id, meta: { kind: doc.kind } },
    });

    const full = await prisma.document.findUnique({ where: { id: doc.id }, include: docInclude });
    res.status(201).json({ document: full, extraction });
  }),
);

documentsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { kind, status, q, worksiteId, contactId, scope, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
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
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    // plafond haut : l'app mobile (écran Devis & factures) charge tout en une fois et cherche côté client
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));
    const [items, totalCount] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          worksite: { select: { id: true, ref: true, title: true } },
          contact: { select: { id: true, name: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);
    res.json({ items, page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) });
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

/** PDF TrustUp d'origine (import). Authentifié, streamé inline. */
documentsRouter.get(
  '/:id/original.pdf',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id }, select: { originalPdf: true, number: true } });
    if (!doc?.originalPdf) throw new HttpError(404, 'Pas de PDF d’origine pour ce document');
    const safe = path.basename(doc.originalPdf);
    const file = path.join(PDF_DIR, safe);
    if (!existsSync(file)) throw new HttpError(404, 'Fichier PDF introuvable sur le serveur');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.number ?? safe}.pdf"`);
    createReadStream(file).pipe(res);
  }),
);

/** PDF du document (généré à la volée pour les documents JJD natifs). Authentifié, streamé inline. */
documentsRouter.get(
  '/:id/pdf',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { buffer, filename } = await getDocPdfBuffer(req.params.id!);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
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

    if (existing.lockedAt && data.kind) {
      throw new HttpError(409, 'Document émis : le type (devis/facture/NC) n’est plus modifiable.');
    }
    // Modification des lignes/montants après émission — normalement on passerait par une
    // note de crédit, mais autorisé pour l'instant (phase de test) ; tracé dans l'audit log
    // pour garder une trace de ce qui a changé après coup.
    if (existing.lockedAt && data.lines) {
      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: 'edit_issued_lines',
          entity: 'document',
          entityId: existing.id,
          meta: { number: existing.number, previousTotalTtc: existing.totalTtc },
        },
      });
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

/** Crée une tâche par ligne de devis sélectionnée — jamais automatique (cf. l'assistant IA :
 *  tout ce qui est généré reste une proposition explicite, pas une action déclenchée seule
 *  à l'acceptation du devis). */
documentsRouter.post(
  '/:id/tasks-from-lines',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { lineIds, assigneeIds } = req.body as { lineIds: string[]; assigneeIds?: string[] };
    const doc = await prisma.document.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    if (!doc.worksiteId) throw new HttpError(422, "Ce devis n'est pas lié à un chantier — impossible d'y créer des tâches.");
    const lines = doc.lines.filter((l) => l.kind === 'item' && lineIds.includes(l.id));
    if (!lines.length) throw new HttpError(422, 'Aucune ligne sélectionnée.');

    const count = await prisma.worksiteTask.count({ where: { worksiteId: doc.worksiteId } });
    const tasks = [];
    for (let i = 0; i < lines.length; i++) {
      const task = await prisma.worksiteTask.create({
        data: {
          worksiteId: doc.worksiteId,
          title: lines[i]!.label,
          position: count + i,
          source: 'quote',
          createdById: req.user!.id,
          assignees: { create: (assigneeIds ?? []).map((userId) => ({ userId })) },
        },
        include: taskInclude,
      });
      tasks.push(serializeTask(task));
    }
    res.status(201).json({ tasks });
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
