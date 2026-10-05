/**
 * Dépenses / factures d'achat — CRUD autour de LedgerEntry (grand livre).
 * L'historique Excel (~5000 lignes) et les saisies manuelles cohabitent ;
 * les rapports (marge chantier, P&L, analyses) lisent déjà LedgerEntry.
 */
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import path from 'node:path';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import multer from 'multer';
import { zipSync } from 'fflate';
import { expenseInput, linkInvoiceInput, saleEntryBackfillInput, parseAmount, parseLooseDate } from '@jjd/shared';
import { prisma } from '../db.js';
import { insensitive } from '../lib/search.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE, FIELD_OFFICE } from '../lib/auth.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';
import { nameOverlap } from '../lib/bank-match.js';
import { extractDocumentInfo, suggestExpenseCategory } from '../lib/document-extract.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';
import { invoiceMailboxConfigured, syncInvoiceMailbox, reprocessEmailEntries, scanInvoiceMailboxHistory, PROCESSED_MAILBOX } from '../lib/invoice-mailbox.js';
import { scanAllEntriesForRefs } from '../lib/purchase-ref-scan.js';
import { findPurchaseCandidates } from '../lib/purchase-candidates.js';

export const expensesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const inc = {
  worksite: { select: { id: true, ref: true, title: true } },
  vehicle: { select: { id: true, code: true, plate: true, name: true, brand: true, model: true } },
  contact: { select: { id: true, name: true } },
  category: { select: { code: true, label: true } },
  createdBy: { select: { email: true } },
  // bordereau (direction "delivery_slip") -> facture reçue ensuite ; facture -> ses bordereaux liés
  linkedInvoice: { select: { id: true, docNumber: true, date: true } },
  _count: { select: { bordereaux: true } },
} as const;

function docTypeOf(direction: string): string {
  return direction === 'credit_note' ? 'Note de crédit' : direction === 'delivery_slip' ? 'Bordereau' : "Facture d'achat";
}

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

/** Filtre commun à la liste et à l'export CSV. */
function buildWhere(q: Record<string, string>) {
  const { q: searchRaw, paid, worksiteId, vehicleId, contactId, category, from, to, year, type, linked } = q;
  // recherche insensible à la casse (y compris accents : le repli SQLite n'insensibilise que
  // l'ASCII, "café"/"CAFÉ" ne matcheraient pas sans ce passage en minuscules côté JS)
  const search = searchRaw?.toLowerCase();
  const and: Record<string, unknown>[] = [];
  if (type) {
    // Filtre explicite (purchase | sale | credit_note | delivery_slip) : direction telle quelle,
    // sans l'exclusion "vente" ci-dessous — sert notamment la file de contrôle à retrouver une
    // écriture de vente orpheline, invisible dans la vue achats par défaut (direction toujours
    // exclue de ce tableau tant qu'on ne la demande pas explicitement).
    and.push({ direction: type });
  } else {
    // Vue par défaut : achats + notes de crédit d'achat (une NC de vente réduit le CA, pas une
    // dépense) + bordereaux (preuve d'enlèvement/paiement reçue avant la facture — voir
    // linkedInvoiceId). categoryRaw peut être NULL (saisie manuelle sans catégorie) :
    // NOT{contains} exclurait alors la ligne (NULL n'est ni "contient" ni "ne contient pas" en
    // SQL) -> OR explicite.
    and.push({
      OR: [
        { direction: 'purchase' },
        { direction: 'delivery_slip' },
        { direction: 'credit_note', OR: [{ categoryRaw: null }, { NOT: { categoryRaw: { contains: 'vente' } } }] },
      ],
    });
  }
  // linked = 0/1 ne s'applique qu'aux bordereaux (linkedInvoiceId)
  if (linked === '0') and.push({ linkedInvoiceId: null });
  if (linked === '1') and.push({ NOT: { linkedInvoiceId: null } });
  if (worksiteId) and.push({ worksiteId });
  if (vehicleId) and.push({ vehicleId });
  if (contactId) and.push({ contactId });
  if (category) and.push({ categoryRaw: category });
  if (year) and.push({ year: Number(year) });
  if (from) and.push({ date: { gte: new Date(from) } });
  if (to) and.push({ date: { lte: new Date(to) } });
  if (paid === '1') and.push({ paymentStatus: { equals: 'Payé' } });
  if (paid === '0') and.push({ NOT: { paymentStatus: { equals: 'Payé' } } });
  if (q.overdue === '1') and.push({ direction: 'purchase', dueDate: { not: null, lt: new Date() }, NOT: { paymentStatus: 'Payé' } });
  if (search) {
    and.push({
      OR: [
        { supplierName: { contains: search, ...insensitive } },
        { docNumber: { contains: search, ...insensitive } },
        { categoryRaw: { contains: search, ...insensitive } },
        { notes: { contains: search, ...insensitive } },
        { worksiteRef: { contains: search, ...insensitive } },
        { contact: { name: { contains: search, ...insensitive } } },
        { worksite: { ref: { contains: search, ...insensitive } } },
      ],
    });
  }
  return and;
}

