/**
 * « Boîte IA » — passe en revue les suggestions détectées par lib/lead-mailbox.ts sur la boîte
 * mail principale. Rien n'est jamais créé automatiquement : chaque suggestion reste "pending"
 * jusqu'à validation explicite (POST /:id/apply, qui crée le vrai enregistrement) ou rejet
 * (PATCH /:id, status: 'dismissed').
 */
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { MAIL_SUGGESTION_KINDS, type MailExtraction } from '../lib/lead-mailbox.js';

export const mailSuggestionsRouter = Router();

mailSuggestionsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { status, kind } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { kind: { not: null } };
    where.status = status && status !== 'all' ? status : 'pending';
    if (kind && (MAIL_SUGGESTION_KINDS as readonly string[]).includes(kind)) where.kind = kind;
    const items = await prisma.mailSuggestion.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: 300,
      include: { worksite: { select: { id: true, ref: true, title: true } } },
    });
    res.json({ items });
  }),
);

/** Compte des suggestions en attente par catégorie — pour la pastille de menu. */
mailSuggestionsRouter.get(
  '/counts',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.mailSuggestion.groupBy({ by: ['kind'], where: { status: 'pending' }, _count: true });
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r._count]));
    res.json({ total: rows.reduce((s, r) => s + r._count, 0), byKind });
  }),
);

/** Rejette (ou rouvre) une suggestion — ne crée jamais rien. */
mailSuggestionsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.mailSuggestion.findUnique({ where: { id: req.params.id } });
    if (!existing || !existing.kind) throw new HttpError(404, 'Suggestion introuvable');
    const status = req.body?.status === 'pending' ? 'pending' : 'dismissed';
    const updated = await prisma.mailSuggestion.update({
      where: { id: existing.id },
      data: { status, resolvedNote: typeof req.body?.resolvedNote === 'string' ? req.body.resolvedNote : existing.resolvedNote },
    });
    res.json({ suggestion: updated });
  }),
);

/**
 * Valide une suggestion : crée le vrai enregistrement, avec les valeurs éventuellement
 * corrigées par l'utilisateur (body) plutôt que l'extraction brute — jamais l'inverse.
 */
mailSuggestionsRouter.post(
  '/:id/apply',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const s = await prisma.mailSuggestion.findUnique({ where: { id: req.params.id } });
    if (!s || !s.kind) throw new HttpError(404, 'Suggestion introuvable');
    if (s.status === 'applied') throw new HttpError(409, 'Déjà validée');
    const extracted = (s.extracted as unknown as MailExtraction | null) ?? null;
    const b = req.body as Record<string, unknown>;
    let resultRef: string | null = null;

    if (s.kind === 'lead') {
      const fromEmailMatch = (s.fromAddress ?? '').match(/<([^>]+)>/);
      const fromEmail = fromEmailMatch ? fromEmailMatch[1] : ((s.fromAddress ?? '').includes('@') ? s.fromAddress : null);
      const contact = fromEmail ? await prisma.contact.findFirst({ where: { email: fromEmail } }) : null;
      const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : (s.summary ?? `Demande reçue par mail — ${extracted?.requesterName ?? s.fromAddress}`).slice(0, 120);
      const opp = await prisma.crmOpportunity.create({
        data: {
          title,
          stage: 'new',
          source: 'email-ia',
          contactId: contact?.id ?? null,
          problemType: typeof b.problemType === 'string' ? b.problemType : extracted?.problemType ?? null,
          urgent: typeof b.urgent === 'boolean' ? b.urgent : !!extracted?.urgent,
          urgency: (typeof b.urgent === 'boolean' ? b.urgent : extracted?.urgent) ? 'urgent' : null,
          onSiteContactName: typeof b.requesterName === 'string' ? b.requesterName : extracted?.requesterName ?? null,
          onSiteContactPhone: typeof b.requesterPhone === 'string' ? b.requesterPhone : extracted?.requesterPhone ?? null,
          accessNotes: typeof b.note === 'string' ? b.note : null,
          ownerId: req.user!.id,
          note: `📧 Piste créée depuis un mail (validée manuellement).\nDe : ${s.fromAddress}\nSujet : ${s.subject}${fromEmail && !contact ? `\n(aucun contact existant avec l'adresse ${fromEmail})` : ''}`,
        },
      });
      resultRef = opp.id;
    } else if (s.kind === 'appointment') {
      const worksiteId = typeof b.worksiteId === 'string' && b.worksiteId ? b.worksiteId : s.worksiteId;
      if (!worksiteId) throw new HttpError(422, 'Choisis le chantier concerné par ce rendez-vous.');
      const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { id: true } });
      if (!ws) throw new HttpError(422, 'Chantier introuvable.');
      const startAt = new Date(typeof b.startAt === 'string' ? b.startAt : extracted?.proposedDate ?? Date.now());
      if (Number.isNaN(startAt.getTime())) throw new HttpError(422, 'Date de rendez-vous invalide.');
      const durationMin = typeof b.durationMin === 'number' && b.durationMin > 0 ? b.durationMin : 60;
      const endAt = new Date(startAt.getTime() + durationMin * 60000);
      const ev = await prisma.planningEvent.create({
        data: {
          worksiteId,
          title: typeof b.title === 'string' && b.title.trim() ? b.title.trim() : (s.summary ?? 'Rendez-vous').slice(0, 120),
          startAt, endAt,
          status: 'tentative', // "à confirmer" — proposé par l'IA, pas encore un créneau garanti
          kind: 'meeting',
          meetingOnSite: true,
          note: `📧 Proposé depuis un mail — à confirmer.\nDe : ${s.fromAddress}\nSujet : ${s.subject}${typeof b.note === 'string' && b.note ? `\n${b.note}` : ''}`,
          createdById: req.user!.id,
        },
      });
      resultRef = ev.id;
    } else if (s.kind === 'worksite_note') {
      const worksiteId = typeof b.worksiteId === 'string' && b.worksiteId ? b.worksiteId : s.worksiteId;
      if (!worksiteId) throw new HttpError(422, 'Choisis le chantier concerné par cette note.');
      const ws = await prisma.worksite.findUnique({ where: { id: worksiteId }, select: { id: true } });
      if (!ws) throw new HttpError(422, 'Chantier introuvable.');
      const thread = await prisma.thread.upsert({ where: { worksiteId }, create: { worksiteId }, update: {} });
      const body = (typeof b.body === 'string' && b.body.trim() ? b.body.trim() : s.summary ?? '').slice(0, 4000);
      if (!body) throw new HttpError(422, 'Note vide.');
      const u = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { person: true } });
      const authorName = u?.person?.displayName || u?.person?.firstName || u?.email || 'JJD App';
      const msg = await prisma.message.create({
        data: {
          threadId: thread.id, authorId: req.user!.id, authorName, kind: 'text', audience: 'internal',
          body: `📧 ${body}\n(depuis un mail — ${s.fromAddress}, sujet : ${s.subject})`,
        },
      });
      resultRef = msg.id;
    }
    // payment_reminder / other : pas de cible de création dédiée — valider = "pris en compte"

    const updated = await prisma.mailSuggestion.update({
      where: { id: s.id },
      data: { status: 'applied', resultRef, worksiteId: (typeof b.worksiteId === 'string' && b.worksiteId) ? b.worksiteId : s.worksiteId },
    });
    res.json({ suggestion: updated, resultRef });
  }),
);
