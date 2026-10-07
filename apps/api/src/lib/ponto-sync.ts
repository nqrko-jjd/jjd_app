import { prisma } from '../db.js';
import { pontoConfigured, refreshAccounts, fetchAccountTransactions } from './ponto.js';
import { autoMatchAll } from './bank-match.js';

let running = false;

/** Tire les nouvelles transactions de chaque compte Ponto, les enregistre (sans doublon) puis lance le rapprochement automatique. */
export async function syncPonto(): Promise<{ accounts: number; imported: number; match: Awaited<ReturnType<typeof autoMatchAll>> | null }> {
  if (running) return { accounts: 0, imported: 0, match: null }; // une synchro à la fois
  running = true;
  try {
    await refreshAccounts();
    const accounts = await prisma.bankAccount.findMany({ where: { externalId: { not: null } } });
    let imported = 0;
    for (const acc of accounts) {
      const txs = await fetchAccountTransactions({ id: acc.id, externalId: acc.externalId!, syncCursor: acc.syncCursor });
      for (const t of txs) {
        const created = await prisma.bankTransaction.upsert({
          where: { externalId: t.externalId },
          create: {
            externalId: t.externalId, accountId: acc.id, bookingDate: t.bookingDate, valueDate: t.valueDate,
            bank: acc.label, amount: t.amount, currency: t.currency, counterpartyName: t.counterpartyName,
            counterpartyAccount: t.counterpartyAccount, description: t.description, communication: t.communication,
            structuredComm: t.structuredComm, side: t.side, source: 'ponto',
          },
          update: {
            amount: t.amount, counterpartyName: t.counterpartyName, description: t.description,
            communication: t.communication, structuredComm: t.structuredComm, side: t.side,
          },
        });
        if (created.createdAt.getTime() > Date.now() - 5000) imported++;
      }
    }
    const match = await autoMatchAll();
    return { accounts: accounts.length, imported, match };
  } finally {
    running = false;
  }
}

export { pontoConfigured };