expensesRouter.get(
  '/',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const { page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const and = buildWhere(req.query as Record<string, string>);
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));
    const isPaidStr = (s: string | null) =>
      (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim() === 'paye';

    const [items, all] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: { AND: and },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: inc,
      }),
      // totaux (KPI) sur l'ensemble du filtre, pas seulement la page affichée
      prisma.ledgerEntry.findMany({
        where: { AND: and },
        select: { ht: true, ttc: true, paymentStatus: true, direction: true, linkedInvoiceId: true, dueDate: true },
      }),
    ]);

    const now = new Date();
    const totals = all.reduce(
      (acc, e) => {
        acc.count += 1;
        // bordereau : pas un document fiscal (pas de TVA récupérable dessus) -> exclu des
        // montants, sinon la facture reçue ensuite le compterait deux fois. Seul son statut
        // « en attente de facture » (non relié) intéresse ici.
        if (e.direction === 'delivery_slip') {
          if (!e.linkedInvoiceId) acc.pendingSlips += 1;
          return acc;
        }
        const ttc = e.ttc ?? e.ht;
        const sign = e.direction === 'credit_note' ? -1 : 1;
        acc.ht += sign * e.ht;
        acc.ttc += sign * ttc;
        // une note de crédit vient toujours en déduction (elle n'est jamais "payée")
        if (e.direction === 'credit_note') acc.unpaidTtc -= ttc;
        else if (!isPaidStr(e.paymentStatus)) {
          acc.unpaidTtc += ttc;
          if (e.dueDate && e.dueDate < now) { acc.overdueCount += 1; acc.overdueTtc += ttc; }
        }
        return acc;
      },
      { count: 0, ht: 0, ttc: 0, unpaidTtc: 0, pendingSlips: 0, overdueCount: 0, overdueTtc: 0 },
    );

    res.json({
      items: items.map((e) => ({
        ...e,
        supplier: e.contact?.name ?? e.supplierName ?? null,
        categoryLabel: e.category?.label ?? e.categoryRaw ?? null,
        paid: isPaidStr(e.paymentStatus),
        hasPdf: !!e.pdfPath,
        editable: e.source !== 'xlsx',
      })),
      totals: {
        count: totals.count,
        ht: Math.round(totals.ht * 100) / 100,
        ttc: Math.round(totals.ttc * 100) / 100,
        unpaidTtc: Math.round(totals.unpaidTtc * 100) / 100,
        pendingSlips: totals.pendingSlips,
        overdueCount: totals.overdueCount,
        overdueTtc: Math.round(totals.overdueTtc * 100) / 100,
      },
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totals.count / pageSize)),
    });
  }),
);

/* ------------------------------------------------------------------ meta */

