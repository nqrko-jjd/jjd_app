import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { prisma } from '../db.js';
import { insensitive } from '../lib/search.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, requirePartner, OFFICE } from '../lib/auth.js';
import { consolidatedPnl, profitShare, forecastReceivable } from '../lib/consolidated.js';
import { analytics } from '../lib/analytics.js';
import { autoMatchAll, recomputeDocumentPayment, documentIdForLedger } from '../lib/bank-match.js';
import { parseBankCsv, decodeCsvBuffer, type ParsedBankRow } from '../lib/bank-csv.js';
import { parseCardStatement, pdfToRawText, pdftotextAvailable } from '../lib/bank-pdf.js';
import { parseScreenshots, screenshotImportAvailable } from '../lib/bank-screenshot.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';
import { parseAmount, parseLooseDate } from '@jjd/shared';
import { syncLedgerEntryForDocument } from '../lib/documents.js';

export const financeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function derive(date: Date) {
  const m = date.getMonth() + 1;
  return { year: date.getFullYear(), month: String(m), quarter: `T${Math.ceil(m / 3)}` };
}

const normDesc = (s: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Références bancaires du libellé brut (« REF. : 311fc58a… ») — identifient l'opération. */
const bankRefs = (s: string | null) => new Set([...(s ?? '').matchAll(/REF\.?\s*:\s*([A-Za-z0-9]{8,})/gi)].map((m) => m[1]!.toUpperCase()));

/** Insère des lignes de relevé. Doublon = même identifiant (ré-import, fichiers qui se recoupent), ou — pour une ligne
 *  déjà en base d'un AUTRE import — même jour/montant avec exactement le même libellé, ou une même REF bancaire.
 *  Plus d'heuristique « même montant à quelques jours + début de nom identique » : elle écartait de vraies opérations
 *  (parkings, prélèvements récurrents). Deux lignes du même fichier ne se comparent jamais entre elles. */
export async function insertBankRows(rows: ParsedBankRow[], bankLabel: string, source: string) {
  const runStart = new Date();
  let imported = 0;
  let duplicates = 0;
  for (const r of rows) {
    if (await prisma.bankTransaction.findUnique({ where: { externalId: r.externalId } })) { duplicates++; continue; }
    if (r.bookingDate && r.amount != null && r.description) {
      const day = new Date(r.bookingDate); day.setUTCHours(0, 0, 0, 0);
      const next = new Date(day); next.setUTCDate(next.getUTCDate() + 1);
      const myRefs = bankRefs(r.description);
      const near = await prisma.bankTransaction.findMany({
        where: { amount: r.amount, createdAt: { lt: runStart }, bookingDate: { gte: new Date(day.getTime() - 3 * 86400000), lt: next } },
        select: { bookingDate: true, description: true },
      });
      const isDup = near.some((n) => {
        const sameDay = n.bookingDate != null && n.bookingDate >= day && n.bookingDate < next;
        if (sameDay && normDesc(n.description) === normDesc(r.description)) return true;
        const theirRefs = bankRefs(n.description);
        return myRefs.size > 0 && [...myRefs].some((x) => theirRefs.has(x));
      });
      if (isDup) { duplicates++; continue; }
    }
    await prisma.bankTransaction.create({
      data: {
        externalId: r.externalId, bookingDate: r.bookingDate, valueDate: r.valueDate,
        bank: bankLabel, amount: r.amount, currency: r.currency,
        counterpartyName: r.counterpartyName, counterpartyAccount: r.counterpartyAccount,
        description: r.description, communication: r.communication,
        side: (r.amount ?? 0) < 0 ? 'out' : 'in', source,
      },
    });
    imported++;
  }
  return { imported, duplicates };
}

/** P&L consolidé (bureau + admin). */
financeRouter.get(
  '/consolidated',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { year, month, entity } = req.query as Record<string, string>;
    res.json(
      await consolidatedPnl({
        year: year ? Number(year) : undefined,
        month: month ? Number(month) : undefined,
        entity: entity === 'jjd' || entity === 'tonton' || entity === 'm7' ? entity : undefined,
      }),
    );
  }),
);

/** Séries pour la page Analyse (graphiques). */
financeRouter.get(
  '/analytics',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { months, entity } = req.query as Record<string, string>;
    res.json(
      await analytics({
        months: months ? Number(months) : undefined,
        entity: entity === 'jjd' || entity === 'tonton' || entity === 'm7' ? entity : undefined,
      }),
    );
  }),
);

