import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import multer from 'multer';
import {
  personInput, legalDocInput, personAdjustmentInput, normalizeName, round2,
  PERSON_ROLES, PERSON_ROLE_LABEL, WORKER_CONTRACT_TYPES, WORKER_CONTRACT_LABEL,
} from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, STAFF, OFFICE, hashPassword } from '../lib/auth.js';
import { attachPhotoRoutes } from '../lib/photo-upload.js';
import { storeFile, UPLOADS_DIR } from '../lib/media.js';
import { monthlyStatement, personEarningsSeries, personEarningsBreakdown } from '../lib/statement.js';
import { toCsv, readTableBuffer, pick } from '../lib/table-io.js';

export const peopleRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function resolveUpload(rel: string): string {
  const clean = rel.replace(/^\/?uploads\//, '').replace(/\\/g, '/');
  return path.join(UPLOADS_DIR, path.normalize(clean));
}

attachPhotoRoutes(peopleRouter, (id, data) => prisma.person.update({ where: { id }, data }));

function fullName(p: { firstName: string; lastName?: string | null }) {
  return `${p.firstName} ${p.lastName ?? ''}`.trim();
}

peopleRouter.get(
  '/',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const { role, active, q } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (active === '1') where.active = true;
    if (active === '0') where.active = false;
    if (q) where.OR = [{ firstName: { contains: q } }, { lastName: { contains: q } }, { displayName: { contains: q } }];
    const items = await prisma.person.findMany({
      where,
      orderBy: [{ active: 'desc' }, { firstName: 'asc' }],
      include: { _count: { select: { legalDocs: true, timeEntries: true } } },
    });
    res.json({ items });
  }),
);

const PEOPLE_CSV_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'firstName', label: 'Prénom' },
  { key: 'lastName', label: 'Nom' },
  { key: 'displayName', label: 'Nom affiché' },
  { key: 'role', label: 'Rôle' },
  { key: 'contractType', label: 'Contrat' },
  { key: 'hourlyRate', label: 'Taux horaire' },
  { key: 'dailyHours', label: 'Heures/jour' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Adresse' },
  { key: 'active', label: 'Actif' },
  { key: 'note', label: 'Note' },
];

peopleRouter.get(
  '/export.csv',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { role, active } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (active === '1') where.active = true;
    if (active === '0') where.active = false;
    const items = await prisma.person.findMany({ where, orderBy: [{ active: 'desc' }, { firstName: 'asc' }] });
    const rows = items.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName ?? '',
      displayName: p.displayName ?? '',
      role: PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role,
      contractType: WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? p.contractType,
      hourlyRate: p.hourlyRate,
      dailyHours: p.dailyHours,
      phone: p.phone ?? '',
      email: p.email ?? '',
      address: p.address ?? '',
      active: p.active ? 'Oui' : 'Non',
      note: p.note ?? '',
    }));
    const csv = toCsv(PEOPLE_CSV_COLUMNS, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="equipe-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(Buffer.from(csv, 'utf8'));
  }),
);

peopleRouter.get(
  '/:id',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findUnique({
      where: { id: req.params.id },
      include: {
        legalDocs: { orderBy: { expiresOn: 'asc' } },
        equipment: true,
        user: { select: { id: true, email: true, role: true } },
        adjustments: { orderBy: { date: 'desc' } },
      },
    });
    if (!person) throw new HttpError(404, 'Fiche introuvable');

    // décompte du mois courant (jour presté garanti inclus)
    const now = new Date();
    const s = await monthlyStatement(person.id, now.getFullYear(), now.getMonth() + 1);
    // avances + dettes pas encore réglées -> montant à retenir sur la prochaine paie
    const toWithhold = round2(person.adjustments.filter((a) => !a.settled).reduce((sum, a) => sum + a.amount, 0));
    res.json({
      person,
      monthStatement: {
        hours: s.totalHours, amount: s.totalAmount,
        worksites: s.worksiteCount, guaranteeApplied: s.guaranteeApplied, dailyHours: s.dailyHoursGuarantee,
      },
      adjustmentBalance: toWithhold,
    });
  }),
);

/** Série mensuelle (montant, heures, chantiers) pour le graphique de la fiche. */
peopleRouter.get(
  '/:id/stats',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));
    res.json({ months: await personEarningsSeries(req.params.id!, months) });
  }),
);

