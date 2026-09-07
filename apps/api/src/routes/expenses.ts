/**
 * Dépenses / factures d'achat — CRUD autour de LedgerEntry (grand livre).
 * L'historique Excel (~5000 lignes) et les saisies manuelles cohabitent ;
 * les rapports (marge chantier, P&L, analyses) lisent déjà LedgerEntry.
 */
import { Router } from 'express';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import multer from 'multer';
import { expenseInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, FIELD_OFFICE } from '../lib/auth.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';

export const expensesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const inc = {
  worksite: { select: { id: true, ref: true, title: true } },
  contact: { select: { id: true, name: true } },
  category: { select: { code: true, label: true } },
  createdBy: { select: { email: true } },
} as const;

function derive(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

/** Résout le chemin disque d'un fichier « /uploads/… » stocké par storeFile. */
function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

/* ------------------------------------------------------------------ liste */

expensesRouter.get(
  '/',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const { q, paid, worksiteId, contactId, category, from, to, year } = req.query as Record<string, string>;
    // achats + notes de crédit d'achat (une NC de vente réduit le CA, pas une dépense)
    const and: Record<string, unknown>[] = [
      { OR: [{ direction: 'purchase' }, { direction: 'credit_note', NOT: { categoryRaw: { contains: 'vente' } } }] },
    ];
    if (worksiteId) and.push({ worksiteId });
    if (contactId) and.push({ contactId });
    if (category) and.push({ categoryRaw: category });
    if (year) and.push({ year: Number(year) });
    if (from) and.push({ date: { gte: new Date(from) } });
    if (to) and.push({ date: { lte: new Date(to) } });
    if (paid === '1') and.push({ paymentStatus: { equals: 'Payé' } });
    if (paid === '0') and.push({ NOT: { paymentStatus: { equals: 'Payé' } } });
    if (q) {
      and.push({
        OR: [
          { supplierName: { contains: q } },
          { docNumber: { contains: q } },
          { categoryRaw: { contains: q } },
          { notes: { contains: q } },
          { contact: { name: { contains: q } } },
          { worksite: { ref: { contains: q } } },
        ],
      });
    }
    const CAP = 2000;
    const isPaidStr = (s: string | null) =>
      (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim() === 'paye';

    const [items, all] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: { AND: and },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: CAP,
        include: inc,
      }),
      // totaux sur l'ensemble du filtre (pas seulement les lignes affichées)
      prisma.ledgerEntry.findMany({ where: { AND: and }, select: { ht: true, ttc: true, paymentStatus: true } }),
    ]);

    const totals = all.reduce(
      (acc, e) => {
        const ttc = e.ttc ?? e.ht;
        acc.count += 1;
        acc.ht += e.ht;
        acc.ttc += ttc;
        if (!isPaidStr(e.paymentStatus)) acc.unpaidTtc += ttc;
        return acc;
      },
      { count: 0, ht: 0, ttc: 0, unpaidTtc: 0 },
    );

    res.json({
      items: items.map((e) => ({
        ...e,
        supplier: e.contact?.name ?? e.supplierName ?? null,
        categoryLabel: e.category?.label ?? e.categoryRaw ?? null,
        paid: isPaidStr(e.paymentStatus),
        hasPdf: !!e.pdfPath,
        editable: e.source === 'manual',
      })),
      totals: {
        count: totals.count,
        ht: Math.round(totals.ht * 100) / 100,
        ttc: Math.round(totals.ttc * 100) / 100,
        unpaidTtc: Math.round(totals.unpaidTtc * 100) / 100,
      },
      capped: totals.count > CAP,
    });
  }),
);

/* ------------------------------------------------------------------ meta */

expensesRouter.get(
  '/meta',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (_req, res) => {
    const [categories, rawCats, suppliers, worksites, years] = await Promise.all([
      prisma.category.findMany({
        where: { active: true, kind: { in: ['expense', 'salary', 'tax', 'vat'] } },
        orderBy: { label: 'asc' },
        select: { code: true, label: true, kind: true },
      }),
      prisma.ledgerEntry.findMany({
        where: { direction: { in: ['purchase', 'credit_note'] }, categoryRaw: { not: null } },
        distinct: ['categoryRaw'],
        select: { categoryRaw: true },
        orderBy: { categoryRaw: 'asc' },
      }),
      prisma.contact.findMany({
        where: { OR: [{ type: 'supplier' }, { type: 'both' }] },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.worksite.findMany({
        where: { archived: false },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
        select: { id: true, ref: true, title: true },
      }),
      prisma.ledgerEntry.findMany({
        where: { direction: { in: ['purchase', 'credit_note'] }, year: { not: null } },
        distinct: ['year'],
        select: { year: true },
        orderBy: { year: 'desc' },
      }),
    ]);
    res.json({
      categories,
      rawCategories: rawCats.map((c) => c.categoryRaw).filter(Boolean),
      suppliers,
      worksites: worksites.map((w) => ({ id: w.id, name: `${w.ref} · ${w.title}` })),
      years: years.map((y) => y.year).filter(Boolean),
    });
  }),
);

/* ------------------------------------------------------------------ détail */

expensesRouter.get(
  '/:id',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, include: inc });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    res.json({ expense: { ...e, hasPdf: !!e.pdfPath, editable: e.source === 'manual' } });
  }),
);

