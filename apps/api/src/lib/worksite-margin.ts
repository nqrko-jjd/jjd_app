import { computeWorksiteMargin, type Entity, type WorksiteMargin } from '@jjd/shared';
import { prisma } from '../db.js';
import { worksiteTransport, type WorksiteTransport } from './vehicle-cost.js';
import { isOuvrierRemuneration, isCreditNoteSale, isPaid, isVehicleFinancing } from './consolidated.js';

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
  // Main-d'œuvre JJD (ouvriers pointés) déjà facturée : ils sont payés à la journée sur base
  // du pointage, puis la facture "Rémunération - Ouvrier" formalise ce même paiement. Une fois
  // passée, elle remplace l'estimation par pointage — sinon la main-d'œuvre compte deux fois.
  // Les autres "Rémunération - ..." (Julien, Tonton, M7/sous-traitance) payent des personnes
  // distinctes des ouvriers pointés : elles s'additionnent normalement, comme au dépôt d'origine.
  let invoicedLabourCost = 0;
  for (const e of ledger) {
    if (e.direction === 'sale') {
      invoicedHt += e.ht;
      if (isPaid(e.paymentStatus)) paidHt += e.ht;
    } else if (e.direction === 'purchase') {
      if (isVehicleFinancing(e.categoryRaw)) continue; // crédit/leasing : financement, pas une dépense
      if (isOuvrierRemuneration(e.categoryRaw)) invoicedLabourCost += e.ht;
      else materialCost += e.ht;
    } else if (e.direction === 'credit_note') {
      // signe déjà négatif dans la donnée — mais une note de crédit d'achat doit réduire
      // le coût matériaux, pas le CA (sinon vente et achat se neutralisent à tort).
      if (isCreditNoteSale(e.categoryRaw)) {
        invoicedHt += e.ht;
        if (isPaid(e.paymentStatus)) paidHt += e.ht;
      } else if (!isVehicleFinancing(e.categoryRaw)) {
        materialCost += e.ht;
      }
    }
  }

  // Tant qu'aucune facture "Rémunération - Ouvrier" n'existe pour ce chantier, on garde
  // l'estimation par pointage (c'est elle qui sert à préparer la facture, cf. décompte mensuel).
  const labourCost = invoicedLabourCost > 0 ? invoicedLabourCost : (time._sum.amount ?? 0);

  const margin = computeWorksiteMargin({
    entity: (ws.entity as Entity) ?? 'jjd',
    quotedHt: ws.quotedHt ?? 0,
    invoicedHt,
    paidHt,
    materialCost,
    labourCost,
    vehicleCost: transport.cost,
  });
  return { ...margin, transport };
}
