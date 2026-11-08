/**
 * Arrivées sur chantier du jour, pour le connecteur Claude (QG, Sophie) : pour chaque intervention planifiée aujourd'hui,
 * l'heure d'arrivée et de départ du véhicule affecté (historique GPS PAJ ou Traccar, lu à la demande, rien n'est stocké)
 * et un statut : sur place, reparti, en retard (pas arrivé 30 min après le début prévu), prévu, ou sans GPS.
 */
import { prisma } from '../db.js';
import { gpsConfigured, pajPointsBetween } from './paj.js';
import { siteVisit, type DayPoint } from './gps-day.js';

import { arrivalStatus } from './site-arrival-status.js';
export type { ArrivalStatus, SiteArrival } from './site-arrival-status.js';
import type { SiteArrival } from './site-arrival-status.js';

export async function todaySiteArrivals(now = new Date(), readPoints: (deviceId: string, from: Date, to: Date) => Promise<DayPoint[]> = pajPointsBetween): Promise<{ gps: boolean; arrivees: SiteArrival[] }> {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const events = await prisma.planningEvent.findMany({
    where: { kind: 'intervention', startAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) } },
    orderBy: { startAt: 'asc' },
    select: {
      startAt: true,
      worksite: { select: { ref: true, title: true, lat: true, lng: true } },
      team: { select: { name: true } },
      assignments: { select: { person: { select: { firstName: true, displayName: true } } } },
      vehicles: { select: { vehicle: { select: { name: true, plate: true, pajDeviceId: true } } } },
    },
    take: 60,
  });
  const gps = gpsConfigured();
  const cache = new Map<string, DayPoint[] | null>();
  const out: SiteArrival[] = [];
  for (const e of events) {
    const tracked = e.vehicles.map((l) => l.vehicle).find((v) => v.pajDeviceId);
    const anyVehicle = tracked ?? e.vehicles[0]?.vehicle ?? null;
    let visit: { arrivedAt: string | null; leftAt: string | null } | null = null;
    if (gps && tracked?.pajDeviceId && e.worksite.lat != null && e.worksite.lng != null) {
      if (!cache.has(tracked.pajDeviceId)) cache.set(tracked.pajDeviceId, await readPoints(tracked.pajDeviceId, from, now).catch(() => null));
      const pts = cache.get(tracked.pajDeviceId);
      if (pts) visit = siteVisit(pts, { lat: e.worksite.lat, lng: e.worksite.lng });
    }
    const st = arrivalStatus(e.startAt, visit, now);
    out.push({
      chantier: e.worksite.ref, chantierTitre: e.worksite.title ?? '', debutPrevu: e.startAt.toISOString(),
      equipe: [e.team?.name, ...e.assignments.map((a) => a.person.displayName || a.person.firstName)].filter((x): x is string => !!x),
      vehicule: anyVehicle ? anyVehicle.name ?? anyVehicle.plate ?? null : null,
      arriveA: visit?.arrivedAt ?? null, repartiA: visit?.leftAt ?? null, ...st,
    });
  }
  return { gps, arrivees: out };
}
