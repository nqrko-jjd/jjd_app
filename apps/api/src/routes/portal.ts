import { Router } from 'express';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  WORKSITE_STATUS_LABEL, WORKSITE_PRIORITY_LABEL, DOC_KIND_LABEL,
  type WorksiteStatus, type WorksitePriority,
} from '@jjd/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { sendMail } from '../lib/mail.js';
import { attachPortalUser, requirePortal, signPortalToken, worksiteScope, buildingScope, type PortalUser } from '../lib/portal.js';

export const portalRouter = Router();
portalRouter.use(attachPortalUser);

const PORTAL_PDF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/documents');
const pdfBasename = (n: string) => path.basename(n);
const portalPdfPath = (safe: string) => path.join(PORTAL_PDF_DIR, safe);

const OPEN_STATUSES: WorksiteStatus[] = ['scheduled', 'in_progress', 'on_hold', 'done', 'to_invoice'];

const wsLabel = (s: string) => WORKSITE_STATUS_LABEL[s as WorksiteStatus] ?? s;
const prioLabel = (p: string) => WORKSITE_PRIORITY_LABEL[p as WorksitePriority] ?? p;
const managerName = (m: { displayName: string | null; firstName: string } | null) =>
  m ? (m.displayName || m.firstName) : null;

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
      if (process.env.NODE_ENV !== 'production') devToken = token;
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
    res.json({ user: { email: u.email, label: u.label, isSyndic: !!u.syndicId } });
  }),
);

/* ------------------------------------------------------------- vue d'ensemble */