/** Partage des bénéfices — associés uniquement. */
financeRouter.get(
  '/profit-share',
  requirePartner,
  asyncHandler(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(await profitShare(year));
  }),
);

/** Prévisionnel — devis acceptés pas encore totalement facturés, par chantier. */
financeRouter.get(
  '/forecast',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json(await forecastReceivable());
  }),
);

/** Années disponibles pour les filtres. */
financeRouter.get(
  '/years',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.ledgerEntry.groupBy({ by: ['year'], where: { year: { not: null } } });
    res.json({ years: rows.map((r) => r.year).filter(Boolean).sort((a, b) => (b as number) - (a as number)) });
  }),
);

/* ------------------------------------------------------- ventes (grand livre, historique) */

const SALES_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'date', label: 'Date' },
  { key: 'dueDate', label: 'Échéance' },
  { key: 'client', label: 'Client' },
  { key: 'docNumber', label: 'N° document' },
  { key: 'worksiteRef', label: 'Chantier' },
  { key: 'ht', label: 'HT' },
  { key: 'vatDue', label: 'TVA due' },
  { key: 'ttc', label: 'TTC' },
  { key: 'paymentStatus', label: 'Statut' },
  { key: 'notes', label: 'Notes' },
];

const salesInc = { worksite: { select: { id: true, ref: true } }, contact: { select: { id: true, name: true } } } as const;

/** Export en CSV des ventes du grand livre (historique Excel + saisies manuelles). */
financeRouter.get(
  '/sales/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { from, to, worksiteId, year } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { direction: 'sale' };
    if (worksiteId) where.worksiteId = worksiteId;
    if (year) where.year = Number(year);
    if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const items = await prisma.ledgerEntry.findMany({ where, orderBy: { date: 'desc' }, take: 5000, include: salesInc });
    const rows = items.map((e) => ({
      id: e.id,
      date: e.date,
      dueDate: e.dueDate,
      client: e.contact?.name ?? e.supplierName ?? '',
      docNumber: e.docNumber ?? '',
      worksiteRef: e.worksite?.ref ?? e.worksiteRef ?? '',
      ht: e.ht,
      vatDue: e.vatDue,
      ttc: e.ttc,
      paymentStatus: e.paymentStatus ?? 'Non payé',
      notes: e.notes ?? '',
    }));
    const csv = toCsv(SALES_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ventes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

/**
 * Réimporte un fichier de ventes (précédemment exporté puis corrigé dans Excel, ou
 * nouveau). Une ligne avec un `id` connu met à jour l'écriture ; sans `id` (ou
 * inconnu), une nouvelle écriture est créée. Rien n'est jamais supprimé.
 */
financeRouter.post(
  '/sales/import',
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
      const rowNum = i + 2;
      const id = pick(row, 'id');
      const date = parseLooseDate(pick(row, 'date'));
      if (!date) { warnings.push({ row: rowNum, message: 'Date manquante ou invalide — ligne ignorée' }); continue; }

      const worksiteRef = pick(row, 'chantier', 'worksiteref');
      let worksiteId: string | null | undefined;
      if (worksiteRef) {
        const w = await prisma.worksite.findFirst({ where: { ref: worksiteRef } });
        if (w) worksiteId = w.id;
        else warnings.push({ row: rowNum, message: `Chantier « ${worksiteRef} » introuvable — non modifié` });
      }

      const clientName = pick(row, 'client');
      let contactId: string | null | undefined;
      if (clientName) {
        const c = await prisma.contact.findFirst({ where: { name: { equals: clientName }, type: { in: ['client', 'both'] } } });
        if (c) contactId = c.id;
      }

      const paidRaw = (pick(row, 'statut', 'paymentstatus') ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
      const paymentStatus = paidRaw === 'paye' ? 'Payé' : 'Non payé';

      const data: Record<string, unknown> = {
        date,
        dueDate: parseLooseDate(pick(row, 'echeance', 'échéance', 'duedate')),
        direction: 'sale',
        docType: 'Facture de vente',
        docNumber: pick(row, 'n document', 'docnumber', 'numero') || null,
        worksiteRef: worksiteRef || null,
        ...(worksiteId !== undefined ? { worksiteId } : {}),
        supplierName: clientName || null,
        ...(contactId !== undefined ? { contactId } : {}),
        ht: parseAmount(pick(row, 'ht')) ?? 0,
        vatDue: parseAmount(pick(row, 'tva due', 'vatdue')),
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

/* ------------------------------------------------------- rapprochement bancaire */

financeRouter.get(
  '/bank',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { matched, q: qRaw, from, bank, documentId, page: pageStr, pageSize: pageSizeStr, sort, dir } = req.query as Record<string, string>;
    const q = qRaw?.toLowerCase();
    const and: Record<string, unknown>[] = [];
    // Retrouver la transaction qui a réglé une facture précise (lien direct depuis sa fiche) —
    // prioritaire sur `matched`, puisqu'une facture rapprochée est par définition "matched".
    // Le rapprochement peut viser directement le Document (rapprochement manuel), ou son
    // écriture de grand livre synchronisée (rapprochement automatique) — les deux comptent.
    if (documentId) {
      const dn = (await prisma.document.findUnique({ where: { id: documentId }, select: { number: true } }))?.number;
      and.push({ matches: { some: { OR: [{ documentId }, { ledgerEntry: { documentId } }, ...(dn ? [{ ledgerEntry: { documentId: null, docNumber: dn, direction: { in: ['sale', 'credit_note'] } } }] : [])] } } });
    }
    else if (matched === '1') and.push({ matches: { some: {} } });
    else if (matched === '0') and.push({ matches: { none: {} } });
    if (from) and.push({ bookingDate: { gte: new Date(from) } });
    if (bank) and.push({ bank });
    if (q) and.push({ OR: [{ counterpartyName: { contains: q, ...insensitive } }, { description: { contains: q, ...insensitive } }, { communication: { contains: q, ...insensitive } }] });
    const where: Record<string, unknown> = and.length ? { AND: and } : {};

    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100));
    const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc';
    const orderBy: Record<string, unknown> =
      sort === 'bank' ? { bank: sortDir }
      : sort === 'counterparty' ? { counterpartyName: sortDir }
      : sort === 'amount' ? { amount: sortDir }
      : { bookingDate: sortDir };

    const [items, filteredCount, stats, total, done] = await Promise.all([
      prisma.bankTransaction.findMany({
        where, orderBy,
        skip: (page - 1) * pageSize, take: pageSize,
        include: {
          account: { select: { label: true, iban: true } },
          contact: { select: { id: true, name: true } },
          matches: {
            orderBy: { createdAt: 'asc' },
            include: {
              ledgerEntry: { select: { id: true, docNumber: true, supplierName: true, direction: true, documentId: true, ttc: true, ht: true, worksite: { select: { ref: true } } } },
              document: { select: { id: true, number: true, kind: true, totalTtc: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } } },
            },
          },
        },
      }),
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.groupBy({ by: ['bank'], _count: true, _sum: { amount: true } }),
      prisma.bankTransaction.count(),
      prisma.bankTransaction.count({ where: { matches: { some: {} } } }),
    ]);
    res.json({
      items,
      byBank: stats, matched: done, total,
      page, pageSize, totalCount: filteredCount, totalPages: Math.max(1, Math.ceil(filteredCount / pageSize)),
    });
  }),
);

