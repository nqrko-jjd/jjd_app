import { computeWorksiteMargin, type Entity, type WorksiteMargin } from '@jjd/shared';
import { prisma } from '../db.js';
import { worksiteTransport, type WorksiteTransport } from './vehicle-cost.js';
import { invoiceWorksiteAllocation } from './invoice-allocation.js';
import { isOuvrierRemuneration, isCreditNoteSale, isVehicleFinancing, paidFraction } from './consolidated.js';

/**
 * « Devisé HT » d'un chantier d'après les devis présents dans le logiciel : devis émis et
 * acceptés ; à défaut d'acceptés, les devis envoyés (en attente). Les devis refusés, expirés
 * ou encore en brouillon ne comptent pas. Un chantier sans devis dans le logiciel garde le
 * montant historique importé d'Excel (`Worksite.quotedHt`).
 */
export async function worksiteQuotedHtBatch(worksiteIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (worksiteIds.length === 0) return out;
  const quotes = await prisma.document.findMany({
    where: { kind: 'quote', worksiteId: { in: worksiteIds }, lockedAt: { not: null }, status: { in: ['accepted', 'sent'] } },
    select: { worksiteId: true, status: true, totalHt: true },
  });
  const accepted = new Map<string, number>();
  const sent = new Map<string, number>();
  for (const q of quotes) {
    if (!q.worksiteId) continue;
    const m = q.status === 'accepted' ? accepted : sent;
    m.set(q.worksiteId, (m.get(q.worksiteId) ?? 0) + q.totalHt);
  }
  for (const id of worksiteIds) {
    const v = accepted.get(id) ?? sent.get(id);
    if (v != null) out.set(id, Math.round(v * 100) / 100);
  }
  return out;
}

/** Remplace `quotedHt` par le total des devis du logiciel quand il y en a (voir ci-dessus). */
export async function withQuotedFromDocuments<T extends { id: string; quotedHt: number | null }>(rows: T[]): Promise<T[]> {
  const quoted = await worksiteQuotedHtBatch(rows.map((r) => r.id));
  return rows.map((r) => (quoted.has(r.id) ? { ...r, quotedHt: quoted.get(r.id)! } : r));
}

/**
 * Facturé HT par chantier — juste la partie "CA vente" de worksiteMargin(), en un seul aller-
 * retour DB pour toute une liste (page Chantiers) plutôt qu'un worksiteMargin() complet par ligne
 * (qui ferait 4+ requêtes par chantier, bien trop coûteux sur une liste).
 */
export async function worksiteInvoicedHtBatch(worksiteIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (worksiteIds.length === 0) return totals;
  const ledger = await prisma.ledgerEntry.findMany({
    where: { worksiteId: { in: worksiteIds }, direction: { in: ['sale', 'credit_note'] } },
    select: { worksiteId: true, ht: true, direction: true, categoryRaw: true },
  });
  for (const e of ledger) {
    if (!e.worksiteId) continue;
    if (e.direction === 'sale' || (e.direction === 'credit_note' && isCreditNoteSale(e.categoryRaw))) {
      totals.set(e.worksiteId, (totals.get(e.worksiteId) ?? 0) + e.ht);
    }
  }
  return totals;
}

/**
 * Marge réelle d'un chantier, calculée à partir des lignes du grand livre
 * (CA vente / coût achat) et du pointage validé (coût main-d'œuvre).
 */
/** Une ligne = un ouvrier, un jour (plusieurs pointages le même jour sont cumulés). */
export interface WorksiteLabourDay {
  date: string; // YYYY-MM-DD
  personId: string;
  personName: string;
  hours: number;
  amount: number;
  pending: boolean; // au moins un pointage encore "submitted" (pas validé bureau)
}

export interface WorksiteMarginFull extends WorksiteMargin {
  transport: WorksiteTransport;
  labour: WorksiteLabourDay[];
}

/** Détail main-d'œuvre par jour/ouvrier pour ce chantier : heures pointées ici + part de la garantie « jour presté »
 *  (complément jusqu'à `dailyHours`, tout sur ce chantier s'il est seul ce jour-là, sinon au prorata des heures). */
