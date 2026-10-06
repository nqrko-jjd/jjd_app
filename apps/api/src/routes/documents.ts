import { Router } from 'express';
import { validateExternalDeliveryRequest, externalDeliveryState } from '../lib/document-delivery.js';
import path from 'node:path';
import { createReadStream, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { documentInput, documentBackfillInput, priceItemInput, DOC_KIND_LABEL } from '@jjd/shared';
import { prisma, nextCounter } from '../db.js';
import { insensitive } from '../lib/search.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { z } from 'zod';
import { docInclude, buildLineRows, cloneLineRows, refreshDocTotals, issueDocument, getCompany, syncLedgerEntryForDocument, creditedTtc, partialCreditLines } from '../lib/documents.js';
import { renderDocumentPdf } from '../lib/pdf.js';
import { extractDocumentInfo } from '../lib/document-extract.js';
import { UPLOADS_DIR } from '../lib/media.js';
import { PAYMENT_TOLERANCE } from '../lib/payment-tolerance.js';
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
        // "bordereau" (fournisseur) n'a pas de sens ici : on importe une facture/un devis ÉMIS par
        // JJD, jamais un bordereau — repli défensif au cas où le texte contiendrait ce mot.
        kind: extraction.kind && extraction.kind !== 'delivery_slip' ? extraction.kind : 'invoice',
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

/**
 * Facture/devis historique déjà connu (numéro papier, ancien système avant TrustUp…), sans
 * PDF à joindre — saisie directe avec le numéro d'origine. Distinct de /import (PDF) et de
 * la création normale (POST /, numéro auto via /issue) : ici le numéro est imposé, jamais
 * généré, donc jamais utilisé pour un document réellement émis depuis l'appli.
 */
documentsRouter.post(
  '/backfill',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = documentBackfillInput.parse(req.body);
    const clash = await prisma.document.findFirst({ where: { kind: data.kind, number: data.number } });
    if (clash) throw new HttpError(409, `Le numéro ${data.number} existe déjà (${DOC_KIND_LABEL[data.kind]}).`);

    const doc = await prisma.document.create({
      data: {
        kind: data.kind,
        direction: data.kind === 'credit_note' ? 'credit_note' : 'sale',
        number: data.number,
        status: data.paid ? 'paid' : 'sent',
        worksiteId: data.worksiteId ?? null,
        contactId: data.contactId ?? null,
        title: data.title ?? null,
        issuedOn: data.issuedOn,
        lockedAt: data.issuedOn,
        source: 'legacy',
        createdById: req.user!.id,
      },
    });
    await prisma.documentLine.createMany({
      data: buildLineRows(doc.id, [{
        kind: 'item', label: data.title || 'Facture historique', description: null,
        qty: 1, unit: 'forfait', unitPriceHt: data.ht, discountPct: 0, vatRate: data.vatRate, priceItemId: null,
      }]),
    });
    const totals = await refreshDocTotals(doc.id);
    if (data.paid) {
      await prisma.document.update({ where: { id: doc.id }, data: { paidAmount: totals.totalTtc, paidOn: data.issuedOn } });
    }
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'backfill', entity: 'document', entityId: doc.id, meta: { number: doc.number } },
    });
    const full = await prisma.document.findUnique({ where: { id: doc.id }, include: docInclude });
    res.status(201).json({ document: full });
  }),
);

documentsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { kind, status, q: qRaw, worksiteId, contactId, scope, page: pageStr, pageSize: pageSizeStr, sort, dir } = req.query as Record<string, string>;
    const q = qRaw?.toLowerCase();
    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind === 'invoice' ? { in: ['invoice', 'deposit_invoice'] } : kind;
    if (status) where.status = status;
    if (worksiteId) where.worksiteId = worksiteId;
    if (contactId) where.contactId = contactId;
    if (scope === 'drafts') where.lockedAt = null;
    if (scope === 'issued') where.lockedAt = { not: null };
    // Same definitions as the dashboard totals; no changes to amounts or statuses.
    const dashboard = String(req.query.dashboard || '');
    if (['invoiced', 'collected', 'overdue', 'receivable', 'quotes'].includes(dashboard)) {
      where.source = { not: 'demo' };
      where.kind = dashboard === 'quotes' ? 'quote' : { in: ['invoice', 'deposit_invoice'] };
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      if (dashboard === 'invoiced') where.issuedOn = { gte: monthStart };
      // Encaissé = argent reçu ce mois-ci : filtre sur la date de paiement (paidOn), pas
      // la date d'émission — même correctif que le calcul du tableau de bord (2026-09-30).
      if (dashboard === 'collected') { where.paidOn = { gte: monthStart }; where.status = 'paid'; }
      if (dashboard === 'overdue') where.status = 'overdue';
      if (dashboard === 'receivable') where.status = { in: ['sent', 'partial', 'overdue'] };
      if (dashboard === 'quotes') where.status = 'sent';
    }
    if (q) {
      where.OR = [
        { number: { contains: q, ...insensitive } },
        { draftRef: { contains: q, ...insensitive } },
        { title: { contains: q, ...insensitive } },
        { billingName: { contains: q, ...insensitive } },
        { contact: { name: { contains: q, ...insensitive } } },
        { worksite: { ref: { contains: q, ...insensitive } } },
      ];
    }
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    // plafond haut : l'app mobile (écran Devis & factures) charge tout en une fois et cherche côté client
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));
    const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc';
    const orderBy: Record<string, unknown>[] =
      sort === 'number' ? [{ number: sortDir }, { draftRef: sortDir }]
      : sort === 'contact' ? [{ contact: { name: sortDir } }]
      : sort === 'worksite' ? [{ worksite: { ref: sortDir } }]
      : sort === 'dueOn' ? [{ dueOn: sortDir }]
      : sort === 'paidOn' ? [{ paidOn: sortDir }]
      : sort === 'totalTtc' ? [{ totalTtc: sortDir }]
      : [{ issuedOn: sortDir }, { createdAt: sortDir }];
    const [items, totalCount] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy,
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
    // Une facture "payée" peut n'avoir aucun vrai rapprochement bancaire derrière (import
    // historique où le paiement exact n'a jamais été retrouvé) — la date affichée n'est alors
    // qu'un artefact d'import, pas confirmée. Le signaler plutôt que de laisser croire que
    // c'est fiable — voir le lien vers /finances/banque?documentId= côté web.
    // Tous les paiements de la facture : rapprochés au document, à son écriture synchronisée, ou à l'écriture
    // historique (Excel, non liée) de même numéro — sinon une facture payée en plusieurs fois n'en montrait qu'un.
    const matches = await prisma.bankTransactionMatch.findMany({
      where: {
        OR: [
          { documentId: doc.id },
          { ledgerEntry: { documentId: doc.id } },
          ...(doc.number ? [{ ledgerEntry: { documentId: null, docNumber: doc.number, direction: { in: ['sale', 'credit_note'] } } }] : []),
        ],
      },
      select: { id: true, amount: true, bankTransaction: { select: { id: true, bookingDate: true, amount: true, bank: true, counterpartyName: true } } },
    });
    const payments = matches
      .map((m) => ({
        matchId: m.id,
        txId: m.bankTransaction.id,
        date: m.bankTransaction.bookingDate,
        amount: Math.round((m.amount ?? Math.abs(m.bankTransaction.amount ?? 0)) * 100) / 100,
        bank: m.bankTransaction.bank,
        counterparty: m.bankTransaction.counterpartyName,
      }))
      .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    res.json({ document: { ...doc, hasBankMatch: payments.length > 0, payments }, company });
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

/** Remplace le PDF d'origine d'un document (import) par un fichier corrigé. L'ancien fichier reste sur disque. */
documentsRouter.post(
  '/:id/original.pdf',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id }, select: { id: true, number: true, originalPdf: true } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    if (req.file.mimetype !== 'application/pdf') throw new HttpError(422, 'Un PDF est attendu');
    if (!existsSync(PDF_DIR)) mkdirSync(PDF_DIR, { recursive: true });
    const filename = `${nanoid(14)}.pdf`;
    writeFileSync(path.join(PDF_DIR, filename), req.file.buffer);
    await prisma.document.update({ where: { id: doc.id }, data: { originalPdf: filename } });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'replace_original_pdf', entity: 'document', entityId: doc.id, meta: { number: doc.number, previous: doc.originalPdf } },
    });
    res.json({ ok: true });
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
    if (existing.lockedAt && data.lines && (data.lines.length > 0 || (await prisma.documentLine.count({ where: { documentId: existing.id } })) > 0)) {
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

    // Échéance repoussée dans le futur sur une facture déjà "en retard" : la repasse
    // sent/partial selon ce qui a déjà été payé (sinon elle resterait faussement en retard).
    const dueMovedToFuture = data.dueOn !== undefined && data.dueOn !== null && data.dueOn >= new Date();
    const revertOverdue = existing.status === 'overdue' && dueMovedToFuture;

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
        billingName: data.billingName === undefined ? undefined : data.billingName,
        billingVat: data.billingVat === undefined ? undefined : data.billingVat,
        billingAddress: data.billingAddress === undefined ? undefined : data.billingAddress,
        billingEmail: data.billingEmail === undefined ? undefined : data.billingEmail,
        customerRef: data.customerRef === undefined ? undefined : data.customerRef,
        paidAmount: data.paidAmount ?? undefined,
        status: revertOverdue ? (existing.paidAmount > 0 ? 'partial' : 'sent') : undefined,
      },
    });

    // Document importé (TrustUp) sans détail de lignes : ses montants sont stockés tels quels. Enregistrer l'en-tête
    // (chantier, client…) envoie une liste de lignes vide — la traiter reviendrait à recalculer les totaux à
    // partir de rien et les remettre à 0 (fait : 23 devis/factures remis à 0 le 05/10). On ne touche donc aux
    // lignes que si le document en avait déjà, ou si on en envoie réellement.
    const hadLines = data.lines ? await prisma.documentLine.count({ where: { documentId: existing.id } }) : 0;
    if (data.lines && (data.lines.length > 0 || hadLines > 0)) {
      await prisma.documentLine.deleteMany({ where: { documentId: existing.id } });
      if (data.lines.length) await prisma.documentLine.createMany({ data: buildLineRows(existing.id, data.lines) });
      await refreshDocTotals(existing.id);
    }
    if (existing.lockedAt) await syncLedgerEntryForDocument(existing.id);
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