/**
 * Correction manuelle d'une transaction importée (date, banque, contrepartie, communication,
 * montant…) — en attendant Ponto (flux bancaire live), c'est le seul moyen de rattraper une
 * erreur d'import (CSV/PDF/capture d'écran) sans tout réimporter.
 */
financeRouter.patch(
  '/bank/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Transaction introuvable');
    const b = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if ('bookingDate' in b) data.bookingDate = parseLooseDate(b.bookingDate);
    if ('valueDate' in b) data.valueDate = parseLooseDate(b.valueDate);
    if ('bank' in b) data.bank = typeof b.bank === 'string' ? b.bank.trim() || null : null;
    if ('counterpartyName' in b) data.counterpartyName = typeof b.counterpartyName === 'string' ? b.counterpartyName.trim() || null : null;
    if ('counterpartyAccount' in b) data.counterpartyAccount = typeof b.counterpartyAccount === 'string' ? b.counterpartyAccount.trim() || null : null;
    if ('description' in b) data.description = typeof b.description === 'string' ? b.description.trim() || null : null;
    if ('communication' in b) data.communication = typeof b.communication === 'string' ? b.communication.trim() || null : null;
    if ('amount' in b) {
      const amount = parseAmount(b.amount);
      if (amount == null) throw new HttpError(422, 'Montant invalide');
      data.amount = amount;
      data.side = amount < 0 ? 'out' : 'in';
    }
    // client / payeur à qui attribuer ce virement entrant (argent reçu sans facture : acompte à facturer, trop-perçu)
    if ('contactId' in b) {
      if (b.contactId == null || b.contactId === '') data.contactId = null;
      else {
        if (typeof b.contactId !== 'string' || !(await prisma.contact.findUnique({ where: { id: b.contactId }, select: { id: true } }))) throw new HttpError(422, 'Client introuvable');
        data.contactId = b.contactId;
      }
    }
    const updated = await prisma.bankTransaction.update({ where: { id: existing.id }, data });
    res.json({ transaction: updated });
  }),
);