export async function worksiteLabourDetail(worksiteId: string): Promise<WorksiteLabourDay[]> {
  const entries = await prisma.timeEntry.findMany({
    where: { worksiteId, status: { in: ['approved', 'submitted'] }, date: { not: null } },
    select: {
      date: true, hours: true, amount: true, status: true, rateUsed: true, source: true,
      person: { select: { id: true, displayName: true, firstName: true, dailyHours: true, hourlyRate: true } },
    },
    orderBy: { date: 'asc' },
  });

  const byKey = new Map<string, WorksiteLabourDay & { rate: number | null; dailyHours: number; defaultRate: number | null; imported: boolean }>();
  for (const e of entries) {
    const date = e.date!.toISOString().slice(0, 10);
    const key = `${date}|${e.person.id}`;
    const row = byKey.get(key) ?? {
      date, personId: e.person.id, personName: e.person.displayName || e.person.firstName,
      hours: 0, amount: 0, pending: false,
      rate: null, dailyHours: e.person.dailyHours ?? 10, defaultRate: e.person.hourlyRate ?? null, imported: true,
    };
    row.hours += e.hours ?? 0;
    row.amount += e.amount ?? 0;
    row.rate = row.rate ?? e.rateUsed ?? null;
    if (e.source !== 'xlsx') row.imported = false;
    if (e.status === 'submitted') row.pending = true;
    byKey.set(key, row);
  }

  // Garantie « jour presté » : un jour presté est payé au moins `dailyHours` (10 h). Le complément est imputé au chantier du jour
  // quand l'ouvrier n'a travaillé que sur celui-ci ; s'il a pointé sur plusieurs chantiers, il est réparti au prorata des heures.
  const days = [...byKey.values()].filter((r) => !r.imported);
  if (days.length) {
    const personIds = [...new Set(days.map((r) => r.personId))];
    const dates = days.map((r) => r.date).sort();
    const all = await prisma.timeEntry.findMany({
      where: { personId: { in: personIds }, status: { in: ['approved', 'submitted'] }, date: { gte: new Date(`${dates[0]}T00:00:00Z`), lte: new Date(`${dates[dates.length - 1]}T00:00:00Z`) } },
      select: { personId: true, date: true, hours: true, amount: true, source: true },
    });
    const dayTotals = new Map<string, { hours: number; amount: number }>();
    for (const e of all) {
      if (e.source === 'xlsx' || !e.date) continue;
      const k = `${e.date.toISOString().slice(0, 10)}|${e.personId}`;
      const t = dayTotals.get(k) ?? { hours: 0, amount: 0 };
      t.hours += e.hours ?? 0;
      t.amount += e.amount ?? 0;
      dayTotals.set(k, t);
    }
    for (const r of days) {
      const rate = r.rate ?? r.defaultRate;
      const total = dayTotals.get(`${r.date}|${r.personId}`) ?? { hours: r.hours, amount: r.amount };
      if (!rate || total.hours <= 0) continue;
      const addHours = Math.max(0, r.dailyHours - total.hours);
      const addAmount = Math.max(0, Math.round(r.dailyHours * rate * 100) / 100 - total.amount);
      if (addAmount <= 0) continue;
      const share = r.hours / total.hours; // 1 si le chantier est le seul du jour
      r.hours += addHours * share;
      r.amount += addAmount * share;
    }
  }
  return [...byKey.values()]
    .map(({ rate: _r, dailyHours: _d, defaultRate: _f, imported: _i, ...r }) => ({ ...r, hours: Math.round(r.hours * 100) / 100, amount: Math.round(r.amount * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.personName.localeCompare(b.personName));
}

/**
 * Facture consolidée : un fournisseur regroupe parfois plusieurs bordereaux de CHANTIERS DIFFÉRENTS sur une seule facture, qui n'a qu'un chantier.
 * Le coût de chaque bordereau est reporté sur SON chantier ; ce que les bordereaux ne couvrent pas reste sur le chantier de la facture.
 * Retourne l'écart à appliquer au coût matériaux de `worksiteId` (négatif : coût qui part vers un autre chantier ; positif : coût qui arrive).
 */
export async function slipCostShift(worksiteId: string): Promise<number> {
  const involved = await prisma.ledgerEntry.findMany({
    where: {
      direction: 'delivery_slip', NOT: { linkedInvoiceId: null },
      OR: [
        { worksiteId, linkedInvoice: { is: { direction: 'purchase', OR: [{ worksiteId: null }, { worksiteId: { not: worksiteId } }] } } },
        { NOT: { worksiteId }, linkedInvoice: { is: { direction: 'purchase', worksiteId } } },
      ],
    },
    select: { linkedInvoiceId: true },
  });
  const invoiceIds = [...new Set(involved.map((s) => s.linkedInvoiceId!))];
  if (!invoiceIds.length) return 0;
  const [invoices, slips] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, ht: true, worksiteId: true, docNumber: true, contactId: true, supplierName: true } }),
    prisma.ledgerEntry.findMany({ where: { direction: 'delivery_slip', linkedInvoiceId: { in: invoiceIds } }, select: { linkedInvoiceId: true, worksiteId: true, ht: true } }),
  ]);
  let delta = 0;
  for (const inv of invoices) {
    // facture déjà répartie par chantier à la saisie (une écriture par chantier, même n° de facture) : la répartition existe déjà, on n'y touche pas
    if (inv.docNumber && await prisma.ledgerEntry.count({ where: { direction: 'purchase', docNumber: inv.docNumber, id: { not: inv.id }, OR: [...(inv.contactId ? [{ contactId: inv.contactId }] : []), ...(inv.supplierName ? [{ supplierName: inv.supplierName }] : [])] } }) > 0) continue;
    const alloc = invoiceWorksiteAllocation(inv, slips.filter((s) => s.linkedInvoiceId === inv.id));
    if (!alloc.length) continue;
    delta += (alloc.find((a) => a.worksiteId === worksiteId)?.ht ?? 0) - (inv.worksiteId === worksiteId ? inv.ht : 0);
  }
  return Math.round(delta * 100) / 100;
}