/**
 * Facture -> note de crédit liée. Sans corps : crédit TOTAL (ce qui reste à créditer), mêmes lignes, en brouillon à ajuster.
 * Avec { amountTtc } : crédit PARTIEL de ce montant (jamais au-delà du reste à créditer). { reason } : motif ajouté à la note.
 * { issue: true } : émet aussitôt la note de crédit (numéro NC…), ce qui passe la facture « créditée » si elle est intégralement créditée.
 */
const creditNoteInput = z.object({
  amountTtc: z.coerce.number().positive().optional(),
  reason: z.string().trim().max(500).optional(),
  issue: z.boolean().optional(),
});
documentsRouter.post(
  '/:id/credit-note',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const body = creditNoteInput.parse(req.body ?? {});
    const src = await prisma.document.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!src) throw new HttpError(404, 'Document introuvable');
    if (src.kind !== 'invoice' && src.kind !== 'deposit_invoice') throw new HttpError(422, 'Note de crédit sur une facture uniquement');
    if (!src.number) throw new HttpError(422, 'Émettez d’abord la facture : une note de crédit se fait sur une facture émise.');
    const already = await creditedTtc(src.id);
    const remaining = Math.round((Math.abs(src.totalTtc) - already) * 100) / 100;
    if (remaining <= 0.01) throw new HttpError(409, `La facture ${src.number} est déjà intégralement créditée.`);
    const amount = body.amountTtc != null ? Math.round(body.amountTtc * 100) / 100 : remaining;
    if (amount > remaining + 0.005) {
      throw new HttpError(422, `Montant trop élevé : il ne reste que ${remaining.toFixed(2).replace('.', ',')} € à créditer sur ${src.number}.`);
    }
    const full = Math.abs(amount - Math.abs(src.totalTtc)) < 0.005;
    // facture importée sans détail de lignes : on retrouve son taux de TVA unique depuis ses totaux
    const effRate = src.vatRate ?? (src.lines.length === 0 && src.totalHt > 0 ? Math.round((src.totalVat / src.totalHt) * 100) / 100 : null);
    if (!src.lines.length && effRate == null) throw new HttpError(422, `La facture ${src.number} n’a ni lignes ni montant HT : impossible d’en déduire une note de crédit.`);
    const seq = await nextCounter('doc:draft');
    const cn = await prisma.document.create({
      data: {
        kind: 'credit_note', direction: 'credit_note', draftRef: `BROUILLON-${seq}`,
        status: 'draft', worksiteId: src.worksiteId, contactId: src.contactId,
        title: src.title, parentId: src.id,
        note: `Note de crédit${full ? '' : ' partielle'} sur facture ${src.number}${body.reason ? ` — ${body.reason}` : ''}`,
        source: 'manual', createdById: req.user!.id,
      },
    });
    if (full && src.lines.length) {
      await prisma.documentLine.createMany({ data: cloneLineRows(cn.id, src.lines) });
    } else {
      await prisma.documentLine.createMany({
        data: partialCreditLines(
          cn.id,
          { totalTtc: Math.abs(src.totalTtc), vatRate: effRate, lines: src.lines },
          amount,
          `Note de crédit${full ? '' : ' partielle'} sur facture ${src.number}${body.reason ? ` — ${body.reason}` : ''}`,
        ),
      });
    }
    await refreshDocTotals(cn.id);
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'credit-note', entity: 'document', entityId: cn.id, meta: { parent: src.number, amountTtc: amount } } });
    if (body.issue) await issueDocument(cn.id);
    const out = await prisma.document.findUnique({ where: { id: cn.id }, include: docInclude });
    res.status(201).json({ document: out });
  }),
);

