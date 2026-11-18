import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import multer from 'multer';
import { detectCard, cardTextNeedles, isCardSettlement } from '../lib/bank-cards-pure.js';
import { pdfToRawText, pdftotextAvailable, parseVisaStatement } from '../lib/bank-pdf.js';
import { autoMatchAll } from '../lib/bank-match.js';
import { insertBankRows } from './finance.js';

/** Cartes de paiement physiques (Bancontact, Visa) : qui a quelle carte, et ce qui a été payé avec. */
export const cardsRouter = Router();

const TX_SELECT = {
  id: true, bookingDate: true, amount: true, bank: true, communication: true, description: true, counterpartyName: true, pairedTxId: true,
  _count: { select: { matches: true } },
} as const;

const PERSON_SELECT = { id: true, firstName: true, lastName: true, displayName: true, photoThumbUrl: true, active: true } as const;

const key = (network: string, last4: string) => `${network}:${last4}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Commerçant lisible : contrepartie du relevé, sinon le libellé. */
function merchantOf(t: { counterpartyName: string | null; description: string | null; communication: string | null }): string {
  const raw = t.counterpartyName || t.description || '';
  if (raw && !/^(instant payment|betaling|paiement)/i.test(raw)) return raw.replace(/\s+/g, ' ').trim();
  const c = (t.communication ?? '').replace(/\s+/g, ' ');
  const ing = c.match(/uur - (.+?) - [A-Z ]+ - [A-Z]{3}/);
  return (ing?.[1] ?? raw ?? c.slice(0, 40)).trim();
}

/** Opérations par carte depuis `since` (Bancontact reconnu dans le texte, Visa par le relevé de la carte). */
async function cardTransactions(since: Date) {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      bookingDate: { gte: since },
      OR: [{ bank: { startsWith: 'VISA' } }, { communication: { contains: 'XXXX' } }, { description: { contains: 'XXXX' } }],
    },
    select: TX_SELECT,
    orderBy: { bookingDate: 'desc' },
  });
  const byCard = new Map<string, { hit: NonNullable<ReturnType<typeof detectCard>>; txs: typeof rows }>();
  for (const t of rows) {
    const hit = detectCard(t);
    if (!hit) continue;
    const k = key(hit.network, hit.last4);
    const cur = byCard.get(k) ?? { hit, txs: [] };
    if (!cur.hit.holderName && hit.holderName) cur.hit = { ...cur.hit, holderName: hit.holderName };
    cur.txs.push(t);
    byCard.set(k, cur);
  }
  return byCard;
}

cardsRouter.get('/', requireAuth(...OFFICE), asyncHandler(async (_req, res) => {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const byCard = await cardTransactions(since);

  // cartes vues sur les relevés mais pas encore dans la liste : ajoutées, pour qu'on puisse dire à qui elles sont
  const existing = await prisma.paymentCard.findMany({ select: { network: true, last4: true } });
  const known = new Set(existing.map((c) => key(c.network, c.last4)));
  for (const { hit } of byCard.values()) {
    if (known.has(key(hit.network, hit.last4))) continue;
    await prisma.paymentCard.create({ data: { network: hit.network, last4: hit.last4, prefix: hit.prefix, bank: hit.bank, holderName: hit.holderName } }).catch(() => undefined);
  }

  const cards = await prisma.paymentCard.findMany({ include: { person: { select: PERSON_SELECT } }, orderBy: [{ status: 'asc' }, { network: 'asc' }, { last4: 'asc' }] });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const items = cards.map((c) => {
    const txs = (byCard.get(key(c.network, c.last4))?.txs ?? []).filter((t) => (t.amount ?? 0) < 0);
    const sum = (from: Date, to?: Date) => round2(txs.filter((t) => t.bookingDate && t.bookingDate >= from && (!to || t.bookingDate < to)).reduce((s, t) => s - (t.amount ?? 0), 0));
    const last = txs[0];
    const toJustify = txs.filter((t) => !t._count.matches && !t.pairedTxId);
    return {
      ...c,
      stats: {
        monthSpend: sum(monthStart),
        prevMonthSpend: sum(prevStart, monthStart),
        yearSpend: sum(since),
        count: txs.length,
        lastUsedAt: last?.bookingDate ?? null,
        lastMerchant: last ? merchantOf(last) : null,
        lastAmount: last ? round2(-(last.amount ?? 0)) : null,
        toJustify: toJustify.length,
        toJustifyAmount: round2(toJustify.reduce((s, t) => s - (t.amount ?? 0), 0)),
      },
    };
  });
  const people = await prisma.person.findMany({ where: { active: true }, select: PERSON_SELECT, orderBy: { firstName: 'asc' } });
  res.json({ items, people });
}));

cardsRouter.get('/:id/transactions', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const card = await prisma.paymentCard.findUnique({ where: { id: req.params.id }, include: { person: { select: PERSON_SELECT } } });
  if (!card) throw new HttpError(404, 'Carte introuvable');
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const needles = cardTextNeedles(card.network, card.last4);
  const rows = await prisma.bankTransaction.findMany({
    where: {
      bookingDate: { gte: since },
      ...(needles.bankStartsWith
        ? { bank: { startsWith: needles.bankStartsWith } }
        : { OR: needles.contains!.flatMap((n) => [{ communication: { contains: n } }, { description: { contains: n } }]) }),
    },
    select: { ...TX_SELECT, matches: { select: { amount: true, ledgerEntry: { select: { id: true, docNumber: true, supplierName: true, worksite: { select: { ref: true } } } } } } },
    orderBy: { bookingDate: 'desc' },
  });
  const txs = rows.filter((t) => { const h = detectCard(t); return h && h.network === card.network && h.last4 === card.last4; });
  const byMonth = new Map<string, number>();
  for (const t of txs) {
    if (!t.bookingDate || (t.amount ?? 0) >= 0) continue;
    const m = t.bookingDate.toISOString().slice(0, 7);
    byMonth.set(m, round2((byMonth.get(m) ?? 0) - (t.amount ?? 0)));
  }
  res.json({
    card,
    months: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, spend]) => ({ month, spend })),
    items: txs.map((t) => ({
      id: t.id, date: t.bookingDate, amount: t.amount, merchant: merchantOf(t),
      justified: t._count.matches > 0 || !!t.pairedTxId,
      links: t.matches.map((m) => ({ id: m.ledgerEntry?.id ?? null, label: [m.ledgerEntry?.supplierName, m.ledgerEntry?.docNumber].filter(Boolean).join(' · '), worksiteRef: m.ledgerEntry?.worksite?.ref ?? null })),
    })),
  });
}));

const cardInput = z.object({
  network: z.enum(['bancontact', 'visa']),
  last4: z.string().trim().regex(/^\d{4}$/, '4 derniers chiffres'),
  bank: z.string().trim().max(60).nullish(),
  holderName: z.string().trim().max(120).nullish(),
  label: z.string().trim().max(120).nullish(),
  personId: z.string().nullish(),
  status: z.enum(['active', 'blocked', 'lost', 'expired']).optional(),
  expiresOn: z.coerce.date().nullish(),
  monthlyLimit: z.coerce.number().nonnegative().nullish(),
  note: z.string().trim().max(1000).nullish(),
});
const blank = (b: unknown) => Object.fromEntries(Object.entries((b ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v === '' ? null : v]));

cardsRouter.post('/', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const d = cardInput.parse(blank(req.body));
  if (await prisma.paymentCard.findUnique({ where: { network_last4: { network: d.network, last4: d.last4 } } })) throw new HttpError(409, 'Cette carte existe déjà');
  const card = await prisma.paymentCard.create({ data: d });
  res.status(201).json({ card });
}));

cardsRouter.patch('/:id', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const d = cardInput.partial().omit({ network: true, last4: true }).parse(blank(req.body));
  const card = await prisma.paymentCard.update({ where: { id: req.params.id }, data: d, include: { person: { select: PERSON_SELECT } } });
  await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'card.update', entity: 'paymentCard', entityId: card.id, meta: d as object } }).catch(() => undefined);
  res.json({ card });
}));

cardsRouter.delete('/:id', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  await prisma.paymentCard.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

/* ------------------------------------------------------------- comptes (virements, domiciliations, entrées) */

/** Opérations d'un compte qui ne sont PAS des paiements carte (ceux-là sont sous leur carte). */
async function accountTransactions(bank: string | null, since: Date) {
  const rows = await prisma.bankTransaction.findMany({
    where: { bookingDate: { gte: since }, NOT: { bank: { startsWith: 'VISA' } }, ...(bank ? { bank } : {}) },
    select: { ...TX_SELECT, accountId: true, account: { select: { iban: true, label: true, balance: true, balanceAt: true } } },
    orderBy: { bookingDate: 'desc' },
  });
  return rows.filter((t) => !detectCard(t));
}

cardsRouter.get('/accounts', requireAuth(...OFFICE), asyncHandler(async (_req, res) => {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await accountTransactions(null, since);
  const by = new Map<string, typeof rows>();
  for (const t of rows) { const k = t.bank || 'Autre'; by.set(k, [...(by.get(k) ?? []), t]); }
  const items = [...by.entries()].map(([bank, txs]) => {
    const acc = txs.find((t) => t.account)?.account ?? null;
    const month = txs.filter((t) => t.bookingDate && t.bookingDate >= monthStart);
    const todo = txs.filter((t) => !t._count.matches && !t.pairedTxId && !isCardSettlement(t));
    return {
      bank, iban: acc?.iban ?? null, label: acc?.label ?? null, balance: acc?.balance ?? null, balanceAt: acc?.balanceAt ?? null,
      stats: {
        monthOut: round2(month.filter((t) => (t.amount ?? 0) < 0).reduce((s, t) => s - (t.amount ?? 0), 0)),
        monthIn: round2(month.filter((t) => (t.amount ?? 0) > 0).reduce((s, t) => s + (t.amount ?? 0), 0)),
        count: txs.length,
        toJustify: todo.length,
        toJustifyAmount: round2(todo.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0)),
        lastUsedAt: txs[0]?.bookingDate ?? null,
      },
    };
  }).sort((a, b) => b.stats.count - a.stats.count);
  res.json({ items });
}));

cardsRouter.get('/accounts/:bank/transactions', requireAuth(...OFFICE), asyncHandler(async (req, res) => {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 3));
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const rows = await accountTransactions(req.params.bank!, since);
  const ids = rows.map((t) => t.id);
  const links = await prisma.bankTransaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, matches: { select: { ledgerEntry: { select: { id: true, docNumber: true, supplierName: true, worksite: { select: { ref: true } } } }, document: { select: { id: true, number: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } } } } } },
  });
  const linkMap = new Map(links.map((l) => [l.id, l.matches]));
  const byMonth = new Map<string, { out: number; in: number }>();
  for (const t of rows) {
    if (!t.bookingDate) continue;
    const m = t.bookingDate.toISOString().slice(0, 7);
    const cur = byMonth.get(m) ?? { out: 0, in: 0 };
    if ((t.amount ?? 0) < 0) cur.out = round2(cur.out - (t.amount ?? 0)); else cur.in = round2(cur.in + (t.amount ?? 0));
    byMonth.set(m, cur);
  }
  res.json({
    months: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, spend: v.out, income: v.in })),
    items: rows.map((t) => ({
      id: t.id, date: t.bookingDate, amount: t.amount,
      merchant: (t.counterpartyName || t.description || (t.communication ?? '').replace(/\s+/g, ' ').slice(0, 60) || 'Opération').trim(),
      detail: (t.communication ?? '').replace(/\s+/g, ' ').slice(0, 120) || null,
      justified: t._count.matches > 0 || !!t.pairedTxId || isCardSettlement(t),
      settlement: isCardSettlement(t),
      links: (linkMap.get(t.id) ?? []).map((m) => m.document
        ? { id: null, label: [m.document.contact?.name, m.document.number].filter(Boolean).join(' · '), worksiteRef: m.document.worksite?.ref ?? null }
        : { id: m.ledgerEntry?.id ?? null, label: [m.ledgerEntry?.supplierName, m.ledgerEntry?.docNumber].filter(Boolean).join(' · '), worksiteRef: m.ledgerEntry?.worksite?.ref ?? null }),
    })),
  });
}));

/* ------------------------------------------------------------- import des relevés Visa (PDF « État des dépenses ») */

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const frDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : '—');
const dayN = (d: Date) => Math.round(d.getTime() / 86400000);

/**
 * Un ou plusieurs relevés Visa Belfius. Un relevé Business peut couvrir plusieurs cartes (principale + secondaires, un
 * seul décompte) : chaque achat va sur SA carte. Le relevé n'est importé que si la somme des achats = son total.
 * Le prélèvement du relevé sur le compte courant est annoté (et ne compte plus comme « à justifier »).
 */
cardsRouter.post('/import-statement', requireAuth(...OFFICE), upload.array('files', 24), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(422, 'Aucun fichier');
  if (!(await pdftotextAvailable())) throw new HttpError(503, 'Lecture PDF indisponible sur ce serveur.');
  const results = [];
  for (const f of files) {
    const st = parseVisaStatement(await pdfToRawText(f.buffer));
    if (!st.closeDate || st.purchases.length === 0) { results.push({ file: f.originalname, error: 'Relevé Visa non reconnu (aucun achat lu).' }); continue; }
    if (st.total != null && Math.abs(st.total - st.sumPurchases) > 0.01) {
      results.push({ file: f.originalname, error: `Total du relevé ${st.total} € ≠ somme des achats lus ${st.sumPurchases} € : relevé non importé.` });
      continue;
    }
    const note = `Relevé VISA du ${frDay(st.closeDate)}${st.debitDate ? ` · débité le ${frDay(st.debitDate)}` : ''}`;
    const cards = [];
    for (const c of st.cards) {
      const rows = st.purchases.filter((p) => (p.cardLast4 ?? '????') === c.last4).map(({ cardLast4: _c, cardholder: _h, ...r }) => ({ ...r, communication: `${note}${c.holder ? ` · ${c.holder}` : ''}` }));
      const r = rows.length ? await insertBankRows(rows, `VISA ••${c.last4}`, 'pdf-visa') : { imported: 0, duplicates: 0 };
      if (/^\d{4}$/.test(c.last4)) {
        const exists = await prisma.paymentCard.findUnique({ where: { network_last4: { network: 'visa', last4: c.last4 } } });
        if (!exists) await prisma.paymentCard.create({ data: { network: 'visa', last4: c.last4, bank: 'Belfius', holderName: c.holder } });
        else if (!exists.holderName && c.holder) await prisma.paymentCard.update({ where: { id: exists.id }, data: { holderName: c.holder } });
      }
      cards.push({ last4: c.last4, holder: c.holder, count: c.count, sum: c.sum, imported: r.imported, duplicates: r.duplicates });
    }
    // carte à débit différé : retrouver le prélèvement du total sur le compte courant et l'annoter
    let debit: { found: boolean; date: Date | null } = { found: false, date: st.debitDate };
    if (st.debitDate && st.total) {
      const from = new Date(st.debitDate.getTime() - 5 * 86400000), to = new Date(st.debitDate.getTime() + 5 * 86400000);
      const cands = await prisma.bankTransaction.findMany({ where: { bookingDate: { gte: from, lte: to }, NOT: { bank: { startsWith: 'VISA' } } }, select: { id: true, amount: true, bookingDate: true, communication: true, description: true } });
      const hit = cands.filter((t) => Math.abs(Math.abs(t.amount ?? 0) - st.total!) < 0.011 && (t.amount ?? 0) < 0)
        .sort((a, b) => Math.abs(dayN(a.bookingDate!) - dayN(st.debitDate!)) - Math.abs(dayN(b.bookingDate!) - dayN(st.debitDate!)))[0];
      if (hit) {
        debit = { found: true, date: hit.bookingDate };
        if (!hit.communication?.includes('Relevé VISA')) {
          const text = `${note} · ${st.purchases.length} achats (${st.cards.map((c) => `••${c.last4}`).join(', ')})`;
          await prisma.bankTransaction.update({ where: { id: hit.id }, data: { communication: hit.communication ? `${text} | ${hit.communication.replace(/\s+/g, ' ')}` : text } });
        }
      }
    }
    results.push({ file: f.originalname, period: st.period, total: st.total, cards, debit });
  }
  const match = await autoMatchAll();
  res.json({ results, match });
}));