export async function worksiteMargin(worksiteId: string): Promise<WorksiteMarginFull | null> {
  const ws = await prisma.worksite.findUnique({ where: { id: worksiteId } });
  if (!ws) return null;

  const [ledger, time, transport, labour] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { worksiteId }, include: { document: { select: { status: true, paidAmount: true, totalTtc: true } } } }),
    prisma.timeEntry.aggregate({
      where: { worksiteId, status: { in: ['approved', 'submitted'] }, date: null },
      _sum: { amount: true },
    }),
    worksiteTransport(worksiteId),
    worksiteLabourDetail(worksiteId),
  ]);
  // pointages datés (garantie de la journée incluse) + pointages sans date
  const timeAmount = labour.reduce((s, d) => s + d.amount, 0) + (time._sum.amount ?? 0);

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
      paidHt += e.ht * paidFraction(e); // payée partiellement : la part déjà versée compte dans l'encaissé
    } else if (e.direction === 'purchase') {
      if (isVehicleFinancing(e.categoryRaw)) continue; // crédit/leasing : financement, pas une dépense
      if (isOuvrierRemuneration(e.categoryRaw)) invoicedLabourCost += e.ht;
      else materialCost += e.ht;
    } else if (e.direction === 'credit_note') {
      // signe déjà négatif dans la donnée — mais une note de crédit d'achat doit réduire
      // le coût matériaux, pas le CA (sinon vente et achat se neutralisent à tort).
      if (isCreditNoteSale(e.categoryRaw)) {
        invoicedHt += e.ht;
        paidHt += e.ht * paidFraction(e);
      } else if (!isVehicleFinancing(e.categoryRaw)) {
        materialCost += e.ht;
      }
    }
  }

  materialCost += await slipCostShift(worksiteId);

  // Tant qu'aucune facture "Rémunération - Ouvrier" n'existe pour ce chantier, on garde
  // l'estimation par pointage (c'est elle qui sert à préparer la facture, cf. décompte mensuel).
  const labourCost = invoicedLabourCost > 0 ? invoicedLabourCost : timeAmount;

  const margin = computeWorksiteMargin({
    entity: (ws.entity as Entity) ?? 'jjd',
    quotedHt: (await worksiteQuotedHtBatch([worksiteId])).get(worksiteId) ?? ws.quotedHt ?? 0,
    invoicedHt,
    paidHt,
    materialCost,
    labourCost,
    vehicleCost: transport.cost,
  });
  return { ...margin, transport, labour };
}
