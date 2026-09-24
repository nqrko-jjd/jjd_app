import { Router } from 'express';
import { buildingInput, buildingContactInput, buildingUnitInput, normalizeName } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE, hashPassword } from '../lib/auth.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';
import { withQuotedFromDocuments } from '../lib/worksite-margin.js';

export const buildingsRouter = Router();

const ACP_KINDS = ['acp', 'developer'];

attachPhotoRoutes(buildingsRouter, (id, data) => prisma.contact.update({ where: { id }, data }));

buildingsRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { q, syndicId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { kind: { in: ACP_KINDS } };
    if (syndicId) where.syndicId = syndicId;
    if (q) where.OR = [{ name: { contains: q } }, { city: { contains: q } }];
    const items = await prisma.contact.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        syndic: { select: { id: true, name: true } },
        _count: { select: { acpWorksites: true, acpUnits: true } },
      },
      take: 5000,
    });
    res.json({ items: items.map((b) => ({ ...b, _count: { worksites: b._count.acpWorksites, units: b._count.acpUnits } })) });
  }),
);

buildingsRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const building = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        syndic: true,
        acpKeyContacts: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { contact: { select: { id: true, name: true } } } },
        residents: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, type: true, kind: true, phone: true, email: true },
        },
        acpUnits: {
          orderBy: [{ position: 'asc' }, { label: 'asc' }],
          include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
        },
        acpWorksites: {
          orderBy: { updatedAt: 'desc' },
          include: {
            manager: { select: { firstName: true, displayName: true } },
            documents: { where: { number: { not: null } }, select: { id: true, kind: true, number: true, status: true, totalTtc: true, issuedOn: true } },
          },
        },
      },
    });
    if (!building || !ACP_KINDS.includes(building.kind ?? '')) throw new HttpError(404, 'Immeuble introuvable');
    const { acpKeyContacts, acpUnits, acpWorksites, residents, ...rest } = building;
    res.json({ building: { ...rest, contacts: acpKeyContacts, units: acpUnits, worksites: await withQuotedFromDocuments(acpWorksites), linkedContacts: residents } });
  }),
);

buildingsRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingInput.parse(req.body);
    const building = await prisma.contact.create({
      data: {
        ...data,
        type: 'client',
        normalizedName: normalizeName(data.name),
        syndicId: data.syndicId ?? null,
        lotCount: data.lotCount ?? null,
        source: 'manual',
      },
    });
    res.status(201).json({ building });
  }),
);

buildingsRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingInput.partial().parse(req.body);
    const building = await prisma.contact.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(data.name ? { normalizedName: normalizeName(data.name) } : {}),
      },
    });
    res.json({ building });
  }),
);

/** Les contacts-clés et lots de l'immeuble sont supprimés en cascade avec lui (métadonnées
 *  propres au bâtiment) — mais tant que des chantiers, opportunités, résidents liés ou
 *  comptes portail « résident » y font encore référence, la suppression est bloquée. */
buildingsRouter.delete(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const [worksites, opportunities, documents, ledgerEntries, residents, portalUsers] = await Promise.all([
      prisma.worksite.count({ where: { OR: [{ clientId: id }, { acpId: id }] } }),
      prisma.crmOpportunity.count({ where: { OR: [{ contactId: id }, { acpId: id }] } }),
      prisma.document.count({ where: { contactId: id } }),
      prisma.ledgerEntry.count({ where: { contactId: id } }),
      prisma.contact.count({ where: { linkedAcpId: id } }),
      prisma.user.count({ where: { residentOfId: id } }),
    ]);
    const refs = worksites + opportunities + documents + ledgerEntries + residents + portalUsers;
    if (refs > 0) {
      throw new HttpError(409, `Cet immeuble est encore lié à des données (${refs} référence${refs > 1 ? 's' : ''} : chantiers, opportunités, devis/factures, achats, résidents, comptes portail…) — impossible de le supprimer.`);
    }
    await prisma.user.deleteMany({ where: { contactId: id } });
    await prisma.contact.delete({ where: { id } });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------ Accès portail (résidents) */

buildingsRouter.get(
  '/:id/portal-users',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { residentOfId: req.params.id, role: 'client' },
      select: { id: true, email: true, portalAccess: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users });
  }),
);

buildingsRouter.post(
  '/:id/portal-access',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const building = await prisma.contact.findUnique({ where: { id: req.params.id } });
    if (!building) throw new HttpError(404, 'Immeuble introuvable');
    const email = String(req.body.email ?? '').trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new HttpError(422, 'E-mail requis');
    if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'Cet e-mail est déjà utilisé');
    const access = req.body.access === 'full' ? 'full' : 'limited';
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(Math.random().toString(36).slice(2)),
        role: 'client',
        residentOfId: building.id,
        portalAccess: access,
      },
    });
    res.status(201).json({ email, access });
  }),
);

buildingsRouter.delete(
  '/:id/portal-access/:userId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.user.deleteMany({ where: { id: req.params.userId, residentOfId: req.params.id } });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------ Contacts clés */

buildingsRouter.post(
  '/:id/contacts',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingContactInput.parse(req.body);
    const count = await prisma.buildingContact.count({ where: { acpId: req.params.id } });
    const contact = await prisma.buildingContact.create({
      data: {
        acpId: req.params.id as string,
        role: data.role,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email || null,
        note: data.note ?? null,
        contactId: data.contactId ?? null,
        position: count,
      },
    });
    res.status(201).json({ contact });
  }),
);

buildingsRouter.patch(
  '/:id/contacts/:cid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingContactInput.partial().parse(req.body);
    const contact = await prisma.buildingContact.update({
      where: { id: req.params.cid },
      data: { ...data, email: data.email === undefined ? undefined : data.email || null },
    });
    res.json({ contact });
  }),
);

buildingsRouter.delete(
  '/:id/contacts/:cid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.buildingContact.delete({ where: { id: req.params.cid } });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------ Lots & occupants */

buildingsRouter.post(
  '/:id/units',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingUnitInput.parse(req.body);
    const count = await prisma.buildingUnit.count({ where: { acpId: req.params.id } });
    const unit = await prisma.buildingUnit.create({
      data: {
        acpId: req.params.id as string,
        label: data.label,
        floor: data.floor ?? null,
        door: data.door ?? null,
        contactId: data.contactId ?? null,
        occupantName: data.occupantName ?? null,
        occupantPhone: data.occupantPhone ?? null,
        occupantEmail: data.occupantEmail || null,
        occupantKind: data.occupantKind ?? null,
        note: data.note ?? null,
        position: count,
      },
    });
    res.status(201).json({ unit });
  }),
);

buildingsRouter.patch(
  '/:id/units/:uid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = buildingUnitInput.partial().parse(req.body);
    const unit = await prisma.buildingUnit.update({
      where: { id: req.params.uid },
      data: { ...data, occupantEmail: data.occupantEmail === undefined ? undefined : data.occupantEmail || null },
    });
    res.json({ unit });
  }),
);

buildingsRouter.delete(
  '/:id/units/:uid',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.buildingUnit.delete({ where: { id: req.params.uid } });
    res.json({ ok: true });
  }),
);