/**
 * Une facture de vente historique (import Excel) existe au grand livre SANS lien avec son Document de
 * l'appli : les deux ressortaient dans les propositions de rapprochement, et choisir le Document créait une
 * 2e écriture (vente comptée deux fois). On retire donc le Document et on propose à sa place l'écriture
 * existante, la seule qui compte dans les finances.
 */
async function splitLedgerTwins<D extends { number: string | null }>(docs: D[]) {
  const nums = docs.map((d) => d.number).filter((n): n is string => !!n);
  if (!nums.length) return { docs, twins: [] };
  const twins = await prisma.ledgerEntry.findMany({
    where: { documentId: null, direction: { in: ['sale', 'credit_note'] }, docNumber: { in: nums } },
    include: { worksite: { select: { ref: true, title: true } } },
  });
  const have = new Set(twins.map((t) => (t.docNumber ?? '').trim().toUpperCase()));
  return { docs: docs.filter((d) => !d.number || !have.has(d.number.trim().toUpperCase())), twins };
}

/** Suggère des écritures du grand livre à rapprocher d'une transaction. */
financeRouter.get(
  '/bank/:id/suggestions',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const tx = await prisma.bankTransaction.findUnique({ where: { id: req.params.id }, include: { matches: true } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');
    const inc = { worksite: { select: { ref: true, title: true } } };

    // déjà rapproché à CETTE transaction — jamais reproposé (un paiement peut en couvrir
    // plusieurs autres en revanche, donc pas d'exclusion cross-transaction)
    const usedLedgerIds = tx.matches.map((m) => m.ledgerEntryId).filter((x): x is string => !!x);
    const usedDocIds = tx.matches.map((m) => m.documentId).filter((x): x is string => !!x);

    // recherche manuelle : l'utilisateur cherche lui-même (n° facture, fournisseur, chantier…)
    // au lieu de se limiter aux propositions automatiques (montant/date proches) — utile
    // quand il n'y a aucune proposition ou que la bonne facture n'y figure pas
    const q = (req.query.q as string | undefined)?.trim().toLowerCase();
    if (q) {
      const [ledgers, docs] = await Promise.all([
        prisma.ledgerEntry.findMany({
          where: {
            id: { notIn: usedLedgerIds },
            documentId: null, // sinon la même facture ressort 2x : la LedgerEntry synchronisée ET son Document d'origine (voir plus bas)
            OR: [
              { docNumber: { contains: q, ...insensitive } },
              { supplierName: { contains: q, ...insensitive } },
              { worksite: { ref: { contains: q, ...insensitive } } },
              { worksite: { title: { contains: q, ...insensitive } } },
              { contact: { name: { contains: q, ...insensitive } } },
            ],
          },
          take: 20, include: inc, orderBy: { date: 'desc' },
        }),
        prisma.document.findMany({
          where: {
            id: { notIn: usedDocIds },
            OR: [
              { number: { contains: q, ...insensitive } },
              { contact: { name: { contains: q, ...insensitive } } },
              { worksite: { ref: { contains: q, ...insensitive } } },
              { worksite: { title: { contains: q, ...insensitive } } },
            ],
          },
          take: 15, orderBy: { issuedOn: 'desc' },
          select: { id: true, number: true, kind: true, totalTtc: true, issuedOn: true, status: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
        }),
      ]);
      const split = await splitLedgerTwins(docs);
      const known = new Set(ledgers.map((l) => l.id));
      const twinLedgers = split.twins.filter((t) => !known.has(t.id) && !usedLedgerIds.includes(t.id));
      return res.json({
        items: [
          ...[...ledgers, ...twinLedgers].map((l) => ({
            kind: 'ledger' as const,
            id: l.id,
            label: [l.docNumber, l.supplierName].filter(Boolean).join(' · ') || (l.direction === 'sale' ? 'Vente' : 'Achat'),
            amount: l.ttc ?? l.ht,
            date: l.date,
            direction: l.direction,
            worksiteRef: l.worksite?.ref ?? l.worksiteRef ?? null,
          })),
          ...split.docs.map((d) => ({
            kind: 'document' as const,
            id: d.id,
            label: [d.number, d.contact?.name].filter(Boolean).join(' · ') || 'Facture de vente',
            amount: d.totalTtc,
            date: d.issuedOn,
            direction: 'sale' as const,
            worksiteRef: d.worksite?.ref ?? null,
            status: d.status,
          })),
        ],
      });
    }

    // déjà partiellement affecté (ex. acompte de 10 000 € réparti sur plusieurs factures) :
    // les propositions par montant visent ce qu'il reste à couvrir, pas le montant total du
    // virement — sinon plus aucune facture ne matcherait après le premier rapprochement.
    const matchedAmounts = await Promise.all(
      tx.matches.map(async (m) => {
        if (m.ledgerEntryId) {
          const l = await prisma.ledgerEntry.findUnique({ where: { id: m.ledgerEntryId }, select: { ttc: true, ht: true } });
          return l ? (l.ttc ?? l.ht) : 0;
        }
        if (m.documentId) {
          const d = await prisma.document.findUnique({ where: { id: m.documentId }, select: { totalTtc: true } });
          return d?.totalTtc ?? 0;
        }
        return 0;
      }),
    );
    const alreadyMatched = matchedAmounts.reduce((s, a) => s + a, 0);
    const fullAmount = Math.abs(tx.amount ?? 0);
    const remaining = fullAmount - alreadyMatched;
    const amount = remaining > 0.5 ? remaining : fullAmount;

    const window = tx.bookingDate
      ? { date: { gte: new Date(tx.bookingDate.getTime() - 20 * 86400000), lte: new Date(tx.bookingDate.getTime() + 20 * 86400000) } }
      : {};

    const byComm = !tx.matches.length && tx.structuredComm && tx.structuredComm.length >= 10
      ? await prisma.ledgerEntry.findMany({ where: { bankComm: { contains: tx.structuredComm.slice(0, 12) }, id: { notIn: usedLedgerIds }, documentId: null }, take: 5, include: inc })
      : [];
    const byAmount = await prisma.ledgerEntry.findMany({
      // documentId: null — sinon la même facture ressort 2x (LedgerEntry synchronisée + son Document d'origine, voir docItems plus bas)
      where: { ttc: { gte: amount - 1, lte: amount + 1 }, id: { notIn: usedLedgerIds }, documentId: null, ...window },
      take: 12, include: inc, orderBy: { date: 'desc' },
    });
    const seen = new Set<string>();
    const ledgerItems = [...byComm, ...byAmount]
      .filter((l) => (seen.has(l.id) ? false : seen.add(l.id)))
      .map((l) => ({
        kind: 'ledger' as const,
        id: l.id,
        label: [l.docNumber, l.supplierName].filter(Boolean).join(' · ') || (l.direction === 'sale' ? 'Vente' : 'Achat'),
        amount: l.ttc ?? l.ht,
        date: l.date,
        direction: l.direction,
        worksiteRef: l.worksite?.ref ?? l.worksiteRef ?? null,
      }));

    // factures de vente créées dans l'app (Document) — mêmes critères
    const docWindow = tx.bookingDate
      ? { issuedOn: { gte: new Date(tx.bookingDate.getTime() - 25 * 86400000), lte: new Date(tx.bookingDate.getTime() + 25 * 86400000) } }
      : {};
    const docs = await prisma.document.findMany({
      where: {
        kind: { in: ['invoice', 'deposit_invoice', 'credit_note'] },
        id: { notIn: usedDocIds },
        totalTtc: { gte: amount - 1, lte: amount + 1 },
        ...docWindow,
      },
      take: 8,
      orderBy: { issuedOn: 'desc' },
      select: { id: true, number: true, kind: true, totalTtc: true, issuedOn: true, status: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
    });
    const autoSplit = await splitLedgerTwins(docs);
    const autoKnown = new Set(ledgerItems.map((l) => l.id));
    for (const t of autoSplit.twins) {
      if (autoKnown.has(t.id) || usedLedgerIds.includes(t.id)) continue;
      ledgerItems.push({ kind: 'ledger' as const, id: t.id, label: [t.docNumber, t.supplierName].filter(Boolean).join(' · ') || 'Vente', amount: t.ttc ?? t.ht, date: t.date, direction: t.direction, worksiteRef: t.worksite?.ref ?? t.worksiteRef ?? null });
    }
    const docItems = autoSplit.docs.map((d) => ({
      kind: 'document' as const,
      id: d.id,
      label: [d.number, d.contact?.name].filter(Boolean).join(' · ') || 'Facture de vente',
      amount: d.totalTtc,
      date: d.issuedOn,
      direction: 'sale' as const,
      worksiteRef: d.worksite?.ref ?? null,
      status: d.status,
    }));

    res.json({ items: [...ledgerItems, ...docItems], remaining: Math.round(remaining * 100) / 100 });
  }),
);

/**
 * Ajoute une facture au rapprochement d'une transaction bancaire — un même paiement peut en
 * couvrir plusieurs (ex. un acompte de 10 000 € décompté ensuite sur 3 factures reçues) : appeler
 * cette route plusieurs fois pour la même transaction ajoute autant de lignes. Facture d'achat
 * (grand livre) OU facture de vente (Document) ; la cible passe « payée ».
 */
financeRouter.post(
  '/bank/:id/matches',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ledgerId: string | null = req.body.ledgerId ?? null;
    const documentId: string | null = req.body.documentId ?? null;
    if (!ledgerId && !documentId) throw new HttpError(422, 'Choisissez une facture à rapprocher');
    const tx = await prisma.bankTransaction.findUnique({ where: { id: req.params.id } });
    if (!tx) throw new HttpError(404, 'Transaction introuvable');

    const dup = await prisma.bankTransactionMatch.findFirst({
      where: { bankTransactionId: tx.id, ledgerEntryId: ledgerId, documentId },
    });
    if (dup) throw new HttpError(409, 'Cette facture est déjà rapprochée de cette transaction');

    await prisma.bankTransactionMatch.create({ data: { bankTransactionId: tx.id, ledgerEntryId: ledgerId, documentId } });
    // un virement entrant rapproché à la facture d'un client lui est attribué (son compte client montrera ensuite ce qui reste sans facture)
    if (!tx.contactId && (tx.amount ?? 0) > 0) {
      const cid = documentId
        ? (await prisma.document.findUnique({ where: { id: documentId }, select: { contactId: true } }))?.contactId
        : (await prisma.ledgerEntry.findUnique({ where: { id: ledgerId! }, select: { contactId: true } }))?.contactId;
      if (cid) await prisma.bankTransaction.update({ where: { id: tx.id }, data: { contactId: cid } });
    }

    if (ledgerId) {
      // Une écriture de vente synchronisée depuis une facture (LedgerEntry.documentId non nul,
      // voir syncLedgerEntryForDocument) : la FACTURE est la source de vérité — on recalcule son
      // paiement (somme des transactions réellement rapprochées, jamais "payé" d'office), sinon
      // un 2e/3e versement partiel sur la même facture écrase silencieusement les précédents et
      // la facture reste invisible depuis le rapprochement bancaire (hasBankMatch à false).
      // (ou le Document de même numéro quand l'écriture est une facture historique non liée)
      const docId = await documentIdForLedger(ledgerId);
      if (docId) await recomputeDocumentPayment(docId);
      const after = await prisma.ledgerEntry.findUnique({ where: { id: ledgerId }, select: { documentId: true } });
      if (!after?.documentId) {
        await prisma.ledgerEntry.update({
          where: { id: ledgerId },
          data: { paymentStatus: 'Payé', paidOn: tx.bookingDate ?? new Date() },
        });
      }
    }
    if (documentId) {
      await recomputeDocumentPayment(documentId);
    }

    await prisma.bankTransaction.update({ where: { id: tx.id }, data: { matchConfidence: 'manual', matchedAt: new Date() } });
    res.status(201).json({ ok: true });
  }),
);

