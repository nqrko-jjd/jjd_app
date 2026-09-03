import { computeWorksiteMargin, type Entity, type WorksiteMargin } from '@jjd/shared';
import { prisma } from '../db.js';
import { worksiteTransport, type WorksiteTransport } from './vehicle-cost.js';

/**
 * Marge réelle d'un chantier, calculée à partir des lignes du grand livre
 * (CA vente / coût achat) et du pointage validé (coût main-d'œuvre).
 */
export interface WorksiteMarginFull extends WorksiteMargin {
  transport: WorksiteTransport;
}

export async function worksiteMargin(worksiteId: string): Promise<WorksiteMarginFull | null> {
  const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
  if (!ws) return null;

  const [ledger, time, transport] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { worksiteId } }),
    prisma.timeEntry.aggregate({
      where: { worksiteId, status: { in: ['approved', 'submitted'] } },
      _sum: { amount: true },
    }),
    worksiteTransport(worksiteId),
  ]);

  let invoicedHt = 0;
  let paidHt = 0;
  let materialCost = 0;
  for (const e of ledger) {
    if (e.direction === 'sale') {
      invoicedHt += e.ht;
      if ((e.paymentStatus ?? '').toLowerCase().includes('pay')) paidHt += e.ht;
    } else if (e.direction === 'purchase') {
      materialCost += e.ht;
    } else if (e.direction === 'credit_note') {
      // note de crédit : signe déjà négatif dans la donnée, on additionne tel quel
      invoicedHt += e.ht;
      paidHt += e.ht;
    }
  }

  const margin = computeWorksiteMargin({
    entity: (ws.entity as Entity) ?? 'jjd',
    quotedHt: ws.quotedHt ?? 0,
    invoicedHt,
    paidHt,
    materialCost,
    labourCost: time._sum.amount ?? 0,
    vehicleCost: transport.cost,
  });
  return { ...margin, transport };
}
