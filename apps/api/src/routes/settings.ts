import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { getCompany } from '../lib/documents.js';

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
