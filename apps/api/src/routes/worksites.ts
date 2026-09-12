import { Router } from 'express';
import multer from 'multer';
import {
  worksiteInput, WORKSITE_STATUSES, WORKSITE_STATUS_LABEL, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL,
  ENTITIES, ENTITY_LABEL, parseLooseDate,
} from '@jjd/shared';
import { prisma, nextWorksiteRef } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE } from '../lib/auth.js';
import { worksiteMargin } from '../lib/worksite-margin.js';
import { geocode } from '../lib/geocode.js';
import { syncChantierSafe } from '../lib/bricoloc.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function reverseLabel<K extends string>(labels: Record<K, string>, needle: string): K | undefined {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  const n = norm(needle);
  return (Object.keys(labels) as K[]).find((k) => norm(labels[k]) === n);
}

/** Recharge le chantier avec le client et pousse la synchro parc Bricoloc (non bloquant). */
async function pushBricoloc(id: string) {
  const ws = await prisma.worksite.findUnique({
    where: { id },
    select: {
      id: true,
      ref: true,
      title: true,
      address: true,
      postalCode: true,
      city: true,
      status: true,
      archived: true,
      client: { select: { name: true } },
    },
  });
  if (ws) syncChantierSafe(ws);
}

export const worksitesRouter = Router();

worksitesRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { status, entity, q, archived, kind, page: pageStr, pageSize: pageSizeStr } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { archived: archived === '1' ? true : false, kind: kind || 'project' };
    if (status) where.status = status;
    if (entity) where.entity = entity;
    if (q) {
      where.OR = [
        { ref: { contains: q } },
        { title: { contains: q } },
        { city: { contains: q } },
      ];
    }
    // pagination facultative (page absent = comportement historique « tout charger », utilisé par
    // le picker de planning et l'appli mobile) ; la page « Chantiers » du web l'active en passant page=.
    const paginated = pageStr !== undefined;
    const page = Math.max(1, Math.trunc(Number(pageStr)) || 1);
    const pageSize = paginated ? Math.min(5000, Math.max(20, Math.trunc(Number(pageSizeStr)) || 100)) : 5000;
    const [items, totalCount] = await Promise.all([
      prisma.worksite.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: paginated ? (page - 1) * pageSize : 0,
        take: pageSize,
        include: {
          client: { select: { id: true, name: true } },
          building: { select: { id: true, name: true } },
          manager: { select: { id: true, displayName: true, firstName: true } },
        },
      }),
      prisma.worksite.count({ where }),
    ]);
    res.json({ items, page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) });
  }),
);

/** Chantiers où la personne connectée a travaillé (pointage ou affectation planning). */
worksitesRouter.get(
  '/mine',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const personId = req.user!.personId;
    const { q } = req.query as Record<string, string>;
    if (!personId) return res.json({ items: [] });
    const where: Record<string, unknown> = {
      OR: [
        { timeEntries: { some: { personId } } },
        { events: { some: { assignments: { some: { personId } } } } },
      ],
    };
    if (q) {
      where.AND = [{ OR: [{ ref: { contains: q } }, { title: { contains: q } }, { city: { contains: q } }] }];
    }
    const items = await prisma.worksite.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        client: { select: { name: true } },
        building: { select: { name: true } },
      },
    });
    res.json({ items });
  }),
);

/* --------------------------------------------------------- export/import Excel */

const WORKSITE_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'ref', label: 'Réf' },
  { key: 'title', label: 'Chantier' },
  { key: 'status', label: 'Statut' },
  { key: 'priority', label: 'Priorité' },
  { key: 'entity', label: 'Entité' },
  { key: 'client', label: 'Client' },
  { key: 'manager', label: 'Chef de chantier' },
  { key: 'city', label: 'Ville' },
  { key: 'quotedHt', label: 'Devisé HT' },
  { key: 'startedOn', label: 'Début' },
  { key: 'endedOn', label: 'Fin' },
];

