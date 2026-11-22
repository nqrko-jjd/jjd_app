import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth, OFFICE } from '../lib/auth.js';
import { emailConfigured } from '../lib/doc-mail.js';
import { gpsConfigured, listPajDevices, pajPointsBetween, syncVehiclePositions } from '../lib/paj.js';
import { siteVisit, summarizeDay, buildJourney } from '../lib/gps-day.js';
import { distanceKm } from '../lib/arrival-notices.js';
import { reverseAddress } from '../lib/geocode.js';
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
      pajConfigured: gpsConfigured(), emailConfigured: emailConfigured(), vehicles, sites, settings, arrivals,
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

/** Journée d'un véhicule (depuis minuit) : immobilisé depuis quand, kilomètres, première sortie, tracé. Lu à la demande chez PAJ, rien n'est stocké. */
gpsRouter.get(
  '/vehicles/:id/day',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    if (!gpsConfigured()) throw new HttpError(503, 'Aucune source GPS (PAJ ou Traccar) n’est configurée sur le serveur.');
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { pajDeviceId: true } });
    if (!v?.pajDeviceId) throw new HttpError(404, 'Ce véhicule n’a pas de traceur.');
    const from = new Date(); from.setHours(0, 0, 0, 0);
    try { res.json(summarizeDay(await pajPointsBetween(v.pajDeviceId, from, new Date()))); } catch (e) { throw e instanceof HttpError ? e : new HttpError(502, `PAJ GPS : ${(e as Error).message}`); }
  }),
);

/** Journal d'un véhicule pour un jour (?date=AAAA-MM-JJ, aujourd'hui par défaut) : trajets, arrêts (avec chantier ou adresse), totaux et points pour le rejeu. Lu à la demande chez PAJ. */
gpsRouter.get(
  '/vehicles/:id/journey',
  requireAuth(...OFFICE),
  asyncHandler(async (req, res) => {
    if (!gpsConfigured()) throw new HttpError(503, 'Aucune source GPS (PAJ ou Traccar) n’est configurée sur le serveur.');
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { pajDeviceId: true } });
    if (!v?.pajDeviceId) throw new HttpError(404, 'Ce véhicule n’a pas de traceur.');
    const dateStr = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
    const from = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(Math.min(from.getTime() + 86_400_000, Date.now()));
    if (Number.isNaN(from.getTime()) || from.getTime() > Date.now()) throw new HttpError(422, 'Date invalide');
    let journey;
    try { journey = buildJourney(await pajPointsBetween(v.pajDeviceId, from, to)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(502, `PAJ GPS : ${(e as Error).message}`); }

    // lieux : d'abord les chantiers connus (à moins de 250 m), sinon l'adresse (quelques recherches seulement)
    const sites = await prisma.worksite.findMany({ where: { lat: { not: null }, lng: { not: null }, archived: false }, select: { ref: true, title: true, address: true, city: true, lat: true, lng: true } });
    let lookups = 0;
    const place = async (p: { lat: number; lng: number }): Promise<{ label: string | null; worksite: string | null }> => {
      let best: { ref: string; title: string; d: number } | null = null;
      for (const s of sites) {
        const d = distanceKm(p, { lat: s.lat!, lng: s.lng! });
        if (d <= 0.25 && (!best || d < best.d)) best = { ref: s.ref, title: s.title, d };
      }
      if (best) return { label: `${best.ref} · ${best.title}`, worksite: best.ref };
      if (lookups >= 10) return { label: null, worksite: null };
      lookups++;
      return { label: await reverseAddress(p.lat, p.lng), worksite: null };
    };
    const segments = [];
    for (const seg of journey.segments) {
      if (seg.type === 'stop') segments.push({ ...seg, ...(await place(seg)) });
      else segments.push({ ...seg, startPlace: (await place(seg.start)).label, endPlace: (await place(seg.end)).label });
    }
    res.json({ date: dateStr ?? `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`, summary: journey.summary, segments, points: journey.points });
  }),
);

/** Heures d'arrivée / de départ des véhicules sur les chantiers du jour (d'après l'historique PAJ, à la demande). */
gpsRouter.get(
  '/day-arrivals',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!gpsConfigured()) throw new HttpError(503, 'Aucune source GPS (PAJ ou Traccar) n’est configurée sur le serveur.');
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const events = await prisma.planningEvent.findMany({
      where: { kind: 'intervention', startAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) }, vehicles: { some: {} }, worksite: { lat: { not: null }, lng: { not: null } } },
      select: { id: true, worksite: { select: { lat: true, lng: true } }, vehicles: { select: { vehicle: { select: { id: true, pajDeviceId: true } } } } },
    });
    const cache = new Map<string, Awaited<ReturnType<typeof pajPointsBetween>>>();
    const arrivals: { eventId: string; vehicleId: string; arrivedAt: string | null; leftAt: string | null }[] = [];
    try {
      for (const e of events) for (const { vehicle } of e.vehicles) {
        if (!vehicle.pajDeviceId) continue;
        if (!cache.has(vehicle.pajDeviceId)) cache.set(vehicle.pajDeviceId, await pajPointsBetween(vehicle.pajDeviceId, from, new Date()));
        arrivals.push({ eventId: e.id, vehicleId: vehicle.id, ...siteVisit(cache.get(vehicle.pajDeviceId)!, { lat: e.worksite.lat!, lng: e.worksite.lng! }) });
      }
    } catch (err) { throw err instanceof HttpError ? err : new HttpError(502, `PAJ GPS : ${(err as Error).message}`); }
    res.json({ arrivals });
  }),
);

gpsRouter.post(
  '/refresh',
  requireAuth(...OFFICE),
  asyncHandler(async (_req, res) => {
    if (!gpsConfigured()) throw new HttpError(503, 'Aucune source GPS (PAJ ou Traccar) n’est configurée sur le serveur.');
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