expensesRouter.get(
  '/meta',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (_req, res) => {
    const [categories, rawCats, suppliers, worksites, vehicles, years] = await Promise.all([
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
      // chantiers clôturés/archivés inclus (en fin de liste) : on doit pouvoir y rattacher une dépense
      prisma.worksite.findMany({
        orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
        take: 5000,
        select: { id: true, ref: true, title: true, archived: true, status: true },
      }),
      prisma.vehicle.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, plate: true, name: true, brand: true, model: true },
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
      worksites: worksites.map((w) => ({ id: w.id, name: `${w.ref} · ${w.title}${w.status === 'closed' ? ' (clôturé)' : w.archived ? ' (archivé)' : ''}` })),
      vehicles: vehicles.map((v) => ({ id: v.id, name: [v.code, v.name || `${v.brand ?? ''} ${v.model ?? ''}`.trim(), v.plate].filter(Boolean).join(' · ') })),
      years: years.map((y) => y.year).filter(Boolean),
    });
  }),
);

/**
 * Repère, dans les factures d'achat déjà reçues, les articles qui reviennent souvent mais ne
 * sont pas encore suivis en stock — best-effort (voir lib/purchase-candidates.ts), à vérifier
 * avant de créer l'article : ne crée jamais rien tout seul. Route à chemin fixe : doit rester
 * déclarée avant GET /:id, sinon Express la confond avec une dépense d'id "purchase-candidates".
 */
expensesRouter.get(
  '/purchase-candidates',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json({ items: await findPurchaseCandidates() });
  }),
);

/* ------------------------------------------------------------------ export */

/** Export groupé : les pièces jointes de plusieurs dépenses en un seul .zip (à glisser chez le comptable). */
expensesRouter.get(
  '/export.zip',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new HttpError(422, 'Aucune dépense sélectionnée');
    if (ids.length > 300) throw new HttpError(422, 'Trop de dépenses sélectionnées (300 max)');
    const items = await prisma.ledgerEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, pdfPath: true, docNumber: true, supplierName: true, contact: { select: { name: true } } },
    });

    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const e of items) {
      if (!e.pdfPath) continue;
      const file = resolveUpload(e.pdfPath);
      if (!existsSync(file)) continue;
      const ext = path.extname(file) || '.pdf';
      const label = (e.docNumber || e.contact?.name || e.supplierName || e.id).replace(/[^\w.-]+/g, '-');
      let name = `${label}${ext}`;
      let i = 2;
      while (used.has(name)) { name = `${label}-${i}${ext}`; i++; }
      used.add(name);
      files[name] = new Uint8Array(readFileSync(file));
    }
    if (!Object.keys(files).length) throw new HttpError(422, 'Aucune des dépenses sélectionnées n’a de pièce jointe à exporter.');

    const zipped = zipSync(files, { level: 6 });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="depenses-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(Buffer.from(zipped));
  }),
);

/* --------------------------------------------------------- export/import Excel */

const EXPENSE_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'date', label: 'Date' },
  { key: 'dueDate', label: 'Échéance' },
  { key: 'type', label: 'Type' },
  { key: 'supplier', label: 'Fournisseur' },
  { key: 'docNumber', label: 'N° document' },
  { key: 'worksiteRef', label: 'Chantier' },
  { key: 'category', label: 'Catégorie' },
  { key: 'ht', label: 'HT' },
  { key: 'vatRecup', label: 'TVA récup' },
  { key: 'ttc', label: 'TTC' },
  { key: 'paymentStatus', label: 'Statut' },
  { key: 'notes', label: 'Notes' },
];

