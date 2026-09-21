import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import multer from 'multer';
import {
  WORKSITE_STATUS_LABEL, WORKSITE_PRIORITY_LABEL, DOC_KIND_LABEL, WORKSITE_PROGRESS_PCT,
  INTERVENTION_PROBLEM_TYPES, INTERVENTION_PROBLEM_TYPE_LABEL,
  type WorksiteStatus, type WorksitePriority,
} from '@jjd/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { sendMail } from '../lib/mail.js';
import { attachPortalUser, requirePortal, signPortalToken, worksiteScope, buildingScope, portalFull, type PortalUser } from '../lib/portal.js';
import { UPLOADS_DIR, storeImage } from '../lib/media.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export const portalRouter = Router();
portalRouter.use(attachPortalUser);

// Voir la note dans routes/documents.ts : dérivé de UPLOADS_DIR, pas d'un chemin relatif
// au fichier compilé (qui ne pointe pas au même endroit en dist/ qu'en dev).
const PORTAL_PDF_DIR = path.join(UPLOADS_DIR, 'documents');
const pdfBasename = (n: string) => path.basename(n);
const portalPdfPath = (safe: string) => path.join(PORTAL_PDF_DIR, safe);

const OPEN_STATUSES: WorksiteStatus[] = ['scheduled', 'in_progress', 'on_hold', 'done', 'to_invoice'];

const wsLabel = (s: string) => WORKSITE_STATUS_LABEL[s as WorksiteStatus] ?? s;
const prioLabel = (p: string) => WORKSITE_PRIORITY_LABEL[p as WorksitePriority] ?? p;
const managerName = (m: { displayName: string | null; firstName: string } | null) =>
  m ? (m.displayName || m.firstName) : null;
const mSel = { select: { displayName: true, firstName: true } } as const;

// Court repère "et maintenant ?" affiché sous l'avancement, comme la maquette
// ("Prochaine étape : contrôle des finitions") — dérivé du statut, pas d'un
// champ dédié (on n'a pas d'étapes datées en base pour l'instant).
const NEXT_STEP_LABEL: Partial<Record<WorksiteStatus, string>> = {
  lead: 'Étude de votre demande',
  quote_needed: 'Envoi du devis',
  to_plan: 'Planification de l’intervention',
  scheduled: 'Début des travaux',
  in_progress: 'Poursuite des travaux',
  on_hold: 'Reprise des travaux',
  done: 'Contrôle des finitions',
  to_invoice: 'Facturation',
};

/* ---------------------------------------------------- connexion (lien magique) */