/** Retire une facture du rapprochement d'une transaction (elle repasse « non payée », ou
 *  « partiel » s'il reste d'autres transactions rapprochées sur la même facture). */
financeRouter.delete(
  '/bank/:id/matches/:matchId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const m = await prisma.bankTransactionMatch.findFirst({ where: { id: req.params.matchId, bankTransactionId: req.params.id } });
    if (!m) throw new HttpError(404, 'Rapprochement introuvable');
    const ledgerDocumentId = m.ledgerEntryId ? await documentIdForLedger(m.ledgerEntryId) : null;
    await prisma.bankTransactionMatch.delete({ where: { id: m.id } });

    if (m.ledgerEntryId) {
      if (ledgerDocumentId) {
        await recomputeDocumentPayment(ledgerDocumentId);
      }
      if (!(m.ledgerEntryId && (await prisma.ledgerEntry.findUnique({ where: { id: m.ledgerEntryId }, select: { documentId: true } }))?.documentId)) {
        await prisma.ledgerEntry.update({ where: { id: m.ledgerEntryId }, data: { paymentStatus: 'Non payé', paidOn: null } }).catch(() => {});
      }
    }
    if (m.documentId) {
      await recomputeDocumentPayment(m.documentId);
    }

    const remaining = await prisma.bankTransactionMatch.count({ where: { bankTransactionId: req.params.id } });
    if (remaining === 0) {
      await prisma.bankTransaction.update({ where: { id: req.params.id }, data: { matchConfidence: null, matchedAt: null } });
    }
    res.json({ ok: true });
  }),
);