/** Revenus tout l'historique : total, par année, par chantier (+ rentabilité du chantier). */
peopleRouter.get(
  '/:id/earnings',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    res.json(await personEarningsBreakdown(req.params.id!));
  }),
);

peopleRouter.post(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personInput.parse(req.body);
    const person = await prisma.person.create({
      data: {
        ...data,
        email: data.email || null,
        displayName: data.displayName || data.firstName,
        normalizedName: normalizeName(fullName(data)),
        languages: data.languages,
        specialties: data.specialties,
        source: 'manual',
      },
    });
    res.status(201).json({ person });
  }),
);

/** Résout un libellé FR ("Ouvrier qualifié") ou une valeur brute ("qualified_worker") vers l'enum. */
function matchEnum<T extends string>(raw: string | null, values: readonly T[], labels: Record<T, string>): T | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  const byLabel = values.find((v) => labels[v].toLowerCase() === norm);
  if (byLabel) return byLabel;
  const byValue = values.find((v) => v.toLowerCase() === norm);
  return byValue ?? null;
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  return /^(oui|yes|true|1|actif)$/i.test(raw.trim());
}

/**
 * Réimporte un fichier (précédemment exporté puis corrigé dans Excel, ou nouveau).
 * Une ligne avec un `id` connu met à jour la fiche ; sans `id` (ou inconnu), une
 * nouvelle fiche est créée. Une ligne absente du fichier n'est jamais supprimée.
 */
peopleRouter.post(
  '/import',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const rows = readTableBuffer(req.file.buffer, req.file.originalname);
    if (rows.length > 5000) throw new HttpError(422, 'Trop de lignes (5000 max)');

    let created = 0;
    let updated = 0;
    const warnings: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNum = i + 2;
      const id = pick(row, 'id');
      const firstName = pick(row, 'prenom', 'prénom', 'firstname');
      if (!id && !firstName) { warnings.push({ row: rowNum, message: 'Prénom manquant — ligne ignorée' }); continue; }

      const role = matchEnum(pick(row, 'role', 'rôle'), PERSON_ROLES, PERSON_ROLE_LABEL);
      const contractType = matchEnum(pick(row, 'contrat', 'contracttype'), WORKER_CONTRACT_TYPES, WORKER_CONTRACT_LABEL);
      const lastName = pick(row, 'nom');
      const displayName = pick(row, 'nom affiche', 'nom affiché', 'displayname');
      const hourlyRate = pick(row, 'taux horaire', 'hourlyrate');
      const dailyHours = pick(row, 'heures/jour', 'heures jour', 'dailyhours');
      const email = pick(row, 'email');

      const data: Record<string, unknown> = {
        ...(firstName ? { firstName } : {}),
        lastName: lastName || null,
        displayName: displayName || firstName || undefined,
        ...(role ? { role } : {}),
        ...(contractType ? { contractType } : {}),
        hourlyRate: hourlyRate ? Number(hourlyRate.replace(',', '.')) : null,
        ...(dailyHours ? { dailyHours: Number(dailyHours.replace(',', '.')) } : {}),
        phone: pick(row, 'telephone', 'téléphone', 'phone') || null,
        email: email || null,
        address: pick(row, 'adresse', 'address') || null,
        active: parseBool(pick(row, 'actif', 'active'), true),
        note: pick(row, 'note') || null,
      };
      if (firstName || lastName) {
        data.normalizedName = normalizeName(`${firstName ?? ''} ${lastName ?? ''}`.trim());
      }

      if (id) {
        const existing = await prisma.person.findUnique({ where: { id } });
        if (existing) {
          await prisma.person.update({ where: { id }, data });
          updated++;
          continue;
        }
        warnings.push({ row: rowNum, message: `id « ${id} » introuvable — ligne créée comme nouvelle fiche` });
      }
      if (!firstName) { warnings.push({ row: rowNum, message: 'Prénom manquant — ligne ignorée' }); continue; }
      await prisma.person.create({ data: { ...data, firstName, source: 'manual' } as Prisma.PersonUncheckedCreateInput });
      created++;
    }

    res.json({ created, updated, warnings });
  }),
);

