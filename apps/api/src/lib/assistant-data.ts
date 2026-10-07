/**
 * Outils de LECTURE de l'assistant IA sur les chiffres de JJD (finances, marges, factures, pointage, planning).
 * Réservés à la direction (David, Julien — contrôlé par runTool) ; aucune écriture, aucune donnée personnelle des clients
 * au-delà du nom. Chaque résultat est borné pour rester sous le budget de contexte payé par appel.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { insensitive } from './search.js';
import { bureauDashboard } from './dashboard.js';
import { analytics } from './analytics.js';
import { worksiteMargin } from './worksite-margin.js';
import { teamMonthlyStatement } from './statement.js';
import { brusselsToDate } from './quote-plan.js';

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const MAX_JSON = 9000;

export const DATA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'business_summary',
    description: "Tableau de bord du bureau : facturé / encaissé du mois, impayés clients (échus), factures fournisseurs échues, devis en attente, chantiers en cours, prévisionnel des devis acceptés, alertes et qui est sur quel chantier aujourd'hui. Montants en euros (HT sauf mention).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'monthly_trends',
    description: "Évolution mensuelle du chiffre d'affaires, des dépenses, du facturé, de l'encaissé, des heures et de la main-d'œuvre sur N mois, avec la marge globale, les meilleurs chantiers et clients, et l'état des devis.",
    input_schema: { type: 'object', properties: { months: { type: 'integer', description: 'Nombre de mois (3 à 24, défaut 12)' } } },
  },
  {
    name: 'worksite_figures',
    description: "Chiffres d'UN chantier (id obtenu avec search_worksites) : devisé, facturé, encaissé, coûts matériaux / main-d'œuvre / véhicule, marge réelle (sur l'encaissé), marge prévisionnelle, reste à facturer ; liste de ses devis et factures ; tâches ouvertes ; prochaines interventions.",
    input_schema: { type: 'object', properties: { worksiteId: { type: 'string' } }, required: ['worksiteId'] },
  },
  {
    name: 'search_documents',
    description: "Cherche des devis, factures, acomptes ou notes de crédit de vente (numéro, titre, client, chantier). Filtres facultatifs : kind (quote|invoice|deposit_invoice|credit_note), status (draft|sent|accepted|declined|paid|partial|overdue|credited), worksiteId, contactId. 25 résultats maximum.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Numéro, titre, nom du client ou référence chantier' },
        kind: { type: 'string', enum: ['quote', 'invoice', 'deposit_invoice', 'credit_note'] },
        status: { type: 'string' },
        worksiteId: { type: 'string' },
        contactId: { type: 'string' },
        limit: { type: 'integer', description: '1 à 25 (défaut 15)' },
      },
    },
  },
  {
    name: 'unpaid_invoices',
    description: "Factures de vente non soldées (envoyées, partiellement payées ou en retard) avec le reste à encaisser, l'échéance et le retard en jours, triées par montant restant. Donne aussi le total.",
    input_schema: { type: 'object', properties: { overdueOnly: { type: 'boolean', description: 'Seulement les factures échues' } } },
  },
  {
    name: 'team_timesheet',
    description: "Décompte du mois pour l'équipe : heures, jours, montant dû et montant remis en main par personne, pointages en attente de validation, heures prévues au planning.",
    input_schema: { type: 'object', properties: { year: { type: 'integer' }, month: { type: 'integer', description: '1 à 12' } }, required: ['year', 'month'] },
  },
  {
    name: 'planning_range',
    description: "Interventions et rendez-vous du planning entre deux dates (AAAA-MM-JJ, inclus), avec chantier, équipe affectée et statut (confirmé / à confirmer). Filtre facultatif par chantier. 60 résultats maximum.",
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, worksiteId: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
];

export const DATA_TOOL_NAMES = new Set(DATA_TOOLS.map((t) => t.name));

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  business_summary: z.object({}).strict(),
  monthly_trends: z.object({ months: z.number().int().min(3).max(24).optional() }).strict(),
  worksite_figures: z.object({ worksiteId: z.string().min(1).max(60) }).strict(),
  search_documents: z.object({
    query: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(['quote', 'invoice', 'deposit_invoice', 'credit_note']).optional(),
    status: z.string().trim().max(20).optional(),
    worksiteId: z.string().min(1).max(60).optional(),
    contactId: z.string().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }).strict(),
  unpaid_invoices: z.object({ overdueOnly: z.boolean().optional() }).strict(),
  team_timesheet: z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) }).strict(),
  planning_range: z.object({ from: isoDay, to: isoDay, worksiteId: z.string().min(1).max(60).optional() }).strict(),
};

/** Garde-fou de taille : un résultat trop gros est tronqué plutôt que de faire exploser le contexte payant. */
function bounded(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json.length <= MAX_JSON) return value;
  return { tronque: true, note: 'Résultat trop long, tronqué : affine la demande (période plus courte, filtre).', debut: json.slice(0, MAX_JSON) };
}