/**
 * Facture HISTORIQUE (écriture du grand livre issue de l'Excel, sans document dans l'appli) -> document « facture » émis, avec le
 * même numéro et les mêmes montants, adoptant l'écriture (aucun doublon au grand livre). Sert surtout à pouvoir faire une note
 * de crédit dessus. Idempotent : si le document existe déjà on le renvoie.
 */
documentsRouter.post(
  '/from-ledger/:ledgerId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.ledgerId } });
    if (!e || e.direction !== 'sale') throw new HttpError(404, 'Facture de vente introuvable au grand livre');
    if (e.documentId) {
      res.json({ document: await prisma.document.findUnique({ where: { id: e.documentId }, include: docInclude }) });
      return;
    }
    if (!e.docNumber) throw new HttpError(422, 'Cette écriture n’a pas de numéro de facture.');
    const clash = await prisma.document.findFirst({ where: { kind: { in: ['invoice', 'deposit_invoice'] }, number: e.docNumber } });
    if (clash) throw new HttpError(409, `Le numéro ${e.docNumber} existe déjà dans l’appli : utilisez cette facture.`);
    const ttc = e.ttc ?? e.ht + (e.vatDue ?? 0);
    const vatRate = e.ht > 0 ? Math.max(0, Math.round(((ttc - e.ht) / e.ht) * 100) / 100) : 0;
    const paid = e.paymentStatus === 'Payé';
    const issuedOn = e.date ?? new Date();
    const doc = await prisma.document.create({
      data: {
        kind: 'invoice', direction: 'sale', number: e.docNumber, status: paid ? 'paid' : 'sent',
        worksiteId: e.worksiteId, contactId: e.contactId, title: `Facture ${e.docNumber}`, issuedOn, lockedAt: issuedOn,
        source: 'legacy', createdById: req.user!.id,
      },
    });
    await prisma.documentLine.createMany({
      data: buildLineRows(doc.id, [{ kind: 'item', label: `Facture ${e.docNumber}`, description: null, qty: 1, unit: 'forfait', unitPriceHt: e.ht, discountPct: 0, vatRate, priceItemId: null }]),
    });
    const totals = await refreshDocTotals(doc.id);
    if (paid) await prisma.document.update({ where: { id: doc.id }, data: { paidAmount: totals.totalTtc, paidOn: e.paidOn ?? issuedOn } });
    await prisma.ledgerEntry.update({ where: { id: e.id }, data: { documentId: doc.id } }); // adopte l'écriture : pas de doublon
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'from-ledger', entity: 'document', entityId: doc.id, meta: { number: doc.number } } });
    res.status(201).json({ document: await prisma.document.findUnique({ where: { id: doc.id }, include: docInclude }) });
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
    const status = paidAmount + PAYMENT_TOLERANCE >= doc.totalTtc ? 'paid' : 'partial';
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { paidAmount, paidOn: status === 'paid' ? paidOn : doc.paidOn, status },
      include: docInclude,
    });
    await syncLedgerEntryForDocument(doc.id);
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
          assignees: { create: (assigneeIds ?? []).map((personId) => ({ personId })) },
        },
        include: taskInclude,
      });
      tasks.push(serializeTask(task));
    }
    res.status(201).json({ tasks });
  }),
);

/**
 * Enregistrement d'un envoi effectué hors JJD. Aucun transport n'est simulé.
 * Peppol reste bloqué tant qu'un connecteur validé n'est pas installé.
 */
documentsRouter.post(
  '/:id/send',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    validateExternalDeliveryRequest(req.body);
    let doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const delivery = externalDeliveryState(doc);
    if (delivery.alreadyRecorded) return res.json({ document: doc, note: 'L’envoi est déjà enregistré.' });
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: delivery.status,
        sentAt: new Date(),
      },
      include: docInclude,
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'send', entity: 'document', entityId: doc.id, meta: { channel: 'external', confirmedExternal: true } },
    });
    res.json({
      document: updated,
      note: `${DOC_KIND_LABEL[doc.kind]} : envoi externe enregistré. Aucun document transmis par JJD.`,
    });
  }),
);

/* --------------------------------------------------------- Bibliothèque prix */

export const priceItemsRouter = Router();

priceItemsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { q: qRaw, category } = req.query as Record<string, string>;
    const q = qRaw?.toLowerCase();
    const where: Record<string, unknown> = { active: true };
    if (category) where.category = category;
    if (q) where.OR = [{ label: { contains: q, ...insensitive } }, { ref: { contains: q, ...insensitive } }, { description: { contains: q, ...insensitive } }];
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