/** Renomme en masse le libellé « banque/carte » (ex. faute de frappe au moment de l'import). */
financeRouter.post(
  '/bank/rename',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const from = String(req.body?.from ?? '').trim();
    const to = String(req.body?.to ?? '').trim();
    if (!from || !to) throw new HttpError(422, 'Ancien et nouveau libellé requis.');
    const { count } = await prisma.bankTransaction.updateMany({ where: { bank: from }, data: { bank: to } });
    res.json({ renamed: count });
  }),
);

/** Rapprochement automatique de toutes les transactions non liées. */
financeRouter.post(
  '/bank/auto-match',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    res.json(await autoMatchAll());
  }),
);

/**
 * Import d'un relevé que le flux Ponto ne remonte pas :
 *  - CSV (extraits banque, cartes exportables)
 *  - PDF « État des dépenses » de carte (Belfius / Atos Worldline)
 * Champ multipart « file », option « bank » (libellé).
 */
financeRouter.post(
  '/bank/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const bankLabel = String(req.body?.bank ?? '').trim();
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.buffer.subarray(0, 5).toString() === '%PDF-';

    if (isPdf) {
      if (!(await pdftotextAvailable())) {
        throw new HttpError(503, 'Lecture PDF indisponible sur ce serveur (poppler-utils non installé).');
      }
      const text = await pdfToRawText(req.file.buffer);
      const st = parseCardStatement(text);
      if (st.rows.length === 0) throw new HttpError(422, 'Aucune transaction trouvée dans ce PDF (format de relevé non reconnu).');
      const { imported, duplicates } = await insertBankRows(st.rows, bankLabel || `Carte ${st.cardRef ?? ''}`.trim(), 'pdf');
      const match = await autoMatchAll();
      return res.json({ imported, duplicates, kind: 'pdf', cardRef: st.cardRef, period: st.period, total: st.total, match });
    }

    const parsed = parseBankCsv(decodeCsvBuffer(req.file.buffer));
    if (parsed.rows.length === 0) {
      throw new HttpError(422,
        `Aucune ligne exploitable. Colonnes détectées : ${parsed.headers.join(', ') || '—'}. `
        + `Champs reconnus : ${parsed.mapped.join(', ') || 'aucun'} (il faut au minimum une date et un montant).`);
    }
    const { imported, duplicates } = await insertBankRows(parsed.rows, bankLabel || 'CSV', 'csv');
    const match = await autoMatchAll();
    res.json({ imported, duplicates, kind: 'csv', skipped: parsed.skipped, mapped: parsed.mapped, headers: parsed.headers, match });
  }),
);