portalRouter.post(
  '/request-link',
  asyncHandler(async (req, res) => {
    const email = z.string().trim().email().parse(req.body?.email).toLowerCase();
    const user = await prisma.user.findFirst({ where: { email, role: 'client', active: true } });
    // réponse identique que le compte existe ou non (anti-énumération)
    let devToken: string | undefined;
    if (user) {
      const token = nanoid(40);
      await prisma.loginToken.create({
        data: { token, email, expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
      const link = `${env.webUrl}/portail/connexion?token=${token}`;
      await sendMail(
        email,
        'Votre accès à l’espace client JJD Consult',
        `Bonjour,\n\nVoici votre lien de connexion (valable 30 minutes) :\n${link}\n\nJJD Consult`,
      );
      // raccourci de connexion : en dev, ou pour les comptes de démonstration
      // (jamais pour un vrai client — eux reçoivent le lien par e-mail).
      if (process.env.NODE_ENV !== 'production' || email.endsWith('@portail.demo')) devToken = token;
    }
    res.json({ ok: true, devToken });
  }),
);

portalRouter.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const token = String(req.body?.token ?? '');
    const row = await prisma.loginToken.findUnique({ where: { token } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, 'Lien invalide ou expiré');
    const user = await prisma.user.findFirst({ where: { email: row.email, role: 'client', active: true } });
    if (!user) throw new HttpError(400, 'Compte introuvable');
    await prisma.loginToken.update({ where: { token }, data: { usedAt: new Date() } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    res.json({ token: signPortalToken(user.id) });
  }),
);

portalRouter.get(
  '/me',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    res.json({
      user: {
        email: u.email, label: u.label,
        isSyndic: !!u.syndicId,
        access: u.access,
        scopeLabel: u.buildingName ?? (u.syndicId ? 'Portefeuille' : null),
        // syndic : portefeuille d'immeubles — building : résident d'un immeuble — client : particulier, projet(s) en direct
        scope: u.syndicId ? 'syndic' : u.buildingId ? 'building' : 'client',
      },
    });
  }),
);

/* ------------------------------------------------------------- vue d'ensemble */

portalRouter.get(
  '/dashboard',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const scope = worksiteScope(u);

    const scopeKind = u.syndicId ? 'syndic' : u.buildingId ? 'building' : 'client';
    const [buildingCount, worksites, quotes, events, docs, portfolioBuildings] = await Promise.all([
      prisma.contact.count({ where: buildingScope(u) }),
      prisma.worksite.findMany({
        where: scope,
        orderBy: { updatedAt: 'desc' },
        include: {
          acp: { select: { id: true, name: true, photoThumbUrl: true, address: true, city: true } },
          manager: mSel,
          // dernière facture émise : sert à afficher payé/impayé à côté du statut chantier
          // ("Facturé" ou "Clôturé" ne dit pas au syndic si l'argent est vraiment arrivé)
          documents: { where: { kind: 'invoice', number: { not: null } }, orderBy: { issuedOn: 'desc' }, take: 1, select: { status: true } },
        },
      }),
      prisma.document.findMany({
        where: { kind: 'quote', status: 'sent', number: { not: null }, worksite: scope },
        orderBy: { issuedOn: 'desc' },
        include: { worksite: { select: { id: true, ref: true, acp: { select: { name: true } } } } },
      }),
      prisma.planningEvent.findMany({
        where: { worksite: scope, endAt: { gte: startOfWeek(new Date()) }, startAt: { lt: addDays(startOfWeek(new Date()), 21) } },
        orderBy: { startAt: 'asc' },
        include: { worksite: { select: { id: true, ref: true, acp: { select: { name: true } } } } },
      }),
      prisma.document.findMany({
        where: { number: { not: null }, worksite: scope },
        orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        include: { worksite: { select: { acp: { select: { name: true } } } } },
      }),
      // portefeuille avec photos, en avant sur l'accueil comme la maquette — n'a de sens
      // que pour un syndic gérant plusieurs immeubles (cf. nav portfolio: true).
      scopeKind === 'syndic' ? prisma.contact.findMany({
        where: buildingScope(u),
        orderBy: { name: 'asc' },
        take: 4,
        include: { acpWorksites: { where: scope, select: { id: true, status: true } } },
      }) : Promise.resolve([]),
    ]);

    const open = worksites.filter((w) => OPEN_STATUSES.includes(w.status as WorksiteStatus));
    const urgent = open.filter((w) => w.priority === 'high' || w.priority === 'urgent');
    const full = portalFull(u);
    // Client particulier (pas syndic, pas résident d'un immeuble) avec un seul chantier ouvert :
    // on met en avant sa progression, comme la maquette ("Avancement des travaux").
    const single = scopeKind === 'client' && open.length === 1 ? open[0]! : null;
    const singleProject = single ? {
      id: single.id, ref: single.ref, title: single.title,
      building: single.acp?.name ?? null,
      address: [single.acp?.address, single.acp?.city].filter(Boolean).join(', ') || null,
      photoThumbUrl: single.acp?.photoThumbUrl ?? null,
      status: single.status, statusLabel: wsLabel(single.status),
      progressPct: WORKSITE_PROGRESS_PCT[single.status as WorksiteStatus] ?? 0,
      nextStep: NEXT_STEP_LABEL[single.status as WorksiteStatus] ?? null,
      manager: managerName(single.manager),
    } : null;

    return res.json({
      greeting: { name: u.label, isSyndic: !!u.syndicId, access: u.access, scopeLabel: u.buildingName },
      singleProject,
      portfolio: portfolioBuildings.map((b) => ({
        id: b.id, name: b.name, city: b.city, lotCount: b.lotCount, photoThumbUrl: b.photoThumbUrl,
        open: b.acpWorksites.filter((w) => OPEN_STATUSES.includes(w.status as WorksiteStatus)).length,
      })),
      kpis: {
        buildings: buildingCount,
        interventionsActive: open.length,
        quotesToValidate: full ? quotes.length : null,
        urgent: urgent.length,
      },
      urgentItems: urgent.slice(0, 4).map((w) => ({
        id: w.id, ref: w.ref, title: w.title, building: w.acp?.name ?? null,
        statusLabel: wsLabel(w.status), priority: w.priority,
      })),
      recentInterventions: worksites.slice(0, 6).map((w) => ({
        id: w.id, ref: w.ref, title: w.title, building: w.acp?.name ?? null,
        status: w.status, statusLabel: wsLabel(w.status),
        priority: w.priority, priorityLabel: prioLabel(w.priority),
        manager: managerName(w.manager), updatedAt: w.updatedAt,
        invoiceStatus: w.documents[0]?.status ?? null,
      })),
      weekPlanning: groupWeek(events),
      quotesToValidate: full ? quotes.slice(0, 4).map((d) => ({
        id: d.id, number: d.number, title: d.title, totalHt: d.totalHt,
        building: d.worksite?.acp?.name ?? null, worksiteId: d.worksite?.id ?? null,
        worksiteRef: d.worksite?.ref ?? null, issuedOn: d.issuedOn,
      })) : [],
      recentDocuments: full ? docs.map((d) => ({
        id: d.id, kind: d.kind, kindLabel: DOC_KIND_LABEL[d.kind] ?? d.kind, number: d.number,
        title: d.title, building: d.worksite?.acp?.name ?? null, issuedOn: d.issuedOn, hasPdf: !!d.originalPdf,
        status: d.status,
      })) : [],
    });
  }),
);

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
type PEvt = {
  startAt: Date; endAt: Date; allDay: boolean; title: string | null;
  worksite: { id: string; ref: string; acp: { name: string | null } | null } | null;
};
function groupWeek(events: PEvt[]) {
  const week0 = startOfWeek(new Date());
  const days: { label: string; date: string; iso: string; items: unknown[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(week0, i);
    days.push({
      label: d.toLocaleDateString('fr-BE', { weekday: 'short' }).replace('.', '').toUpperCase(),
      date: d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' }),
      iso: d.toISOString().slice(0, 10),
      items: [],
    });
  }
  for (const e of events) {
    const iso = new Date(e.startAt).toISOString().slice(0, 10);
    const day = days.find((x) => x.iso === iso);
    if (!day) continue;
    day.items.push({
      time: e.allDay ? '' : new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }),
      label: `${e.worksite?.acp?.name ?? e.worksite?.ref ?? ''}${e.title ? ` — ${e.title}` : ''}`.trim() || 'Intervention',
      worksiteId: e.worksite?.id ?? null,
    });
  }
  return { weekStart: week0.toISOString().slice(0, 10), days };
}