portalRouter.get(
  '/dashboard',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const scope = worksiteScope(u);
    const mSel = { select: { displayName: true, firstName: true } } as const;

    const [buildingCount, worksites, quotes, events, docs] = await Promise.all([
      prisma.building.count({ where: buildingScope(u) }),
      prisma.worksite.findMany({
        where: scope,
        orderBy: { updatedAt: 'desc' },
        include: { building: { select: { id: true, name: true } }, manager: mSel },
      }),
      prisma.document.findMany({
        where: { kind: 'quote', status: 'sent', number: { not: null }, worksite: scope },
        orderBy: { issuedOn: 'desc' },
        include: { worksite: { select: { id: true, ref: true, building: { select: { name: true } } } } },
      }),
      prisma.planningEvent.findMany({
        where: { worksite: scope, endAt: { gte: startOfWeek(new Date()) }, startAt: { lt: addDays(startOfWeek(new Date()), 21) } },
        orderBy: { startAt: 'asc' },
        include: { worksite: { select: { id: true, ref: true, building: { select: { name: true } } } } },
      }),
      prisma.document.findMany({
        where: { number: { not: null }, worksite: scope },
        orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        include: { worksite: { select: { building: { select: { name: true } } } } },
      }),
    ]);

    const open = worksites.filter((w) => OPEN_STATUSES.includes(w.status as WorksiteStatus));
    const urgent = open.filter((w) => w.priority === 'high' || w.priority === 'urgent');

    return res.json({
      greeting: { name: u.label, isSyndic: !!u.syndicId },
      kpis: {
        buildings: buildingCount,
        interventionsActive: open.length,
        quotesToValidate: quotes.length,
        urgent: urgent.length,
      },
      urgentItems: urgent.slice(0, 4).map((w) => ({
        id: w.id, ref: w.ref, title: w.title, building: w.building?.name ?? null,
        statusLabel: wsLabel(w.status), priority: w.priority,
      })),
      recentInterventions: worksites.slice(0, 6).map((w) => ({
        id: w.id, ref: w.ref, title: w.title, building: w.building?.name ?? null,
        status: w.status, statusLabel: wsLabel(w.status),
        priority: w.priority, priorityLabel: prioLabel(w.priority),
        manager: managerName(w.manager), updatedAt: w.updatedAt,
      })),
      weekPlanning: groupWeek(events),
      quotesToValidate: quotes.slice(0, 4).map((d) => ({
        id: d.id, number: d.number, title: d.title, totalHt: d.totalHt,
        building: d.worksite?.building?.name ?? null, worksiteId: d.worksite?.id ?? null,
        worksiteRef: d.worksite?.ref ?? null, issuedOn: d.issuedOn,
      })),
      recentDocuments: docs.map((d) => ({
        id: d.id, kind: d.kind, kindLabel: DOC_KIND_LABEL[d.kind] ?? d.kind, number: d.number,
        title: d.title, building: d.worksite?.building?.name ?? null, issuedOn: d.issuedOn, hasPdf: !!d.originalPdf,
      })),
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
  worksite: { id: string; ref: string; building: { name: string | null } | null } | null;
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
      label: `${e.worksite?.building?.name ?? e.worksite?.ref ?? ''}${e.title ? ` — ${e.title}` : ''}`.trim() || 'Intervention',
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
    if (buildingId) where.buildingId = buildingId;
    if (q) where.OR = [{ ref: { contains: q } }, { title: { contains: q } }];
    const items = await prisma.worksite.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 300,
      include: { building: { select: { id: true, name: true } }, manager: { select: { displayName: true, firstName: true } } },
    });
    res.json({
      items: items.map((w) => ({
        id: w.id, ref: w.ref, title: w.title,
        status: w.status, statusLabel: wsLabel(w.status),
        priority: w.priority, priorityLabel: prioLabel(w.priority),
        building: w.building, manager: managerName(w.manager),
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
    const items = await prisma.document.findMany({
      where: { kind: 'quote', number: { not: null }, worksite: worksiteScope(u) },
      orderBy: { issuedOn: 'desc' },
      include: { worksite: { select: { id: true, ref: true, building: { select: { name: true } } } } },
    });
    res.json({
      items: items.map((d) => ({
        id: d.id, number: d.number, title: d.title, status: d.status, hasPdf: !!d.originalPdf,
        totalHt: d.totalHt, totalTtc: d.totalTtc, issuedOn: d.issuedOn, dueOn: d.dueOn,
        worksiteId: d.worksite?.id ?? null, worksiteRef: d.worksite?.ref ?? null,
        building: d.worksite?.building?.name ?? null,
      })),
    });
  }),
);

portalRouter.get(
  '/documents',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const { kind } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { number: { not: null }, worksite: worksiteScope(u) };
    if (kind) where.kind = kind;
    const items = await prisma.document.findMany({
      where,
      orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { worksite: { select: { id: true, ref: true, building: { select: { name: true } } } } },
    });
    res.json({
      items: items.map((d) => ({
        id: d.id, kind: d.kind, kindLabel: DOC_KIND_LABEL[d.kind] ?? d.kind, number: d.number, title: d.title,
        status: d.status, totalTtc: d.totalTtc, issuedOn: d.issuedOn, hasPdf: !!d.originalPdf,
        worksiteId: d.worksite?.id ?? null, building: d.worksite?.building?.name ?? null,
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
    const events = await prisma.planningEvent.findMany({
      where: { worksite: worksiteScope(u), endAt: { gte: from }, startAt: { lt: addDays(from, 42) } },
      orderBy: { startAt: 'asc' },
      include: {
        worksite: { select: { id: true, ref: true, title: true, building: { select: { name: true } } } },
        team: { select: { name: true } },
        assignments: { include: { person: { select: { displayName: true, firstName: true } } } },
      },
    });
    res.json({
      items: events.map((e) => ({
        id: e.id, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, title: e.title,
        worksiteId: e.worksite?.id ?? null, worksiteRef: e.worksite?.ref ?? null,
        worksiteTitle: e.worksite?.title ?? null, building: e.worksite?.building?.name ?? null,
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
    const buildings = await prisma.building.findMany({
      where: buildingScope(u),
      orderBy: { name: 'asc' },
      include: {
        syndic: { select: { name: true } },
        worksites: {
          where: worksiteScope(u),
          select: { id: true, ref: true, title: true, status: true, endedOn: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    res.json({
      buildings: buildings.map((b) => ({
        id: b.id,
        name: b.name,
        address: [b.address, b.city].filter(Boolean).join(', '),
        syndic: b.syndic?.name ?? null,
        open: b.worksites.filter((w) => OPEN_STATUSES.includes(w.status as WorksiteStatus)).length,
        worksites: b.worksites,
      })),
    });
  }),
);

/* ----------------------------------------------------------------- chantiers */

async function loadWorksite(u: PortalUser, id: string) {
  const w = await prisma.worksite.findFirst({
    where: { id, ...worksiteScope(u) },
    include: {
      building: { select: { id: true, name: true } },
      documents: { orderBy: { issuedOn: 'desc' } },
      thread: {
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
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
      include: { building: { select: { id: true, name: true } } },
    });
    res.json({
      items: items.map((w) => ({
        id: w.id,
        ref: w.ref,
        title: w.title,
        status: w.status,
        statusLabel: WORKSITE_STATUS_LABEL[w.status as WorksiteStatus] ?? w.status,
        building: w.building,
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
    res.json({
      worksite: {
        id: w.id, ref: w.ref, title: w.title, status: w.status,
        statusLabel: WORKSITE_STATUS_LABEL[w.status as WorksiteStatus] ?? w.status,
        address: [w.address, w.city].filter(Boolean).join(', '),
        building: w.building, startedOn: w.startedOn, endedOn: w.endedOn,
        description: w.description,
      },
      quotes: w.documents.filter((d) => d.kind === 'quote' && d.number).map((d) => ({
        id: d.id, number: d.number, title: d.title, status: d.status, hasPdf: !!d.originalPdf,
        totalHt: d.totalHt, totalTtc: d.totalTtc, issuedOn: d.issuedOn, dueOn: d.dueOn,
      })),
      invoices: w.documents.filter((d) => d.kind === 'invoice' && d.number).map((d) => ({
        id: d.id, number: d.number, status: d.status, hasPdf: !!d.originalPdf,
        totalTtc: d.totalTtc, paidAmount: d.paidAmount, issuedOn: d.issuedOn, dueOn: d.dueOn,
      })),
      photos: messages.filter((m) => m.kind === 'photo' && m.fileUrl).map((m) => ({
        id: m.id, url: m.fileUrl, thumbUrl: m.thumbUrl, caption: m.body, createdAt: m.createdAt,
      })),
      messages: messages.filter((m) => m.kind !== 'photo').map((m) => ({
        id: m.id, body: m.body, kind: m.kind, authorName: m.authorName, createdAt: m.createdAt,
        fromClient: m.authorName === u.label,
      })),
      threadClosed: !!w.thread?.closedAt,
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
      data: { threadId: thread.id, authorName: u.label, kind: 'text', body },
    });
    res.status(201).json({ message: { id: msg.id, body: msg.body, createdAt: msg.createdAt } });
  }),
);

/* ------------------------------------------------------------ accepter un devis */

portalRouter.get(
  '/documents/:id/pdf',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
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

portalRouter.post(
  '/quotes/:id/accept',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id!, kind: 'quote', worksite: worksiteScope(u) },
      include: { worksite: { select: { id: true, ref: true } } },
    });
    if (!doc) throw new HttpError(404, 'Devis introuvable');
    if (doc.status === 'accepted') return res.json({ ok: true });
    await prisma.document.update({ where: { id: doc.id }, data: { status: 'accepted' } });
    if (doc.worksite) {
      const thread = await prisma.thread.upsert({
        where: { worksiteId: doc.worksite.id },
        create: { worksiteId: doc.worksite.id },
        update: {},
      });
      await prisma.message.create({
        data: { threadId: thread.id, authorName: u.label, kind: 'status', body: `Devis ${doc.number} accepté en ligne par le client` },
      });
      await prisma.auditLog.create({
        data: { action: 'quote_accepted_portal', entity: 'document', entityId: doc.id, meta: { by: u.label } },
      });
    }
    res.json({ ok: true });
  }),
);

/* ----------------------------------------------- demande de nouvelle intervention */

portalRouter.post(
  '/requests',
  requirePortal,
  asyncHandler(async (req, res) => {
    const u = req.portalUser!;
    const input = z.object({
      title: z.string().trim().min(3),
      buildingId: z.string().nullish(),
      details: z.string().trim().nullish(),
      urgent: z.boolean().default(false),
    }).parse(req.body);

    const opp = await prisma.crmOpportunity.create({
      data: {
        title: input.title,
        stage: 'new',
        contactId: u.contactId,
        buildingId: input.buildingId ?? null,
        source: 'portail',
        nextActionOn: new Date(),
        nextActionNote: input.urgent ? 'Demande client — URGENT' : 'Demande client (portail)',
        note: input.details ?? null,
      },
    });
    await sendMail(
      'info@jjd-consult.be',
      `Nouvelle demande — ${u.label}`,
      `${u.label} a déposé une demande via le portail :\n\n${input.title}\n${input.details ?? ''}\n${input.urgent ? '\n⚠️ URGENT' : ''}`,
    );
    res.status(201).json({ id: opp.id });
  }),
);