/** Export en CSV (éditable dans Excel) — respecte les mêmes filtres que la liste. */
expensesRouter.get(
  '/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const and = buildWhere(req.query as Record<string, string>);
    const items = await prisma.ledgerEntry.findMany({
      where: { AND: and },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
      include: inc,
    });
    const rows = items.map((e) => ({
      id: e.id,
      date: e.date,
      dueDate: e.dueDate,
      type: e.direction === 'credit_note' ? 'Note de crédit' : 'Achat',
      supplier: e.contact?.name ?? e.supplierName ?? '',
      docNumber: e.docNumber ?? '',
      worksiteRef: e.worksite?.ref ?? e.worksiteRef ?? '',
      category: e.category?.label ?? e.categoryRaw ?? '',
      ht: e.ht,
      vatRecup: e.vatRecup,
      ttc: e.ttc,
      paymentStatus: e.paymentStatus ?? 'Non payé',
      notes: e.notes ?? '',
    }));
    const csv = toCsv(EXPENSE_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="achats-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

/**
 * Réimporte un fichier (précédemment exporté puis corrigé dans Excel, ou nouveau).
 * Une ligne avec un `id` connu met à jour l'écriture ; sans `id` (ou inconnu), une
 * nouvelle écriture est créée. Une ligne absente du fichier n'est jamais supprimée.
 */
expensesRouter.post(
  '/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const rows = readTableBuffer(req.file.buffer, req.file.originalname);
    if (rows.length > 5000) throw new HttpError(422, 'Trop de lignes (5000 max)');

    let created = 0;
    let updated = 0;
    const warnings: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2; // 1 = en-tête
      const id = pick(row, 'id');
      const date = parseLooseDate(pick(row, 'date'));
      if (!date) { warnings.push({ row: rowNum, message: 'Date manquante ou invalide — ligne ignorée' }); continue; }

      const worksiteRef = pick(row, 'chantier', 'worksiteref', 'ref chantier');
      let worksiteId: string | null | undefined;
      if (worksiteRef) {
        const w = await prisma.worksite.findFirst({ where: { ref: worksiteRef } });
        if (w) worksiteId = w.id;
        else warnings.push({ row: rowNum, message: `Chantier « ${worksiteRef} » introuvable — non modifié` });
      }

      const supplierName = pick(row, 'fournisseur', 'supplier');
      let contactId: string | null | undefined;
      if (supplierName) {
        const c = await prisma.contact.findFirst({
          where: { name: { equals: supplierName }, type: { in: ['supplier', 'both'] } },
        });
        if (c) contactId = c.id;
      }

      const categoryLabel = pick(row, 'categorie', 'catégorie', 'category');
      let categoryCode: string | null | undefined;
      let categoryRaw: string | null | undefined = categoryLabel ?? undefined;
      if (categoryLabel) {
        const cat = await prisma.category.findFirst({ where: { label: { equals: categoryLabel } } });
        if (cat) { categoryCode = cat.code; categoryRaw = cat.label; }
      }

      const typeRaw = (pick(row, 'type') ?? '').toLowerCase();
      const direction = /credit|avoir/.test(typeRaw) ? 'credit_note' : 'purchase';
      const paidRaw = (pick(row, 'statut', 'paymentstatus') ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
      const paymentStatus = paidRaw === 'paye' ? 'Payé' : 'Non payé';

      const data: Record<string, unknown> = {
        date,
        dueDate: parseLooseDate(pick(row, 'echeance', 'échéance', 'duedate')),
        direction,
        docType: direction === 'credit_note' ? 'Note de crédit' : "Facture d'achat",
        docNumber: pick(row, 'n document', 'docnumber', 'numero') || null,
        worksiteRef: worksiteRef || null,
        ...(worksiteId !== undefined ? { worksiteId } : {}),
        supplierName: supplierName || null,
        ...(contactId !== undefined ? { contactId } : {}),
        categoryCode: categoryCode ?? null,
        categoryRaw: categoryRaw ?? null,
        ht: parseAmount(pick(row, 'ht')) ?? 0,
        vatRecup: parseAmount(pick(row, 'tva recup', 'tva récup', 'vatrecup')),
        ttc: parseAmount(pick(row, 'ttc')),
        paymentStatus,
        ...derive(date),
        notes: pick(row, 'notes') || null,
      };

      if (id) {
        const existing = await prisma.ledgerEntry.findUnique({ where: { id } });
        if (existing) {
          await prisma.ledgerEntry.update({ where: { id }, data });
          updated++;
          continue;
        }
        warnings.push({ row: rowNum, message: `id « ${id} » introuvable — ligne créée comme nouvelle écriture` });
      }
      await prisma.ledgerEntry.create({ data: { ...data, source: 'manual', createdById: req.user!.id } as Prisma.LedgerEntryUncheckedCreateInput });
      created++;
    }

    res.json({ created, updated, warnings });
  }),
);