/* --------------------------------------------------------- listes de portefeuille */

portalRouter.get(
  '/interventions',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const { status, buildingId, q } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { ...worksiteScope(u) };
    if (status === 'open') where.status = { in: OPEN_STATUSES };
    else if (status) where.status = status;
    if (buildingId) where.acpId = buildingId;
    if (q) where.OR = [{ ref: { contains: q } }, { title: { contains: q } }];
    const items = await prisma.worksite.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 300,
      include: { acp: { select: { id: true, name: true } }, manager: { select: { displayName: true, firstName: true } } },
    });
    res.json({
      items: items.map((w) => ({
        id: w.id, ref: w.ref, title: w.title,
        status: w.status, statusLabel: wsLabel(w.status),
        priority: w.priority, priorityLabel: prioLabel(w.priority),
        building: w.acp, manager: managerName(w.manager),
        startedOn: w.startedOn, endedOn: w.endedOn, updatedAt: w.updatedAt,
      })),
    });
  }),
);

portalRouter.get(
  '/quotes',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    if (!portalFull(u)) throw new HttpError(403, 'Accès limité');
    const items = await prisma.document.findMany({
      where: { kind: 'quote', number: { not: null }, worksite: worksiteScope(u) },
      orderBy: { issuedOn: 'desc' },
      include: { worksite: { select: { id: true, ref: true, acp: { select: { name: true } } } } },
    });
    res.json({
      items: items.map((d) => ({
        id: d.id, number: d.number, title: d.title, status: d.status, hasPdf: !!d.originalPdf,
        totalHt: d.totalHt, totalTtc: d.totalTtc, issuedOn: d.issuedOn, dueOn: d.dueOn,
        worksiteId: d.worksite?.id ?? null, worksiteRef: d.worksite?.ref ?? null,
        building: d.worksite?.acp?.name ?? null,
      })),
    });
  }),
);