/* ------------------------------------------------------------------ créer */

expensesRouter.post(
  '/',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const d = expenseInput.parse(req.body);
    let supplierName = d.supplierName ?? null;
    if (d.contactId) {
      const c = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { name: true } });
      if (c) supplierName = c.name;
    }
    const e = await prisma.ledgerEntry.create({
      data: {
        ...derive(d.date),
        date: d.date,
        dueDate: d.dueDate ?? null,
        direction: 'purchase',
        docType: "Facture d'achat",
        docNumber: d.docNumber ?? null,
        supplierName,
        contactId: d.contactId ?? null,
        categoryCode: d.categoryCode ?? null,
        categoryRaw: d.categoryCode
          ? (await prisma.category.findUnique({ where: { code: d.categoryCode }, select: { label: true } }))?.label ?? null
          : null,
        worksiteId: d.worksiteId ?? null,
        ht: d.ht,
        vatRecup: d.vatRecup ?? null,
        ttc: d.ttc ?? null,
        vatRate: d.vatRate ?? null,
        notes: d.notes ?? null,
        paymentStatus: d.paymentStatus,
        paidOn: d.paymentStatus === 'Payé' ? d.date : null,
        source: 'manual',
        createdById: req.user!.id,
      },
      include: inc,
    });
    res.status(201).json({ expense: e });
  }),
);

/* ------------------------------------------------------------------ éditer */

expensesRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Dépense introuvable');
    const d = expenseInput.partial().parse(req.body);

    const data: Record<string, unknown> = {};
    if (d.date) Object.assign(data, derive(d.date), { date: d.date });
    if ('dueDate' in d) data.dueDate = d.dueDate ?? null;
    if ('docNumber' in d) data.docNumber = d.docNumber ?? null;
    if ('worksiteId' in d) data.worksiteId = d.worksiteId ?? null;
    if ('ht' in d) data.ht = d.ht;
    if ('vatRecup' in d) data.vatRecup = d.vatRecup ?? null;
    if ('ttc' in d) data.ttc = d.ttc ?? null;
    if ('vatRate' in d) data.vatRate = d.vatRate ?? null;
    if ('notes' in d) data.notes = d.notes ?? null;
    if ('paymentStatus' in d && d.paymentStatus) {
      data.paymentStatus = d.paymentStatus;
      data.paidOn = d.paymentStatus === 'Payé' ? (existing.paidOn ?? new Date()) : null;
    }
    if (d.contactId !== undefined) {
      data.contactId = d.contactId ?? null;
      if (d.contactId) {
        const c = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { name: true } });
        if (c) data.supplierName = c.name;
      }
    }
    if (d.supplierName !== undefined && !d.contactId) data.supplierName = d.supplierName ?? null;
    if (d.categoryCode !== undefined) {
      data.categoryCode = d.categoryCode ?? null;
      data.categoryRaw = d.categoryCode
        ? (await prisma.category.findUnique({ where: { code: d.categoryCode }, select: { label: true } }))?.label ?? null
        : null;
    }

    const e = await prisma.ledgerEntry.update({ where: { id: existing.id }, data, include: inc });
    res.json({ expense: e });
  }),
);

/* ------------------------------------------------------------------ supprimer */

expensesRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { source: true } });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    if (e.source !== 'manual') throw new HttpError(409, "Écriture importée : suppression impossible (elle vient du fichier Excel).");
    await prisma.bankTransaction.updateMany({ where: { matchedLedgerId: req.params.id }, data: { matchedLedgerId: null, matchConfidence: null, matchedAt: null } });
    await prisma.ledgerEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ statut payé */

expensesRouter.post(
  '/:id/paid',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const paid = req.body?.paid !== false;
    const paidOn = req.body?.paidOn ? new Date(req.body.paidOn) : new Date();
    const e = await prisma.ledgerEntry.update({
      where: { id: req.params.id },
      data: { paymentStatus: paid ? 'Payé' : 'Non payé', paidOn: paid ? paidOn : null },
      include: inc,
    });
    res.json({ expense: e });
  }),
);

/* ------------------------------------------------------------------ pièce jointe */

expensesRouter.post(
  '/:id/pdf',
  requireAuth(...FIELD_OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const okType = req.file.mimetype === 'application/pdf' || /^image\/(jpe?g|png|webp|heic)$/.test(req.file.mimetype);
    if (!okType) throw new HttpError(422, 'Format accepté : PDF ou image.');
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const rel = storeFile(req.file.buffer, req.file.originalname || 'facture.pdf', 'expenses');
    await prisma.ledgerEntry.update({ where: { id: e.id }, data: { pdfPath: rel } });
    res.status(201).json({ ok: true, pdfPath: rel });
  }),
);

expensesRouter.get(
  '/:id/pdf',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { pdfPath: true, docNumber: true } });
    if (!e?.pdfPath) throw new HttpError(404, 'Aucune pièce jointe');
    const file = resolveUpload(e.pdfPath);
    if (!existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename="${(e.docNumber ?? 'facture').replace(/[^\w.-]/g, '_')}${ext}"`);
    createReadStream(file).pipe(res);
  }),
);

expensesRouter.delete(
  '/:id/pdf',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.ledgerEntry.update({ where: { id: req.params.id }, data: { pdfPath: null } });
    res.json({ ok: true });
  }),
);
