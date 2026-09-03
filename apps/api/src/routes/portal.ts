import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { WORKSITE_STATUS_LABEL, type WorksiteStatus } from '@jjd/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { sendMail } from '../lib/mail.js';
import { attachPortalUser, requirePortal, signPortalToken, worksiteScope, buildingScope, type PortalUser } from '../lib/portal.js';

export const portalRouter = Router();
portalRouter.use(attachPortalUser);

const OPEN_STATUSES: WorksiteStatus[] = ['scheduled', 'in_progress', 'on_hold', 'done', 'to_invoice'];

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
        id: d.id, number: d.number, title: d.title, status: d.status,
        totalHt: d.totalHt, totalTtc: d.totalTtc, issuedOn: d.issuedOn, dueOn: d.dueOn,
      })),
      invoices: w.documents.filter((d) => d.kind === 'invoice' && d.number).map((d) => ({
        id: d.id, number: d.number, status: d.status,
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
