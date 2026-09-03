import { Router } from 'express';
import { z } from 'zod';
import { depotInput } from '@jjd/shared';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { getCompany } from '../lib/documents.js';
import { getDepot } from '../lib/vehicle-cost.js';
import { geocode } from '../lib/geocode.js';

export const settingsRouter = Router();

const companySchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().default(''),
  postalCode: z.string().trim().default(''),
  city: z.string().trim().default(''),
  vat: z.string().trim().default(''),
  iban: z.string().trim().default(''),
  email: z.string().trim().default(''),
  phone: z.string().trim().default(''),
  website: z.string().trim().default(''),
  quoteTerms: z.string().trim().default(''),
  invoiceTerms: z.string().trim().default(''),
});

settingsRouter.get(
  '/company',
  requireAuth('admin', 'office'),
  asyncHandler(async (_req, res) => {
    res.json({ company: await getCompany() });
  }),
);

settingsRouter.get(
  '/geo',
  requireAuth('admin', 'office'),
  asyncHandler(async (_req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: 'geoRadius' } });
    res.json({ radiusM: Number((row?.value as { m?: number })?.m) || 250 });
  }),
);

settingsRouter.put(
  '/geo',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    const m = Math.max(50, Math.min(5000, Number(req.body?.radiusM) || 250));
    await prisma.setting.upsert({ where: { key: 'geoRadius' }, create: { key: 'geoRadius', value: { m } }, update: { value: { m } } });
    res.json({ radiusM: m });
  }),
);

settingsRouter.get(
  '/depot',
  requireAuth('admin', 'office'),
  asyncHandler(async (_req, res) => {
    res.json({ depot: await getDepot() });
  }),
);

settingsRouter.put(
  '/depot',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    const value = depotInput.parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'depot' },
      create: { key: 'depot', value },
      update: { value },
    });
    res.json({ depot: await getDepot() });
  }),
);

/** Géocode l'adresse du dépôt et enregistre le point GPS. */
settingsRouter.post(
  '/depot/geocode',
  requireAuth('admin'),
  asyncHandler(async (_req, res) => {
    const depot = await getDepot();
    const q = [depot.address, [depot.postalCode, depot.city].filter(Boolean).join(' '), 'Belgique']
      .filter(Boolean).join(', ');
    if (!q || q === 'Belgique') throw new HttpError(422, 'Renseigne d’abord l’adresse du dépôt');
    const hit = await geocode(q);
    if (!hit) throw new HttpError(404, `Adresse introuvable : ${q}`);
    const value = { ...depot, lat: hit.lat, lng: hit.lng };
    await prisma.setting.upsert({
      where: { key: 'depot' },
      create: { key: 'depot', value },
      update: { value },
    });
    res.json({ depot: await getDepot(), matched: hit.label });
  }),
);

settingsRouter.put(
  '/company',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    const value = companySchema.parse(req.body);
    await prisma.setting.upsert({
      where: { key: 'company' },
      create: { key: 'company', value },
      update: { value },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: 'update', entity: 'setting', entityId: 'company' },
    });
    res.json({ company: value });
  }),
);
