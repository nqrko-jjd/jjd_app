import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { detectCard, cardTextNeedles } from '../lib/bank-cards-pure.js';

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
