import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { emailConfigured } from '../lib/doc-mail.js';
import { listPajDevices, pajConfigured, syncVehiclePositions } from '../lib/paj.js';
import { computeArrivals, getArrivalSettings, saveArrivalSettings } from '../lib/arrival-notices.js';

/** Suivi GPS des véhicules (traceurs PAJ) et avis d'arrivée aux clients — bureau uniquement (lib/paj.ts, lib/arrival-notices.ts). */
export const gpsRouter = Router();

gpsRouter.get(
  '/',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    const [vehicles, settings, arrivals, history] = await Promise.all([
      prisma.vehicle.findMany({
        where: { active: true }, orderBy: [{ code: 'asc' }],
        select: { id: true, code: true, name: true, plate: true, brand: true, model: true, pajDeviceId: true, lastLat: true, lastLng: true, lastSeenAt: true, lastSpeed: true, lastBattery: true },
      }),
      getArrivalSettings(), computeArrivals(),
      prisma.arrivalNotice.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const todays = await prisma.planningEvent.findMany({
      where: { kind: 'intervention', startAt: { gte: dayStart, lt: dayEnd }, vehicles: { some: {} }, worksite: { lat: { not: null }, lng: { not: null } } },
      select: { id: true, startAt: true, worksite: { select: { ref: true, lat: true, lng: true, client: { select: { name: true } } } }, vehicles: { select: { vehicleId: true } } },
      orderBy: { startAt: 'asc' },
    });
    const sites = todays.map((e) => ({ id: e.id, ref: e.worksite.ref, client: e.worksite.client?.name ?? null, lat: e.worksite.lat!, lng: e.worksite.lng!, startAt: e.startAt, vehicleIds: e.vehicles.map((v) => v.vehicleId) }));
    const events = await prisma.planningEvent.findMany({ where: { id: { in: history.map((h) => h.eventId) } }, select: { id: true, startAt: true, worksite: { select: { ref: true, client: { select: { name: true } } } } } });
    const byId = new Map(events.map((e) => [e.id, e]));
    res.json({
      pajConfigured: pajConfigured(), emailConfigured: emailConfigured(), vehicles, sites, settings, arrivals,
      history: history.map((h) => ({ id: h.id, status: h.status, toEmail: h.toEmail, etaMinutes: h.etaMinutes, sentAt: h.sentAt, error: h.error, createdAt: h.createdAt, event: byId.get(h.eventId) ?? null })),
    });
  }),
);

/** Traceurs du compte PAJ, pour les relier aux véhicules (sert aussi de test de connexion). */
gpsRouter.get(
  '/devices',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    try { res.json({ devices: await listPajDevices() }); } catch (e) { throw e instanceof HttpError ? e : new HttpError(502, `PAJ GPS : ${(e as Error).message}`); }
  }),
);

gpsRouter.patch(
  '/vehicles/:id',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const { pajDeviceId } = z.object({ pajDeviceId: z.string().trim().max(60).nullable() }).parse(req.body);
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!v) throw new HttpError(404, 'Véhicule introuvable');
    if (pajDeviceId) {
      const other = await prisma.vehicle.findFirst({ where: { pajDeviceId, id: { not: v.id } }, select: { name: true, plate: true } });
      if (other) throw new HttpError(409, `Ce traceur est déjà relié à ${other.name ?? other.plate ?? 'un autre véhicule'}.`);
    }
    await prisma.vehicle.update({ where: { id: v.id }, data: { pajDeviceId: pajDeviceId || null, ...(pajDeviceId ? {} : { lastLat: null, lastLng: null, lastSeenAt: null, lastSpeed: null, lastBattery: null }) } });
    res.json({ ok: true });
  }),
);

gpsRouter.post(
  '/refresh',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!pajConfigured()) throw new HttpError(503, 'Le compte PAJ GPS n’est pas configuré sur le serveur.');
    res.json({ updated: await syncVehiclePositions() });
  }),
);

const settingsInput = z.object({
  enabled: z.boolean(), radiusKm: z.coerce.number().min(1).max(30), maxPositionAgeMin: z.coerce.number().min(2).max(60), copyToSelf: z.boolean(),
  testTo: z.string().max(200), subject: z.string().max(200), body: z.string().max(4000),
});
gpsRouter.put(
  '/settings',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    const saved = await saveArrivalSettings(settingsInput.parse(req.body));
    await prisma.auditLog.create({ data: { actorId: req.user!.id, action: 'arrival.settings', entity: 'Setting', entityId: 'arrivalNotices', meta: { enabled: saved.enabled, testTo: !!saved.testTo } } });
    res.json({ settings: saved });
  }),
);