export async function runDataTool(name: string, raw: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'business_summary': {
      schemas.business_summary.parse(raw);
      const d = await bureauDashboard();
      return bounded({
        kpis: d.kpis,
        alertes: d.alerts.map((a) => ({ label: a.label, nombre: a.count, montant: a.amount ?? null, gravite: a.severity })),
        chantiersEnCours: d.inProgress.map((w) => ({ ref: w.ref, titre: w.title, client: w.client, responsable: w.manager })),
        surLeTerrainAujourdhui: d.fieldToday.map((e) => ({ chantier: e.worksite?.ref ?? null, equipe: e.people.map((p) => p.name), aConfirmer: e.tentative })),
      });
    }
    case 'monthly_trends': {
      const i = schemas.monthly_trends.parse(raw);
      const a = await analytics({ months: i.months ?? 12 });
      return bounded({ periode: a.range, parMois: a.monthly, totaux: a.totals, periodePrecedente: a.prev, meilleursChantiers: a.topWorksites, meilleursClients: a.topClients, devis: a.quotes });
    }
    case 'worksite_figures': {
      const i = schemas.worksite_figures.parse(raw);
      const ws = await prisma.worksite.findUnique({
        where: { id: i.worksiteId },
        select: { id: true, ref: true, title: true, status: true, city: true, entity: true, client: { select: { name: true } } },
      });
      if (!ws) return { erreur: 'Chantier introuvable — utilise search_worksites.' };
      const now = new Date();
      const [margin, docs, openTasks, next] = await Promise.all([
        worksiteMargin(i.worksiteId),
        prisma.document.findMany({
          where: { worksiteId: i.worksiteId, kind: { in: ['quote', 'invoice', 'deposit_invoice', 'credit_note'] } },
          orderBy: [{ issuedOn: 'asc' }, { createdAt: 'asc' }], take: 40,
          select: { number: true, draftRef: true, kind: true, status: true, totalHt: true, totalTtc: true, paidAmount: true, issuedOn: true },
        }),
        prisma.worksiteTask.count({ where: { worksiteId: i.worksiteId, status: { not: 'done' } } }),
        prisma.planningEvent.findMany({ where: { worksiteId: i.worksiteId, endAt: { gte: now } }, orderBy: { startAt: 'asc' }, take: 5, select: { startAt: true, endAt: true, status: true, kind: true, title: true } }),
      ]);
      return bounded({
        chantier: { ref: ws.ref, titre: ws.title, statut: ws.status, ville: ws.city, entite: ws.entity, client: ws.client?.name ?? null },
        chiffres: margin && {
          devisHt: margin.quotedHt, factureHt: margin.invoicedHt, encaisseHt: margin.paidHt,
          coutMateriaux: margin.materialCost, coutMainOeuvre: margin.labourCost, coutVehicule: margin.vehicleCost, coutTotal: margin.totalCost,
          margeReelleSurEncaisse: margin.realMargin, margeReellePct: margin.realMarginPct, margeSurFacture: margin.invoicedMargin,
          margePrevisionnelle: margin.forecastMargin, resteAFacturerHt: margin.leftToInvoice,
        },
        documents: docs.map((d) => ({ numero: d.number ?? d.draftRef, type: d.kind, statut: d.status, ht: d.totalHt, ttc: d.totalTtc, paye: d.paidAmount, date: day(d.issuedOn) })),
        tachesOuvertes: openTasks,
        prochainesInterventions: next.map((e) => ({ debut: e.startAt.toISOString(), fin: e.endAt.toISOString(), statut: e.status, type: e.kind, titre: e.title })),
      });
    }
    case 'search_documents': {
      const i = schemas.search_documents.parse(raw);
      const q = i.query;
      const rows = await prisma.document.findMany({
        where: {
          source: { not: 'demo' }, direction: 'sale',
          ...(i.kind ? { kind: i.kind } : { kind: { in: ['quote', 'invoice', 'deposit_invoice', 'credit_note'] } }),
          ...(i.status ? { status: i.status } : {}),
          ...(i.worksiteId ? { worksiteId: i.worksiteId } : {}),
          ...(i.contactId ? { contactId: i.contactId } : {}),
          ...(q ? { OR: [
            { number: { contains: q, ...insensitive } }, { title: { contains: q, ...insensitive } },
            { contact: { name: { contains: q, ...insensitive } } }, { worksite: { ref: { contains: q, ...insensitive } } }, { worksite: { title: { contains: q, ...insensitive } } },
          ] } : {}),
        },
        orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }], take: i.limit ?? 15,
        select: { id: true, number: true, draftRef: true, kind: true, status: true, title: true, totalHt: true, totalTtc: true, paidAmount: true, issuedOn: true, dueOn: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
      });
      return bounded({ resultats: rows.map((d) => ({ id: d.id, numero: d.number ?? d.draftRef, type: d.kind, statut: d.status, titre: d.title, client: d.contact?.name ?? null, chantier: d.worksite?.ref ?? null, ht: d.totalHt, ttc: d.totalTtc, paye: d.paidAmount, date: day(d.issuedOn), echeance: day(d.dueOn) })) });
    }
    case 'unpaid_invoices': {
      const i = schemas.unpaid_invoices.parse(raw);
      const rows = await prisma.document.findMany({
        where: { kind: { in: ['invoice', 'deposit_invoice'] }, status: i.overdueOnly ? 'overdue' : { in: ['sent', 'partial', 'overdue'] }, source: { not: 'demo' } },
        select: { number: true, status: true, totalTtc: true, paidAmount: true, issuedOn: true, dueOn: true, contact: { select: { name: true } }, worksite: { select: { ref: true } } },
      });
      const now = Date.now();
      const items = rows
        .map((d) => ({ numero: d.number, statut: d.status, client: d.contact?.name ?? null, chantier: d.worksite?.ref ?? null, ttc: d.totalTtc, paye: d.paidAmount, resteTtc: round2(Math.max(0, d.totalTtc - d.paidAmount)), echeance: day(d.dueOn), retardJours: d.dueOn && d.dueOn.getTime() < now ? Math.floor((now - d.dueOn.getTime()) / 86_400_000) : 0 }))
        .filter((d) => d.resteTtc > 0.5)
        .sort((a, b) => b.resteTtc - a.resteTtc);
      return bounded({ nombre: items.length, totalResteTtc: round2(items.reduce((s, d) => s + d.resteTtc, 0)), plusGrosses: items.slice(0, 30) });
    }
    case 'team_timesheet': {
      const i = schemas.team_timesheet.parse(raw);
      const s = await teamMonthlyStatement(i.year, i.month);
      return bounded({
        annee: s.year, mois: s.month, totalDu: s.totalAmount, totalRemisEnMain: s.totalPayoutAmount, totalNet: s.totalNetAmount,
        personnes: s.rows.map((r) => ({ nom: r.name, contrat: r.contractType, heures: r.hours, jours: r.days, montantDu: r.amount, remisEnMain: r.payoutAmount, aRetenir: r.toWithhold, net: r.netAmount, pointagesEnAttente: r.pending, heuresPrevuesPlanning: r.plannedHours })),
      });
    }
    case 'planning_range': {
      const i = schemas.planning_range.parse(raw);
      const from = brusselsToDate(i.from, '00:00');
      const to = brusselsToDate(i.to, '23:59');
      if (to < from) return { erreur: 'La date de fin est avant le début.' };
      const events = await prisma.planningEvent.findMany({
        where: { startAt: { lte: to }, endAt: { gte: from }, ...(i.worksiteId ? { worksiteId: i.worksiteId } : {}) },
        orderBy: { startAt: 'asc' }, take: 60,
        include: { worksite: { select: { ref: true, title: true } }, assignments: { include: { person: { select: { displayName: true, firstName: true } } } } },
      });
      return bounded({ evenements: events.map((e) => ({ debut: e.startAt.toISOString(), fin: e.endAt.toISOString(), chantier: e.worksite.ref, titre: e.title ?? e.worksite.title, type: e.kind, statut: e.status, equipe: e.assignments.map((a) => a.person.displayName || a.person.firstName) })) });
    }
    default:
      return { erreur: `Outil inconnu : ${name}` };
  }
}