portalRouter.get(
  '/documents',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    if (!portalFull(u)) throw new HttpError(403, 'Accès limité');
    const { kind } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { number: { not: null }, worksite: worksiteScope(u) };
    if (kind) where.kind = kind;
    const items = await prisma.document.findMany({
      where,
      orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { worksite: { select: { id: true, ref: true, acp: { select: { name: true } } } } },
    });
    res.json({
      items: items.map((d) => ({
        id: d.id, kind: d.kind, kindLabel: DOC_KIND_LABEL[d.kind] ?? d.kind, number: d.number, title: d.title,
        status: d.status, totalTtc: d.totalTtc, issuedOn: d.issuedOn, hasPdf: !!d.originalPdf,
        worksiteId: d.worksite?.id ?? null, building: d.worksite?.acp?.name ?? null,
      })),
    });
  }),
);

portalRouter.get(
  '/planning',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const from = startOfWeek(new Date());
    // 2 semaines plutôt que 6 (avant) : sur un gros portefeuille (plusieurs immeubles), 6
    // semaines d'interventions à plat rendait la page interminable, impossible à faire défiler
    // jusqu'en bas — voir aussi le plafond de hauteur par jour côté page (portal.css).
    const events = await prisma.planningEvent.findMany({
      where: { worksite: worksiteScope(u), endAt: { gte: from }, startAt: { lt: addDays(from, 14) } },
      orderBy: { startAt: 'asc' },
      take: 500,
      include: {
        worksite: { select: { id: true, ref: true, title: true, acp: { select: { name: true } } } },
        team: { select: { name: true } },
        assignments: { include: { person: { select: { displayName: true, firstName: true } } } },
      },
    });
    res.json({
      items: events.map((e) => ({
        id: e.id, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, title: e.title,
        worksiteId: e.worksite?.id ?? null, worksiteRef: e.worksite?.ref ?? null,
        worksiteTitle: e.worksite?.title ?? null, building: e.worksite?.acp?.name ?? null,
        team: e.team?.name ?? null,
        people: e.assignments.map((a) => managerName(a.person)).filter(Boolean),
      })),
    });
  }),
);

/* ------------------------------------------------------------- immeubles / ACP */