/* ------------------------------------------------------------------ détail */

expensesRouter.get(
  '/:id',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, include: inc });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const matches = await prisma.bankTransactionMatch.findMany({
      where: { ledgerEntryId: e.id },
      include: { bankTransaction: { select: { id: true, bookingDate: true, amount: true, bank: true, counterpartyName: true, communication: true } } },
    });
    const bankMatches = matches.map((m) => ({ matchId: m.id, ...m.bankTransaction }));
    res.json({ expense: { ...e, hasPdf: !!e.pdfPath, editable: e.source !== 'xlsx', bankMatches } });
  }),
);

/** Transactions bancaires non rapprochées susceptibles de correspondre à cette dépense. */
expensesRouter.get(
  '/:id/bank-suggestions',
  requireAuth(...FIELD_OFFICE),
  asyncHandler(async (req, res) => {
    const e = await prisma.ledgerEntry.findUnique({
      where: { id: req.params.id },
      select: { ttc: true, ht: true, date: true, bankComm: true, supplierName: true, contact: { select: { name: true } } },
    });
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const amount = Math.abs(e.ttc ?? e.ht ?? 0);
    const supplier = e.contact?.name ?? e.supplierName ?? '';

    // Recherche libre (texte, montant, dates, paiements déjà rapprochés compris) : dès qu'un critère est donné on n'impose
    // plus « même montant ± 1 € et ± 2 mois » — c'est l'utilisateur qui cherche. Sans critère : propositions automatiques.
    const qs = req.query as Record<string, string | undefined>;
    const words = (qs.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    const askedAmount = qs.amount !== undefined && qs.amount !== '' ? parseAmount(qs.amount) : null;
    const from = qs.from ? parseLooseDate(qs.from) : null;
    const to = qs.to ? parseLooseDate(qs.to) : null;
    const includeMatched = qs.all === '1';
    const manual = words.length > 0 || askedAmount != null || !!from || !!to || includeMatched;

    const where: Prisma.BankTransactionWhereInput = manual
      ? {
          ...(includeMatched ? {} : { matches: { none: {} } }),
          ...(askedAmount != null ? { OR: [{ amount: { gte: Math.abs(askedAmount) - 0.5, lte: Math.abs(askedAmount) + 0.5 } }, { amount: { gte: -(Math.abs(askedAmount) + 0.5), lte: -(Math.abs(askedAmount) - 0.5) } }] } : {}),
          ...(from || to ? { bookingDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          AND: words.map((w) => ({
            OR: [
              { description: { contains: w, ...insensitive } },
              { counterpartyName: { contains: w, ...insensitive } },
              { communication: { contains: w, ...insensitive } },
            ],
          })),
        }
      : {
          matches: { none: {} },
          // décaissement : montant négatif de valeur proche du TTC de la dépense
          amount: { gte: -(amount + 1), lte: -(amount - 1) },
          ...(e.date ? { bookingDate: { gte: new Date(e.date.getTime() - 30 * 86400000), lte: new Date(e.date.getTime() + 60 * 86400000) } } : {}),
        };
    const raw = await prisma.bankTransaction.findMany({
      where,
      orderBy: { bookingDate: 'desc' },
      take: manual ? 60 : 40,
      select: {
        id: true, bookingDate: true, amount: true, bank: true, counterpartyName: true, communication: true, description: true,
        matches: { select: { ledgerEntry: { select: { docNumber: true, supplierName: true } }, document: { select: { number: true } } } },
      },
    });
    const items = raw
      .map(({ matches, ...t }) => ({
        ...t,
        nameMatch: !!supplier && !!(t.counterpartyName || t.description) && nameOverlap(supplier, `${t.counterpartyName ?? ''} ${t.description ?? ''}`),
        // paiement déjà rapproché à d'autres factures (un paiement peut en couvrir plusieurs)
        matchedTo: matches.map((m) => m.ledgerEntry?.docNumber ?? m.document?.number ?? m.ledgerEntry?.supplierName ?? '?'),
      }))
      // le fournisseur qui correspond d'abord, puis par date décroissante
      .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch))
      .slice(0, manual ? 40 : 15);
    res.json({ items, supplier, manual });
  }),
);

/**
 * Pré-lit une pièce (PDF) avant création : type (facture/NC), n°, date,
 * montants, fournisseur et chantier détectés — best-effort, à vérifier
 * ensuite dans le formulaire. Ne crée rien.
 */
expensesRouter.post(
  '/extract',
  requireAuth(...FIELD_OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const extraction = await extractDocumentInfo(req.file.buffer, req.file.mimetype, ['supplier', 'both']);
    const isPdf = req.file.mimetype === 'application/pdf';
    const suggestedCategory = isPdf ? await suggestExpenseCategory(req.file.buffer, extraction.contactId) : null;
    res.json({ extraction, suggestedCategory });
  }),
);