/**
 * Import à partir d'une ou plusieurs captures d'écran de l'appli d'une carte prépayée (JPEG/PNG)
 * — pour rapprocher les dépenses bien avant l'arrivée du relevé PDF officiel du mois. Lecture par
 * IA (vision Claude) : nécessite une clé Anthropic configurée côté serveur (voir env.ts).
 * Champ multipart « files » (jusqu'à 10), option « bank » (libellé).
 */
financeRouter.post(
  '/bank/import-screenshot',
  requireAuth(...OFFICE),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    if (!screenshotImportAvailable()) throw new HttpError(503, 'Lecture par IA non configurée (clé Anthropic absente côté serveur).');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new HttpError(422, 'Aucune image');
    const bankLabel = String(req.body?.bank ?? '').trim() || 'Carte (capture)';
    const rows = await parseScreenshots(files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype })));
    if (!rows.length) throw new HttpError(422, 'Aucune transaction lisible sur ces captures.');
    const { imported, duplicates } = await insertBankRows(rows, bankLabel, 'screenshot');
    const match = await autoMatchAll();
    res.json({ imported, duplicates, kind: 'screenshot', match });
  }),
);

/**
 * Rapprochement grand livre <-> devis/factures/NC de vente émis dans l'appli : liste les
 * documents émis qui n'ont pas (encore) d'écriture synchronisée (voir syncLedgerEntryForDocument),
 * en distinguant deux cas — une écriture existante partage déjà le même numéro (import Excel ou
 * rattrapage manuel antérieur : à lier plutôt qu'à dupliquer), ou rien du tout (vrai trou : une
 * écriture neuve peut être créée sans risque de doublon).
 */