portalRouter.get(
  '/buildings',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const buildings = await prisma.contact.findMany({
      where: buildingScope(u),
      orderBy: { name: 'asc' },
      include: {
        syndic: { select: { name: true } },
        acpWorksites: {
          where: worksiteScope(u),
          select: { id: true, ref: true, title: true, status: true, endedOn: true, updatedAt: true, manager: mSel },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    res.json({
      buildings: buildings.map((b) => ({
        id: b.id,
        name: b.name,
        address: [b.address, b.city].filter(Boolean).join(', '),
        city: b.city,
        syndic: b.syndic?.name ?? null,
        lotCount: b.lotCount,
        photoThumbUrl: b.photoThumbUrl,
        // « Interlocuteur JJD » façon maquette : le chef de chantier du dossier le plus
        // récent (acpWorksites déjà trié par updatedAt desc) — un immeuble n'a pas un seul
        // responsable fixe, mais on montre le contact le plus pertinent du moment.
        manager: managerName(b.acpWorksites.find((w) => w.manager)?.manager ?? null),
        open: b.acpWorksites.filter((w) => OPEN_STATUSES.includes(w.status as WorksiteStatus)).length,
        worksites: b.acpWorksites,
      })),
    });
  }),
);

/* ----------------------------------------------------------------- chantiers */

async function loadWorksite(u: PortalUser, id: string) {
  const w = await prisma.worksite.findFirst({
    where: { id, ...worksiteScope(u) },
    include: {
      acp: { select: { id: true, name: true } },
      manager: { select: { displayName: true, firstName: true, phone: true } },
      documents: { orderBy: { issuedOn: 'desc' } },
      reports: { where: { status: 'signed' }, orderBy: { date: 'desc' }, include: { photos: true } },
      thread: {
        include: {
          // seuls les messages destinés au client, + les photos/vidéos internes
          // explicitement partagées (jamais le fil interne de l'équipe)
          messages: { where: { OR: [{ audience: 'client' }, { sharedWithClient: true }] }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  if (!w) throw new HttpError(404, 'Chantier introuvable');
  return w;
}

portalRouter.get(
  '/worksites',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const items = await prisma.worksite.findMany({
      where: worksiteScope(u),
      orderBy: { updatedAt: 'desc' },
      include: { acp: { select: { id: true, name: true } } },
    });
    res.json({
      items: items.map((w) => ({
        id: w.id,
        ref: w.ref,
        title: w.title,
        status: w.status,
        statusLabel: WORKSITE_STATUS_LABEL[w.status as WorksiteStatus] ?? w.status,
        building: w.acp,
        endedOn: w.endedOn,
        urgent: w.status === 'to_invoice' || w.status === 'on_hold',
      })),
    });
  }),
);

portalRouter.get(
  '/worksites/:id',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const w = await loadWorksite(u, req.params.id!);
    const messages = w.thread?.messages ?? [];
    const full = portalFull(u);
    res.json({
      worksite: {
        id: w.id, ref: w.ref, title: w.title, status: w.status,
        statusLabel: WORKSITE_STATUS_LABEL[w.status as WorksiteStatus] ?? w.status,
        address: [w.address, w.city].filter(Boolean).join(', '),
        building: w.acp, startedOn: w.startedOn, endedOn: w.endedOn,
        description: w.description,
        nextStep: NEXT_STEP_LABEL[w.status as WorksiteStatus] ?? null,
      },
      manager: w.manager ? { name: managerName(w.manager), phone: w.manager.phone } : null,
      access: u.access,
      quotes: !full ? [] : w.documents.filter((d) => d.kind === 'quote' && d.number).map((d) => ({
        id: d.id, number: d.number, title: d.title, status: d.status, hasPdf: !!d.originalPdf,
        totalHt: d.totalHt, totalTtc: d.totalTtc, issuedOn: d.issuedOn, dueOn: d.dueOn,
      })),
      invoices: !full ? [] : w.documents.filter((d) => d.kind === 'invoice' && d.number).map((d) => ({
        id: d.id, number: d.number, status: d.status, hasPdf: !!d.originalPdf,
        totalTtc: d.totalTtc, paidAmount: d.paidAmount, issuedOn: d.issuedOn, dueOn: d.dueOn,
      })),
      photos: messages.filter((m) => (m.kind === 'photo' || m.kind === 'video') && m.fileUrl).map((m) => ({
        id: m.id, url: m.fileUrl, thumbUrl: m.thumbUrl, caption: m.body, createdAt: m.createdAt, video: m.kind === 'video',
      })),
      reports: w.reports.map((r) => ({
        id: r.id, date: r.date, authorName: r.authorName, workDone: r.workDone, notes: r.notes,
        clientName: r.clientName, signedAt: r.signedAt,
        photos: r.photos.map((p) => ({ id: p.id, url: p.url, thumbUrl: p.thumbUrl, caption: p.caption })),
      })),
      messages: messages.filter((m) => m.kind !== 'photo' && m.kind !== 'video').map((m) => ({
        id: m.id, body: m.body, kind: m.kind, fileUrl: m.fileUrl, thumbUrl: m.thumbUrl,
        authorName: m.authorName, createdAt: m.createdAt,
        // un message du client n'a jamais d'auteur interne (compte User) —
        // seul le bureau (réponse depuis l'app) ou le client (portail) postent ici
        fromClient: !m.authorId,
      })),
      threadClosed: !!w.thread?.closedAt,
      threadId: w.thread?.id ?? null,
    });
  }),
);

portalRouter.post(
  '/worksites/:id/messages',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const w = await loadWorksite(u, req.params.id!);
    const body = String(req.body?.body ?? '').trim();
    if (!body) throw new HttpError(422, 'Message vide');
    const thread = w.thread ?? (await prisma.thread.create({ data: { worksiteId: w.id } }));
    const msg = await prisma.message.create({
      data: { threadId: thread.id, authorName: u.label, kind: 'text', body, audience: 'client' },
    });
    res.status(201).json({ message: { id: msg.id, body: msg.body, createdAt: msg.createdAt } });
  }),
);

/* -------------------------------------------------------------------- messagerie */

// Avant cette date, pas de suivi de lecture : on ne remonte pas des années d'historique
// importé comme "non lu" au premier chargement (même logique que messagerie.ts côté staff).
const PORTAL_READ_TRACKING_LAUNCHED_AT = new Date('2026-09-17T00:00:00.000Z');

/** Toutes les conversations visibles par ce client, tous chantiers confondus — vue "boîte de
 *  réception" absente jusqu'ici (les messages n'étaient consultables que fiche par fiche). */
portalRouter.get(
  '/messages',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const msgFilter = { OR: [{ audience: 'client' }, { sharedWithClient: true }] };
    const threads = await prisma.thread.findMany({
      where: { kind: 'worksite', worksite: worksiteScope(u), messages: { some: msgFilter } },
      include: {
        worksite: { select: { id: true, ref: true, title: true, acp: { select: { name: true } } } },
        messages: { where: msgFilter, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const reads = await prisma.threadRead.findMany({
      where: { userId: u.id, audience: 'client', threadId: { in: threads.map((t) => t.id) } },
    });
    const readMap = new Map(reads.map((r) => [r.threadId, r.lastReadAt]));
    const unreadCounts = await Promise.all(threads.map((t) => prisma.message.count({
      where: {
        threadId: t.id, ...msgFilter,
        authorId: { not: null }, // seuls les messages de JJD comptent comme non lus, jamais les siens
        createdAt: { gt: readMap.get(t.id) ?? PORTAL_READ_TRACKING_LAUNCHED_AT },
      },
    })));
    const items = threads
      .filter((t) => t.worksite)
      .map((t, i) => {
        const last = t.messages[0];
        return {
          threadId: t.id,
          worksiteId: t.worksite!.id,
          ref: t.worksite!.ref,
          title: t.worksite!.acp?.name ?? t.worksite!.title,
          lastMessage: last?.body ?? (last ? '📷 Photo' : ''),
          lastAt: last?.createdAt.toISOString() ?? null,
          unread: unreadCounts[i]!,
        };
      })
      .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
    res.json({ items });
  }),
);

/** Marque un fil comme lu pour ce client (badge non-lu de la messagerie portail). */
portalRouter.post(
  '/messages/:threadId/read',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const thread = await prisma.thread.findFirst({ where: { id: req.params.threadId!, worksite: worksiteScope(u) } });
    if (!thread) throw new HttpError(404, 'Conversation introuvable');
    await prisma.threadRead.upsert({
      where: { threadId_audience_userId: { threadId: thread.id, audience: 'client', userId: u.id } },
      create: { threadId: thread.id, audience: 'client', userId: u.id },
      update: { lastReadAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------ accepter un devis */

portalRouter.get(
  '/documents/:id/pdf',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    if (!portalFull(u)) throw new HttpError(403, 'Accès limité');
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id!, number: { not: null }, worksite: worksiteScope(u) },
      select: { originalPdf: true, number: true },
    });
    if (!doc?.originalPdf) throw new HttpError(404, 'PDF indisponible');
    const safe = pdfBasename(doc.originalPdf);
    const file = portalPdfPath(safe);
    if (!existsSync(file)) throw new HttpError(404, 'PDF introuvable');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.number}.pdf"`);
    createReadStream(file).pipe(res);
  }),
);

/** Accepte ou décline un devis depuis le portail — la note du client (facultative) est
 *  postée dans le fil interne du chantier, là où le bureau la verra, plutôt que stockée
 *  dans un champ à part (le document n'a pas de champ "note client" dédié). */
async function respondToQuote(req: Request, res: Response, decision: 'accepted' | 'declined') {
  const u = req.portalUser!;
  if (!portalFull(u)) throw new HttpError(403, 'Seul le syndic peut répondre à un devis');
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id!, kind: 'quote', worksite: worksiteScope(u) },
    include: { worksite: { select: { id: true, ref: true } } },
  });
  if (!doc) throw new HttpError(404, 'Devis introuvable');
  if (doc.status === decision) return res.json({ ok: true });
  const note = String(req.body?.note ?? '').trim().slice(0, 1000);
  await prisma.document.update({ where: { id: doc.id }, data: { status: decision } });
  if (doc.worksite) {
    const thread = await prisma.thread.upsert({
      where: { worksiteId: doc.worksite.id },
      create: { worksiteId: doc.worksite.id },
      update: {},
    });
    const verb = decision === 'accepted' ? 'accepté' : 'décliné';
    await prisma.message.create({
      data: {
        threadId: thread.id, authorName: u.label, kind: 'status',
        body: `Devis ${doc.number} ${verb} en ligne par le client${note ? ` — note : ${note}` : ''}`,
      },
    });
    await prisma.auditLog.create({
      data: { action: `quote_${decision}_portal`, entity: 'document', entityId: doc.id, meta: { by: u.label, note: note || null } },
    });
  }
  res.json({ ok: true });
}