/** Statut + déclenchement manuel de la boîte mail factures (voir lib/invoice-mailbox.ts). */
expensesRouter.get(
  '/mailbox-status',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json({ configured: invoiceMailboxConfigured() });
  }),
);

expensesRouter.post(
  '/sync-mailbox',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!invoiceMailboxConfigured()) throw new HttpError(409, 'Boîte mail non configurée');
    const stats = await syncInvoiceMailbox();
    res.json(stats);
  }),
);

/** Repasse les dépenses "Boîte mail" déjà importées mais mal extraites (montant/n°/fournisseur
 *  manquants) dans l'extracteur — utile après une amélioration de document-extract.ts pour
 *  corriger les PDF déjà en base, pas seulement les prochains reçus. */
expensesRouter.post(
  '/reprocess-email',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const stats = await reprocessEmailEntries();
    res.json(stats);
  }),
);

/**
 * Recherche, dans le texte des factures d'achat déjà en base, les références produit déjà
 * enregistrées sur les articles de stock (StockSupplier.supplierRef) — alimente l'historique
 * d'achat par article (voir GET /api/stock/items/:id/purchase-history). À relancer après avoir
 * ajouté une nouvelle réf. fournisseur, pour retrouver son historique dans les factures passées.
 */
expensesRouter.post(
  '/scan-purchase-refs',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const stats = await scanAllEntriesForRefs();
    res.json(stats);
  }),
);

/**
 * Reprend le dossier « Traité par JJD App » : un mail classé « traité » avant le correctif du
 * multi-pièces-jointes (un échec sur l'une d'elles y faisait atterrir le mail avec sa vraie
 * facture jamais importée) peut y contenir une facture manquante. Ne modifie jamais les mails
 * (comme scanInvoiceMailboxHistory) — dédoublonne par n° de document / montant + date, jamais
 * de doublon si une pièce du mail était en fait déjà connue.
 */
expensesRouter.post(
  '/scan-processed-mailbox',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!invoiceMailboxConfigured()) throw new HttpError(409, 'Boîte mail non configurée');
    const stats = await scanInvoiceMailboxHistory([PROCESSED_MAILBOX]);
    res.json(stats);
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
        direction: d.direction,
        docType: docTypeOf(d.direction),
        docNumber: d.docNumber ?? null,
        supplierName,
        contactId: d.contactId ?? null,
        categoryCode: d.categoryCode ?? null,
        categoryRaw: d.categoryCode
          ? (await prisma.category.findUnique({ where: { code: d.categoryCode }, select: { label: true } }))?.label ?? null
          : null,
        worksiteId: d.worksiteId ?? null,
        vehicleId: d.vehicleId ?? null,
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