/**
 * Factures de vente HISTORIQUES : écritures du grand livre (import Excel) qui n'ont pas de document dans l'appli. On les liste (recherche
 * par n° / client / chantier) pour pouvoir en tirer un document, puis une note de crédit (POST /api/documents/from-ledger/:id).
 */
financeRouter.get(
  '/ledger-sync/historical',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const q = String((req.query as Record<string, string>).q ?? '').trim();
    const where: Prisma.LedgerEntryWhereInput = { direction: 'sale', documentId: null, docNumber: { not: null } };
    if (q) where.OR = [{ docNumber: { contains: q, ...insensitive } }, { supplierName: { contains: q, ...insensitive } }, { worksiteRef: { contains: q, ...insensitive } }];
    const [items, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where, orderBy: [{ date: 'desc' }, { docNumber: 'desc' }], take: 60,
        select: { id: true, docNumber: true, date: true, ht: true, ttc: true, paymentStatus: true, supplierName: true, worksiteRef: true, worksite: { select: { ref: true } } },
      }),
      prisma.ledgerEntry.count({ where }),
    ]);
    res.json({ items: items.map(({ worksite, ...e }) => ({ ...e, worksiteRef: worksite?.ref ?? e.worksiteRef })), total });
  }),
);

financeRouter.get(
  '/ledger-sync/gaps',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const docs = await prisma.document.findMany({
      where: {
        kind: { in: ['invoice', 'deposit_invoice', 'credit_note'] },
        lockedAt: { not: null },
        source: { not: 'demo' },
        ledgerEntry: null,
      },
      select: {
        id: true, kind: true, number: true, issuedOn: true, totalTtc: true, status: true,
        worksite: { select: { ref: true } },
        contact: { select: { name: true } },
      },
      orderBy: { issuedOn: 'asc' },
    });
    const numbers = docs.map((d) => d.number).filter((n): n is string => !!n);
    const candidates = numbers.length
      ? await prisma.ledgerEntry.findMany({
          where: { docNumber: { in: numbers }, documentId: null, direction: { in: ['sale', 'credit_note'] } },
          select: { id: true, docNumber: true, date: true, ht: true, ttc: true, paymentStatus: true, source: true },
        })
      : [];
    const byNumber = new Map(candidates.map((c) => [c.docNumber, c]));
    const items = docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      number: d.number,
      issuedOn: d.issuedOn,
      totalTtc: d.totalTtc,
      status: d.status,
      worksiteRef: d.worksite?.ref ?? null,
      contactName: d.contact?.name ?? null,
      match: (d.number && byNumber.get(d.number)) || null,
    }));
    res.json({
      items,
      missingCount: items.filter((i) => !i.match).length,
      matchableCount: items.filter((i) => i.match).length,
    });
  }),
);

/** Crée l'écriture manquante (pas de doublon possible : upsert par documentId). */
financeRouter.post(
  '/ledger-sync/gaps/:id/create',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await syncLedgerEntryForDocument(req.params.id as string);
    res.json({ ok: true });
  }),
);

/** Lie le document à une écriture existante (import Excel / rattrapage manuel) au lieu d'en créer une neuve. */
financeRouter.post(
  '/ledger-sync/gaps/:id/link',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { ledgerEntryId } = req.body as { ledgerEntryId?: string };
    if (!ledgerEntryId) throw new HttpError(422, 'ledgerEntryId requis');
    const entry = await prisma.ledgerEntry.findUnique({ where: { id: ledgerEntryId } });
    if (!entry) throw new HttpError(404, 'Écriture introuvable');
    if (entry.documentId) throw new HttpError(409, 'Écriture déjà liée à un autre document');
    await prisma.ledgerEntry.update({ where: { id: ledgerEntryId }, data: { documentId: req.params.id } });
    res.json({ ok: true });
  }),
);