portalRouter.post('/quotes/:id/accept', requirePortal, asyncHandler((req, res) => respondToQuote(req, res, 'accepted')));
portalRouter.post('/quotes/:id/decline', requirePortal, asyncHandler((req, res) => respondToQuote(req, res, 'declined')));

/* ----------------------------------------------- demande de nouvelle intervention */

/** Upload d'une photo pendant le parcours "Nouvelle demande" (étape Problème) — l'opportunité
 *  n'existe pas encore à ce stade, donc pas d'attache immédiate : le client reçoit juste
 *  l'URL, à renvoyer dans la liste `photos` du POST /requests final. */
portalRouter.post(
  '/requests/photos',
  requirePortal,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const img = await storeImage(req.file.buffer);
    res.status(201).json({ url: img.url, thumbUrl: img.thumbUrl });
  }),
);

portalRouter.post(
  '/requests',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const input = z.object({
      title: z.string().trim().min(3),
      buildingId: z.string().nullish(),
      unitLabel: z.string().trim().nullish(),
      details: z.string().trim().nullish(),
      urgent: z.boolean().default(false),
      // niveau d'urgence à 3 choix (parcours §4) ; `urgent` reste accepté pour les anciens clients
      urgency: z.enum(['normal', 'soon', 'urgent']).nullish(),
      problemType: z.enum(INTERVENTION_PROBLEM_TYPES).nullish(),
      onSiteContactName: z.string().trim().nullish(),
      onSiteContactPhone: z.string().trim().nullish(),
      accessNotes: z.string().trim().nullish(),
      visitPreference: z.string().trim().nullish(),
      photos: z.array(z.object({ url: z.string(), thumbUrl: z.string().nullish() })).default([]),
    }).parse(req.body);
    const urgency = input.urgency ?? (input.urgent ? 'urgent' : 'normal');
    const isUrgent = urgency === 'urgent';

    const opp = await prisma.crmOpportunity.create({
      data: {
        title: input.title,
        stage: 'new',
        contactId: u.contactId,
        acpId: input.buildingId ?? null,
        source: 'portail',
        nextActionOn: new Date(),
        nextActionNote: isUrgent ? 'Demande client — URGENT' : urgency === 'soon' ? 'Demande client — à traiter cette semaine' : 'Demande client (portail)',
        note: input.details ?? null,
        problemType: input.problemType ?? null,
        unitLabel: input.unitLabel ?? null,
        urgent: isUrgent,
        urgency,
        onSiteContactName: input.onSiteContactName ?? null,
        onSiteContactPhone: input.onSiteContactPhone ?? null,
        accessNotes: input.accessNotes ?? null,
        visitPreference: input.visitPreference ?? null,
        photos: { create: input.photos.map((p) => ({ url: p.url, thumbUrl: p.thumbUrl ?? null })) },
      },
    });
    await sendMail(
      'info@jjd-consult.be',
      `Nouvelle demande — ${u.label}`,
      [
        `${u.label} a déposé une demande via le portail :`,
        '',
        input.title,
        input.problemType ? `Type : ${INTERVENTION_PROBLEM_TYPE_LABEL[input.problemType]}` : null,
        input.unitLabel ? `Lot / zone : ${input.unitLabel}` : null,
        input.details ?? null,
        input.onSiteContactName ? `Contact sur place : ${input.onSiteContactName}${input.onSiteContactPhone ? ` (${input.onSiteContactPhone})` : ''}` : null,
        input.accessNotes ? `Accès : ${input.accessNotes}` : null,
        input.visitPreference ? `Préférence de passage : ${input.visitPreference}` : null,
        input.photos.length ? `${input.photos.length} photo(s) jointe(s)` : null,
        urgency === 'soon' ? '\nÀ traiter cette semaine' : null,
        isUrgent ? '\n⚠️ URGENT' : null,
      ].filter(Boolean).join('\n'),
    );
    // référence lisible, dérivée de l'id (stable, rien à stocker) : INT-2026-AB12C
    const reference = `INT-${opp.createdAt.getFullYear()}-${opp.id.slice(-5).toUpperCase()}`;
    res.status(201).json({ id: opp.id, reference });
  }),
);