peopleRouter.patch(
  '/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personInput.partial().parse(req.body);
    const person = await prisma.person.update({
      where: { id: req.params.id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
        languages: data.languages ?? undefined,
        specialties: data.specialties ?? undefined,
      },
    });
    res.json({ person });
  }),
);

/** Crée un compte de connexion pour cette personne (pour l'appli mobile). */
peopleRouter.post(
  '/:id/account',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!person) throw new HttpError(404, 'Fiche introuvable');
    if (person.user) throw new HttpError(409, 'Un compte existe déjà pour cette personne');

    const email = String(req.body.email ?? '').trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new HttpError(422, 'E-mail invalide');
    if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'Cet e-mail est déjà pris');

    const password = req.body.password || Math.random().toString(36).slice(2, 8);
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        role: person.role === 'foreman' ? 'foreman' : 'worker',
        personId: person.id,
      },
    });
    res.status(201).json({ email, password });
  }),
);

peopleRouter.post(
  '/:id/legal-docs',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = legalDocInput.parse({ ...req.body, personId: req.params.id });
    const doc = await prisma.legalDoc.create({ data });
    res.status(201).json({ doc });
  }),
);

peopleRouter.delete(
  '/:id/legal-docs/:docId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.legalDoc.delete({ where: { id: req.params.docId } });
    res.status(204).end();
  }),
);

/** Joint le scan/photo du document (PDF ou image). */
peopleRouter.post(
  '/:id/legal-docs/:docId/file',
  requireAuth(...OFFICE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Aucun fichier');
    const okType = req.file.mimetype === 'application/pdf' || /^image\/(jpe?g|png|webp|heic)$/.test(req.file.mimetype);
    if (!okType) throw new HttpError(422, 'Format accepté : PDF ou image.');
    const doc = await prisma.legalDoc.findFirst({ where: { id: req.params.docId, personId: req.params.id } });
    if (!doc) throw new HttpError(404, 'Document introuvable');
    const rel = storeFile(req.file.buffer, req.file.originalname || 'document.pdf', 'legal-docs');
    const updated = await prisma.legalDoc.update({ where: { id: doc.id }, data: { fileUrl: rel } });
    res.status(201).json({ doc: updated });
  }),
);

peopleRouter.get(
  '/:id/legal-docs/:docId/file',
  requireAuth(...STAFF),
  asyncHandler(async (req, res) => {
    const doc = await prisma.legalDoc.findFirst({ where: { id: req.params.docId, personId: req.params.id } });
    if (!doc?.fileUrl) throw new HttpError(404, 'Aucune pièce jointe');
    const file = resolveUpload(doc.fileUrl);
    if (!existsSync(file)) throw new HttpError(404, 'Fichier introuvable sur le serveur');
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename="${(doc.label ?? doc.type).replace(/[^\w.-]/g, '_')}${ext}"`);
    createReadStream(file).pipe(res);
  }),
);

/* -------------------------------------------------------- Avances & dettes */

peopleRouter.post(
  '/:id/adjustments',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personAdjustmentInput.parse(req.body);
    const adj = await prisma.personAdjustment.create({
      data: { personId: req.params.id as string, ...data, note: data.note ?? null, createdById: req.user!.id },
    });
    res.status(201).json({ adjustment: adj });
  }),
);

peopleRouter.patch(
  '/:id/adjustments/:adjId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const data = personAdjustmentInput.partial().parse(req.body);
    const adj = await prisma.personAdjustment.update({
      where: { id: req.params.adjId },
      data: { ...data, note: data.note === undefined ? undefined : data.note ?? null },
    });
    res.json({ adjustment: adj });
  }),
);

/** Bascule réglé / à déduire (avance remboursée, dette payée…). */
peopleRouter.post(
  '/:id/adjustments/:adjId/settle',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const settled = req.body?.settled !== false;
    const adj = await prisma.personAdjustment.update({
      where: { id: req.params.adjId },
      data: { settled, settledOn: settled ? new Date() : null },
    });
    res.json({ adjustment: adj });
  }),
);

peopleRouter.delete(
  '/:id/adjustments/:adjId',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    await prisma.personAdjustment.delete({ where: { id: req.params.adjId } });
    res.json({ ok: true });
  }),
);