/**
 * Écriture "Facture de vente" du grand livre saisie/rattrapée à la main — pour compléter le
 * CA (utilisé par "Facturé HT" sur la liste Chantiers) quand le dernier import xlsx n'est
 * pas à jour. Distinct de POST / (achats/dépenses uniquement) : direction toujours 'sale',
 * le contact est le client facturé, jamais un fournisseur.
 */
expensesRouter.post(
  '/sale-backfill',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const d = saleEntryBackfillInput.parse(req.body);
    let clientName = d.clientName ?? null;
    if (d.contactId) {
      const c = await prisma.contact.findUnique({ where: { id: d.contactId }, select: { name: true } });
      if (c) clientName = c.name;
    }
    const e = await prisma.ledgerEntry.create({
      data: {
        ...derive(d.date),
        date: d.date,
        direction: 'sale',
        docType: 'Facture de vente',
        docNumber: d.docNumber ?? null,
        supplierName: clientName,
        contactId: d.contactId ?? null,
        categoryRaw: d.categoryRaw ?? null,
        worksiteId: d.worksiteId ?? null,
        ht: d.ht,
        vatDue: d.vatDue ?? null,
        ttc: d.ttc ?? null,
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
    if (d.direction) {
      data.direction = d.direction;
      data.docType = docTypeOf(d.direction);
    }
    if ('docNumber' in d) data.docNumber = d.docNumber ?? null;
    if ('worksiteId' in d) data.worksiteId = d.worksiteId ?? null;
    if ('vehicleId' in d) data.vehicleId = d.vehicleId ?? null;
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
    if (e.source === 'xlsx') throw new HttpError(409, "Écriture de l'import historique Excel : suppression impossible.");
    // les BankTransactionMatch de cette dépense partent en cascade (onDelete: Cascade) ; il reste
    // à nettoyer le badge de confiance des transactions qui n'ont plus aucun rapprochement.
    const affectedTxIds = (await prisma.bankTransactionMatch.findMany({ where: { ledgerEntryId: req.params.id }, select: { bankTransactionId: true } })).map((m) => m.bankTransactionId);
    await prisma.ledgerEntry.delete({ where: { id: req.params.id } });
    if (affectedTxIds.length) {
      const stillMatched = await prisma.bankTransactionMatch.findMany({ where: { bankTransactionId: { in: affectedTxIds } }, select: { bankTransactionId: true } });
      const stillMatchedSet = new Set(stillMatched.map((m) => m.bankTransactionId));
      const nowEmpty = affectedTxIds.filter((id) => !stillMatchedSet.has(id));
      if (nowEmpty.length) await prisma.bankTransaction.updateMany({ where: { id: { in: nowEmpty } }, data: { matchConfidence: null, matchedAt: null } });
    }
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

/* ------------------------------------------------------------------ lien bordereau -> facture */

/**
 * Relie un bordereau (direction "delivery_slip") à la facture d'achat reçue ensuite
 * (`invoiceId: null` pour délier). Plusieurs bordereaux peuvent pointer vers la même facture
 * (un fournisseur en consolide parfois plusieurs sur une facture mensuelle unique).
 */
expensesRouter.post(
  '/:id/link',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const slip = await prisma.ledgerEntry.findUnique({ where: { id: req.params.id }, select: { id: true, direction: true } });
    if (!slip) throw new HttpError(404, 'Bordereau introuvable');
    if (slip.direction !== 'delivery_slip') throw new HttpError(422, 'Seul un bordereau peut être relié à une facture.');
    const { invoiceId } = linkInvoiceInput.parse(req.body);
    if (invoiceId) {
      if (invoiceId === slip.id) throw new HttpError(422, 'Un bordereau ne peut pas se relier lui-même.');
      const invoice = await prisma.ledgerEntry.findUnique({ where: { id: invoiceId }, select: { direction: true } });
      if (!invoice || invoice.direction !== 'purchase') throw new HttpError(422, 'Facture d’achat introuvable.');
    }
    const e = await prisma.ledgerEntry.update({ where: { id: slip.id }, data: { linkedInvoiceId: invoiceId ?? null }, include: inc });
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
