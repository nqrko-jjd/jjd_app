import { prisma } from '../db.js';
import { pontoConfigured, refreshAccounts, fetchAccountTransactions } from './ponto.js';
import { autoMatchAll } from './bank-match.js';
import { pairTwins } from './bank-twins.js';

let running = false;

/** Tire les nouvelles transactions de chaque compte Ponto, les enregistre (sans doublon) puis lance le rapprochement automatique. */
export async function syncPonto(): Promise<{ accounts: number; imported: number; adopted?: number; match: Awaited<ReturnType<typeof autoMatchAll>> | null }> {
  if (running) return { accounts: 0, imported: 0, match: null }; // une synchro à la fois
  running = true;
  try {
    await refreshAccounts();
    const accounts = await prisma.bankAccount.findMany({ where: { externalId: { not: null } } });
    let imported = 0;
    let adopted = 0;
    for (const acc of accounts) {
      const txs = await fetchAccountTransactions({ id: acc.id, externalId: acc.externalId!, syncCursor: acc.syncCursor });
      for (const t of txs) {
        const known = await prisma.bankTransaction.findUnique({ where: { externalId: t.externalId }, select: { id: true } });
        if (known) {
          await prisma.bankTransaction.update({
            where: { id: known.id },
            data: { amount: t.amount, counterpartyName: t.counterpartyName, description: t.description, communication: t.communication, structuredComm: t.structuredComm, side: t.side },
          });
          continue;
        }
        // la même opération a peut-être déjà été importée d'un fichier (CSV…) : on la complète au lieu d'en créer une seconde
        const day = 86400000;
        const near = t.bookingDate
          ? await prisma.bankTransaction.findMany({
              where: { externalId: null, amount: { gte: t.amount - 0.005, lte: t.amount + 0.005 }, bookingDate: { gte: new Date(t.bookingDate.getTime() - 3 * day), lte: new Date(t.bookingDate.getTime() + 3 * day) } },
              select: { id: true, amount: true, bookingDate: true, counterpartyName: true, counterpartyAccount: true },
            })
          : [];
        const twin = pairTwins([{ id: 'ponto', amount: t.amount, bookingDate: t.bookingDate, counterpartyName: t.counterpartyName, counterpartyAccount: t.counterpartyAccount }], near).pairs[0]?.[1];
        if (twin) {
          await prisma.bankTransaction.update({
            where: { id: twin.id },
            data: {
              externalId: t.externalId, accountId: acc.id, valueDate: t.valueDate ?? undefined, communication: t.communication ?? undefined,
              structuredComm: t.structuredComm ?? undefined, counterpartyAccount: t.counterpartyAccount ?? undefined,
            },
          });
          adopted++;
          continue;
        }
        await prisma.bankTransaction.create({
          data: {
            externalId: t.externalId, accountId: acc.id, bookingDate: t.bookingDate, valueDate: t.valueDate,
            bank: acc.label, amount: t.amount, currency: t.currency, counterpartyName: t.counterpartyName,
            counterpartyAccount: t.counterpartyAccount, description: t.description, communication: t.communication,
            structuredComm: t.structuredComm, side: t.side, source: 'ponto',
          },
        });
        imported++;
      }
    }
    const match = await autoMatchAll();
    return { accounts: accounts.length, imported, adopted, match };
  } finally {
    running = false;
  }
}

export { pontoConfigured };
