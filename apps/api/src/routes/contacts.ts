import { Router } from 'express';
import { contactInput, contactPersonInput, normalizeName, round2 } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE, hashPassword } from '../lib/auth.js';
import { lookupBelgianVat } from '../lib/vies.js';

const isPaidStr = (s: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim() === 'paye';

export const contactsRouter = Router();

/** Un contact de catégorie "Syndic" doit être relié à une fiche `Syndic` — la table à part
 *  qui alimente le sélecteur de syndic d'une ACP (`/api/meta/syndics`) et l'accès portail
 *  syndic (`syndicId` sur `User`). Sans ce lien, un syndic fraîchement créé reste invisible
 *  partout où on choisit un syndic, même s'il apparaît bien dans la liste des contacts.
 *  Retrouve une fiche `Syndic` existante du même nom (pour ne pas dupliquer un syndic déjà
 *  connu, p.ex. importé du fichier Excel) ou en crée une. */
async function linkSyndic(name: string): Promise<string> {
  const normalized = normalizeName(name);
  const existing = await prisma.syndic.findFirst({ where: { normalizedName: normalized } });
  if (existing) return existing.id;
  const created = await prisma.syndic.create({ data: { name: name.trim(), normalizedName: normalized } });
  return created.id;
}

/** L'API expose l'auto-référence `linkedAcpId`/`linkedAcp` (l'ACP à laquelle CE contact est
 *  rattaché) sous le nom `buildingId`/`building`, conservé pour la compatibilité avec les
 *  clients existants (web/mobile). */
function shapeContact<T extends { linkedAcpId?: string | null; linkedAcp?: unknown }>(c: T) {
  const { linkedAcpId, linkedAcp, ...rest } = c;
  return { ...rest, buildingId: linkedAcpId, ...(linkedAcp !== undefined ? { building: linkedAcp } : {}) };
}

/** Recherche une entreprise par n° de TVA (VIES) pour préremplir un nouveau contact. */
contactsRouter.get(
  '/vat-lookup',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const vat = String(req.query.vat ?? '').trim();
    if (!vat) throw new HttpError(422, 'N° de TVA requis');
    const result = await lookupBelgianVat(vat);
    if ('error' in result) throw new HttpError(422, result.error);
    res.json(result);
  }),
);

contactsRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { type, kind, q, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type && type !== 'all') where.OR = [{ type }, { type: 'both' }];
    if (kind) where.kind = { in: kind.split(',') };
    if (q) {
      where.AND = [{ OR: [{ name: { contains: q } }, { city: { contains: q } }, { vat: { contains: q } }] }];
    }
    // pagination facultative (page absent = tout charger, utilisé par l'appli mobile)
    const paginated = pageStr !== undefined;
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = paginated ? Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100)) : 5000;
    const [items, totalCount] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: paginated ? (page - 1) * pageSize : 0,
        take: pageSize,
        include: {
          syndic: { select: { id: true, name: true } },
          linkedAcp: { select: { id: true, name: true } },
          _count: { select: { worksites: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);
    res.json({
      items: items.map(shapeContact),
      page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    });
  }),
);

contactsRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const found = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        syndic: true,
        linkedAcp: { select: { id: true, name: true } },
        worksites: { orderBy: { updatedAt: 'desc' }, take: 50 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 20 },
        user: { select: { email: true } },
        contactPersons: { orderBy: { position: 'asc' } },
      },
    });
    if (!found) throw new HttpError(404, 'Contact introuvable');
    const contact = shapeContact(found);

    // Achats : tout l'historique (achats + notes de crédit) — sert au résumé, à la liste
    // récente affichée et au solde du compte (« en compte » chez le fournisseur : les
    // notes de crédit viennent en déduction des factures, pas payées une à une).
    const ledger = await prisma.ledgerEntry.findMany({
      where: { contactId: contact.id, direction: { in: ['purchase', 'credit_note'] }, source: { not: 'demo' } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 20000,
      select: {
        id: true, date: true, docNumber: true, categoryRaw: true, ht: true, ttc: true,
        direction: true, paymentStatus: true, pdfPath: true, worksite: { select: { ref: true, title: true } },
      },
    });

    let purchaseHt = 0, purchaseTtc = 0, balance = 0;
    const balanceLedger: { id: string; date: Date | null; docNumber: string | null; direction: string; ht: number; ttc: number; balance: number }[] = [];
    for (const e of ledger) {
      const ttc = e.ttc ?? e.ht ?? 0;
      if (e.direction === 'credit_note') {
        purchaseHt -= e.ht ?? 0;
        purchaseTtc -= ttc;
        balance -= ttc;
        balanceLedger.push({ id: e.id, date: e.date, docNumber: e.docNumber, direction: e.direction, ht: -(e.ht ?? 0), ttc: -ttc, balance: round2(balance) });
      } else {
        purchaseHt += e.ht ?? 0;
        purchaseTtc += ttc;
        // solde ouvert : une facture déjà marquée payée ne pèse plus dans le compte,
        // une note de crédit reste toujours en déduction (elle n'est jamais "payée")
        if (!isPaidStr(e.paymentStatus)) {
          balance += ttc;
          balanceLedger.push({ id: e.id, date: e.date, docNumber: e.docNumber, direction: e.direction, ht: e.ht ?? 0, ttc, balance: round2(balance) });
        }
      }
    }

    res.json({
      contact: {
        ...contact,
        purchases: [...ledger].reverse().map((p) => ({ ...p, paid: isPaidStr(p.paymentStatus), hasPdf: !!p.pdfPath })),
        purchaseBalance: [...balanceLedger].reverse(),
        purchaseSummary: {
          count: ledger.length,
          ht: round2(purchaseHt),
          ttc: round2(purchaseTtc),
          balance: round2(balance),
        },
      },
    });
  }),
);

contactsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { buildingId, ...data } = contactInput.parse(req.body);
    const syndicId = data.kind === 'syndic' && !data.syndicId ? await linkSyndic(data.name) : data.syndicId ?? null;
    const contact = await prisma.contact.create({
      data: {
        ...data,
        email: data.email || null,
        normalizedName: normalizeName(data.name),
        syndicId,
        linkedAcpId: buildingId ?? null,
        source: 'manual',
      },
    });
    res.status(201).json({ contact: shapeContact(contact) });
  }),
);

/** Ouvre un accès au portail client pour ce contact (connexion par lien magique). */
contactsRouter.post(
  '/:id/portal-access',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const contact = await prisma.contact.findUnique({ where: { id: req.params.id }, include: { user: true, syndic: true } });
    if (!contact) throw new HttpError(404, 'Contact introuvable');
    if (contact.user) throw new HttpError(409, 'Un accès existe déjà');
    const email = String(req.body.email ?? contact.email ?? '').trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new HttpError(422, 'E-mail requis');
    if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'Cet e-mail est déjà utilisé');

    // si le contact EST un syndic -> accès syndic (voit tous ses immeubles)
    const asSyndic = contact.kind === 'syndic' && contact.syndicId;
    const access = req.body.access === 'limited' ? 'limited' : 'full';
    const residentOfId = typeof req.body.buildingId === 'string' && req.body.buildingId ? req.body.buildingId : null;
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(Math.random().toString(36).slice(2)),
        role: 'client',
        contactId: asSyndic || residentOfId ? null : contact.id,
        syndicId: asSyndic ? contact.syndicId : null,
        residentOfId,
        portalAccess: asSyndic ? 'full' : access,
      },
    });
    res.status(201).json({ email, portal: `${req.protocol}://${req.get('host')?.replace(/:\d+$/, ':3100') ?? ''}/portail` });
  }),
);

contactsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { buildingId, ...data } = contactInput.partial().parse(req.body);
    const existing = await prisma.contact.findUnique({ where: { id: req.params.id }, select: { kind: true, syndicId: true, name: true } });
    if (!existing) throw new HttpError(404, 'Contact introuvable');
    const kind = data.kind ?? existing.kind;
    let syndicId = data.syndicId;
    if (kind === 'syndic' && !existing.syndicId && syndicId === undefined) {
      syndicId = await linkSyndic(data.name ?? existing.name);
    }
    // garde le nom de la fiche Syndic à jour (c'est lui qui s'affiche dans le sélecteur de
    // syndic d'une ACP), sans jamais créer de lien qui n'existait pas déjà
    const linkedSyndicId = syndicId ?? existing.syndicId;
    if (kind === 'syndic' && linkedSyndicId && data.name) {
      await prisma.syndic.update({ where: { id: linkedSyndicId }, data: { name: data.name.trim(), normalizedName: normalizeName(data.name) } });
    }
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
        ...(data.name ? { normalizedName: normalizeName(data.name) } : {}),
        ...(buildingId !== undefined ? { linkedAcpId: buildingId } : {}),
        ...(syndicId !== undefined ? { syndicId } : {}),
      },
    });
    res.json({ contact: shapeContact(contact) });
  }),
);

/** Supprime un contact — refusé (409) s'il est encore lié à un chantier, un immeuble, une
 *  opportunité, un devis/facture ou un achat/vente, pour ne jamais faire disparaître silencieusement
 *  des données commerciales/comptables. Un compte portail lié est supprimé avec le contact
 *  (accès, pas donnée métier). */
contactsRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const [worksites, acpWorksites, opportunities, acpOpportunities, documents, ledgerEntries, buildingContacts, buildingUnits, residents, portalUsers] = await Promise.all([
      prisma.worksite.count({ where: { clientId: id } }),
      prisma.worksite.count({ where: { acpId: id } }),
      prisma.crmOpportunity.count({ where: { contactId: id } }),
      prisma.crmOpportunity.count({ where: { acpId: id } }),
      prisma.document.count({ where: { contactId: id } }),
      prisma.ledgerEntry.count({ where: { contactId: id } }),
      prisma.buildingContact.count({ where: { contactId: id } }),
      prisma.buildingUnit.count({ where: { contactId: id } }),
      prisma.contact.count({ where: { linkedAcpId: id } }),
      prisma.user.count({ where: { residentOfId: id } }),
    ]);
    const refs = worksites + acpWorksites + opportunities + acpOpportunities + documents + ledgerEntries + buildingContacts + buildingUnits + residents + portalUsers;
    if (refs > 0) {
      throw new HttpError(409, `Ce contact est encore lié à des données (${refs} référence${refs > 1 ? 's' : ''} : chantiers, opportunités, devis/factures, achats, résidents, comptes portail…) — impossible de le supprimer.`);
    }
    await prisma.user.deleteMany({ where: { contactId: id } });
    await prisma.contact.delete({ where: { id } });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------ Personnes de contact */

contactsRouter.post(
  '/:id/persons',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = contactPersonInput.parse(req.body);
    const count = await prisma.contactPerson.count({ where: { contactId: req.params.id } });
    const person = await prisma.contactPerson.create({
      data: { contactId: req.params.id as string, role: data.role ?? null, name: data.name, email: data.email || null, phone: data.phone ?? null, position: count },
    });
    res.status(201).json({ person });
  }),
);

contactsRouter.patch(
  '/:id/persons/:pid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = contactPersonInput.partial().parse(req.body);
    const person = await prisma.contactPerson.update({
      where: { id: req.params.pid },
      data: { ...data, email: data.email === undefined ? undefined : data.email || null },
    });
    res.json({ person });
  }),
);

contactsRouter.delete(
  '/:id/persons/:pid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.contactPerson.delete({ where: { id: req.params.pid } });
    res.json({ ok: true });
  }),
);