/** Export en CSV (éditable dans Excel) — respecte les mêmes filtres que la liste. */
worksitesRouter.get(
  '/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { status, entity, q, archived, kind } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { archived: archived === '1' ? true : false, kind: kind || 'project' };
    if (status) where.status = status;
    if (entity) where.entity = entity;
    if (q) where.OR = [{ ref: { contains: q } }, { title: { contains: q } }, { city: { contains: q } }];
    const items = await prisma.worksite.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 5000,
      include: {
        client: { select: { name: true } },
        manager: { select: { displayName: true, firstName: true } },
      },
    });
    const rows = items.map((w) => ({
      id: w.id,
      ref: w.ref,
      title: w.title,
      status: WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status,
      priority: WORKSITE_PRIORITY_LABEL[w.priority as keyof typeof WORKSITE_PRIORITY_LABEL] ?? w.priority,
      entity: ENTITY_LABEL[w.entity as keyof typeof ENTITY_LABEL] ?? w.entity,
      client: w.client?.name ?? '',
      manager: w.manager?.displayName || w.manager?.firstName || '',
      city: w.city ?? '',
      quotedHt: w.quotedHt,
      startedOn: w.startedOn,
      endedOn: w.endedOn,
    }));
    const csv = toCsv(WORKSITE_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chantiers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

/**
 * Réimporte un fichier (précédemment exporté, corrigé en masse dans Excel — notamment pour
 * corriger des statuts en lot). Une ligne avec un `id` connu met à jour le chantier ; une
 * ligne sans `id` (ou inconnu) n'est PAS créée (contrairement aux achats/ventes) — un chantier
 * a un cycle de création propre (référence auto-générée, etc.), l'import sert ici uniquement
 * à corriger l'existant en masse. Une ligne absente du fichier n'est jamais supprimée.
 */
worksitesRouter.post(
  '/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const rows = readTableBuffer(req.file.buffer, req.file.originalname);
    if (rows.length > 5000) throw new HttpError(422, 'Trop de lignes (5000 max)');

    let updated = 0;
    let skipped = 0;
    const warnings: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2; // 1 = en-tête
      const id = pick(row, 'id');
      if (!id) { warnings.push({ row: rowNum, message: 'id manquant — ligne ignorée (l’import ne crée pas de nouveaux chantiers)' }); skipped++; continue; }
      const existing = await prisma.worksite.findUnique({ where: { id } });
      if (!existing) { warnings.push({ row: rowNum, message: `id « ${id} » introuvable — ligne ignorée` }); skipped++; continue; }

      const data: Record<string, unknown> = {};

      const statusLabel = pick(row, 'statut', 'status');
      if (statusLabel) {
        const code = reverseLabel(WORKSITE_STATUS_LABEL, statusLabel);
        if (code) data.status = code;
        else warnings.push({ row: rowNum, message: `Statut « ${statusLabel} » inconnu — non modifié` });
      }
      const priorityLabel = pick(row, 'priorite', 'priorité', 'priority');
      if (priorityLabel) {
        const code = reverseLabel(WORKSITE_PRIORITY_LABEL, priorityLabel);
        if (code) data.priority = code;
        else warnings.push({ row: rowNum, message: `Priorité « ${priorityLabel} » inconnue — non modifiée` });
      }
      const entityLabel = pick(row, 'entite', 'entité', 'entity');
      if (entityLabel) {
        const code = reverseLabel(ENTITY_LABEL, entityLabel);
        if (code && (ENTITIES as readonly string[]).includes(code)) data.entity = code;
        else warnings.push({ row: rowNum, message: `Entité « ${entityLabel} » inconnue — non modifiée` });
      }
      const clientName = pick(row, 'client');
      if (clientName) {
        const c = await prisma.contact.findFirst({ where: { name: { equals: clientName }, type: { in: ['client', 'both'] } } });
        if (c) data.clientId = c.id;
        else warnings.push({ row: rowNum, message: `Client « ${clientName} » introuvable — non modifié` });
      }
      const managerName = pick(row, 'chef de chantier', 'chef', 'manager');
      if (managerName) {
        const people = await prisma.person.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true, displayName: true } });
        const p = people.find((x) => (x.displayName || `${x.firstName} ${x.lastName ?? ''}`.trim()).toLowerCase() === managerName.toLowerCase());
        if (p) data.managerId = p.id;
        else warnings.push({ row: rowNum, message: `Chef de chantier « ${managerName} » introuvable — non modifié` });
      }
      const title = pick(row, 'chantier', 'title');
      if (title) data.title = title;
      const city = pick(row, 'ville', 'city');
      if (city) data.city = city;
      const quotedHt = pick(row, 'devise ht', 'devisé ht', 'quotedht');
      if (quotedHt) data.quotedHt = Number(quotedHt.replace(',', '.')) || null;
      const startedOn = pick(row, 'debut', 'début', 'startedon');
      if (startedOn) data.startedOn = parseLooseDate(startedOn);
      const endedOn = pick(row, 'fin', 'endedon');
      if (endedOn) data.endedOn = parseLooseDate(endedOn);

      if (Object.keys(data).length) {
        await prisma.worksite.update({ where: { id }, data });
        updated++;
      } else {
        skipped++;
      }
    }

    res.json({ created: 0, updated, skipped, warnings });
  }),
);

worksitesRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const ws = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        building: { include: { syndic: true } },
        manager: true,
        documents: { orderBy: { issuedOn: 'desc' } },
        events: { orderBy: { startAt: 'desc' }, take: 20, include: { assignments: { include: { person: true } }, vehicle: true } },
        reports: { orderBy: { date: 'desc' }, include: { photos: true, author: { select: { email: true } } } },
      },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    // Les ouvriers ont leur propre vue (tâches + fil de chantier, /:id/field) — pas les
    // devis/factures ni la rentabilité si jamais ils atterrissent quand même sur cette route.
    const isWorker = req.user!.role === 'worker';
    const margin = isWorker ? null : await worksiteMargin(ws.id);
    res.json({ worksite: isWorker ? { ...ws, documents: [] } : ws, margin });
  }),
);

/** Briefing terrain : adresse, à faire, équipe, matériel, contact sur place. */
worksitesRouter.get(
  '/:id/field',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const ws = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: {
        client: { select: { name: true, phone: true } },
        building: {
          select: {
            name: true, address: true, postalCode: true, city: true, digicode: true, accessNote: true,
            contacts: { orderBy: { position: 'asc' }, select: { role: true, name: true, phone: true } },
          },
        },
        manager: { select: { displayName: true, firstName: true, phone: true } },
      },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');

    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d1 = new Date(d0); d1.setDate(d1.getDate() + 7);
    const ev = await prisma.planningEvent.findFirst({
      where: { worksiteId: ws.id, startAt: { gte: d0, lt: d1 } },
      orderBy: { startAt: 'asc' },
      include: {
        assignments: { include: { person: { select: { displayName: true, firstName: true, phone: true, user: { select: { id: true } } } } } },
        vehicles: { include: { vehicle: { select: { code: true, brand: true, model: true, plate: true } } } },
        team: { select: { name: true } },
        equipment: { include: { equipment: { select: { name: true, reference: true } } } },
        consumables: { include: { consumable: { select: { name: true, unit: true } } } },
      },
    });

    const addr = [ws.address ?? ws.building?.address, [ws.postalCode ?? ws.building?.postalCode, ws.city ?? ws.building?.city].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');

    res.json({
      worksite: { id: ws.id, ref: ws.ref, title: ws.title, status: ws.status, description: ws.description, address: addr },
      building: ws.building
        ? {
            name: ws.building.name, digicode: ws.building.digicode, accessNote: ws.building.accessNote,
            contacts: ws.building.contacts,
          }
        : null,
      client: ws.client,
      manager: ws.manager ? { name: ws.manager.displayName || ws.manager.firstName, phone: ws.manager.phone } : null,
      owner: ws.ownerName ? { name: ws.ownerName, phone: ws.ownerPhone, email: ws.ownerEmail } : null,
      tenant: ws.tenantName ? { name: ws.tenantName, phone: ws.tenantPhone, phone2: ws.tenantPhone2, email: ws.tenantEmail } : null,
      today: ev
        ? {
            date: ev.startAt, startAt: ev.startAt, endAt: ev.endAt, allDay: ev.allDay,
            toDo: ev.note, materials: ev.materialsNote,
            team: ev.team?.name ?? null,
            vehicle: ev.vehicles.length
              ? ev.vehicles.map((v) => `${v.vehicle.code ?? ''} ${v.vehicle.brand ?? ''} ${v.vehicle.model ?? ''}`.trim()).join(', ')
              : null,
            people: ev.assignments.map((a) => ({ userId: a.person.user?.id ?? null, name: a.person.displayName || a.person.firstName, phone: a.person.phone })),
            equipment: ev.equipment.map((e) => ({ name: e.equipment.name, reference: e.equipment.reference })),
            consumables: ev.consumables.map((c) => ({ name: c.consumable.name, qty: c.qty, unit: c.consumable.unit })),
          }
        : null,
    });
  }),
);

worksitesRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = worksiteInput.parse(req.body);
    const ref = await nextWorksiteRef();
    const ws = await prisma.worksite.create({
      data: {
        ref,
        title: data.title,
        entity: data.entity,
        status: data.status,
        priority: data.priority,
        statusTags: data.statusTags,
        clientId: data.clientId ?? null,
        buildingId: data.buildingId ?? null,
        managerId: data.managerId ?? null,
        address: data.address ?? null,
        postalCode: data.postalCode ?? null,
        city: data.city ?? null,
        startedOn: data.startedOn ?? null,
        endedOn: data.endedOn ?? null,
        quotedHt: data.quotedHt ?? null,
        description: data.description ?? null,
        source: 'manual',
      },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'create', entity: 'worksite', entityId: ws.id },
    });
    void pushBricoloc(ws.id);
    res.status(201).json({ worksite: ws });
  }),
);

/** Point GPS de référence du chantier (pour le contrôle de pointage). */
worksitesRouter.patch(
  '/:id/geo',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { lat, lng, clear } = req.body as { lat?: number; lng?: number; clear?: boolean };
    const data = clear
      ? { lat: null, lng: null, geoSetAt: null }
      : { lat: Number(lat), lng: Number(lng), geoSetAt: new Date() };
    if (!clear && (Number.isNaN(data.lat as number) || Number.isNaN(data.lng as number))) throw new HttpError(422, 'Coordonnées invalides');
    const ws = await prisma.worksite.update({ where: { id: req.params.id }, data });
    res.json({ lat: ws.lat, lng: ws.lng, geoSetAt: ws.geoSetAt });
  }),
);

/** Géocode l'adresse du chantier (OpenStreetMap / Nominatim) -> fixe le point GPS. */
worksitesRouter.post(
  '/:id/geocode',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const ws = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: { building: { select: { address: true, postalCode: true, city: true } } },
    });
    if (!ws) throw new HttpError(404, 'Chantier introuvable');
    const q = [
      req.body?.address || ws.address || ws.building?.address,
      [ws.postalCode || ws.building?.postalCode, ws.city || ws.building?.city].filter(Boolean).join(' '),
      'Belgique',
    ].filter(Boolean).join(', ');
    if (!q || q === 'Belgique') throw new HttpError(422, 'Aucune adresse à géocoder');

    const hit = await geocode(q);
    if (!hit) throw new HttpError(404, `Adresse introuvable : ${q}`);

    const updated = await prisma.worksite.update({
      where: { id: ws.id },
      data: { lat: hit.lat, lng: hit.lng, geoSetAt: new Date() },
    });
    res.json({ lat: updated.lat, lng: updated.lng, matched: hit.label, query: q });
  }),
);

worksitesRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = worksiteInput.partial().parse(req.body);
    const ws = await prisma.worksite.update({
      where: { id: req.params.id },
      data: {
        ...data,
        statusTags: data.statusTags ?? undefined,
      },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'update', entity: 'worksite', entityId: ws.id, meta: data },
    });
    void pushBricoloc(ws.id);
    res.json({ worksite: ws });
  }),
);
