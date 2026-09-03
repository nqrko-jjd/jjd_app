import { distanceMeters, vehicleCostPerKm, DEFAULT_ROAD_FACTOR, round2 } from '@jjd/shared';
import { prisma } from '../db.js';

export interface Depot {
  label: string;
  address: string;
  postalCode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  roadFactor: number;
}

const DEPOT_DEFAULTS: Depot = {
  label: 'Dépôt', address: '', postalCode: '', city: '', lat: null, lng: null,
  roadFactor: DEFAULT_ROAD_FACTOR,
};

export async function getDepot(): Promise<Depot> {
  const row = await prisma.setting.findUnique({ where: { key: 'depot' } });
  const v = (row?.value as Partial<Depot>) ?? {};
  return {
    ...DEPOT_DEFAULTS,
    ...v,
    lat: typeof v.lat === 'number' ? v.lat : null,
    lng: typeof v.lng === 'number' ? v.lng : null,
    roadFactor: Number(v.roadFactor) > 0 ? Number(v.roadFactor) : DEFAULT_ROAD_FACTOR,
  };
}

export interface WorksiteTrip {
  date: string; // YYYY-MM-DD
  vehicleId: string;
  vehicleLabel: string;
  oneWayKm: number;
  roundTripKm: number;
  costPerKm: number;
  cost: number;
}

export interface WorksiteTransport {
  cost: number;
  trips: WorksiteTrip[];
  /** null si tout va bien, sinon la raison pour laquelle le coût est incomplet/0. */
  note: string | null;
  oneWayKm: number | null;
}

const vehLabel = (v: { code: string | null; brand: string | null; model: string | null; plate: string | null }) =>
  [v.code, [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean)[0] ?? 'Véhicule';

/**
 * Coût transport estimé d'un chantier : pour chaque jour où un véhicule est
 * planifié sur le chantier, un aller-retour dépôt ↔ chantier est facturé au
 * coût/km du véhicule. La distance est celle « à vol d'oiseau » multipliée par
 * le facteur routier du dépôt (faute de calcul d'itinéraire).
 */
export async function worksiteTransport(worksiteId: string): Promise<WorksiteTransport> {
  const empty = (note: string | null, oneWayKm: number | null = null): WorksiteTransport => ({
    cost: 0, trips: [], note, oneWayKm,
  });

  const [depot, ws] = await Promise.all([
    getDepot(),
    prisma.worksite.findUnique({ where: { id: worksiteId }, select: { lat: true, lng: true } }),
  ]);
  if (!ws) return empty('Chantier introuvable');
  if (depot.lat == null || depot.lng == null) return empty('Dépôt non géolocalisé (Paramètres → Dépôt)');

  const wsLat = ws.lat ?? null;
  const wsLng = ws.lng ?? null;
  if (wsLat == null || wsLng == null) return empty('Chantier non géolocalisé (fiche → Localisation)');

  const oneWayKm = round2((distanceMeters(depot.lat, depot.lng, wsLat, wsLng) / 1000) * depot.roadFactor);

  const events = await prisma.planningEvent.findMany({
    where: { worksiteId, vehicleId: { not: null } },
    select: {
      startAt: true, vehicleId: true,
      vehicle: {
        select: {
          code: true, brand: true, model: true, plate: true,
          fuelConsoL100: true, fuelPricePerL: true, costPerKmExtra: true,
        },
      },
    },
  });
  if (events.length === 0) return empty('Aucun véhicule planifié sur ce chantier', oneWayKm);

  // un aller-retour par (jour, véhicule)
  const seen = new Set<string>();
  const trips: WorksiteTrip[] = [];
  let missingRate = false;
  for (const ev of events) {
    if (!ev.vehicleId || !ev.vehicle) continue;
    const date = ev.startAt.toISOString().slice(0, 10);
    const key = `${date}|${ev.vehicleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const perKm = vehicleCostPerKm(ev.vehicle);
    if (perKm == null) { missingRate = true; continue; }
    const roundTripKm = round2(oneWayKm * 2);
    trips.push({
      date, vehicleId: ev.vehicleId, vehicleLabel: vehLabel(ev.vehicle),
      oneWayKm, roundTripKm, costPerKm: perKm, cost: round2(roundTripKm * perKm),
    });
  }
  trips.sort((a, b) => a.date.localeCompare(b.date));
  const cost = round2(trips.reduce((s, t) => s + t.cost, 0));
  const note = missingRate
    ? 'Certains véhicules n’ont pas de consommation / prix carburant renseignés (fiche véhicule).'
    : null;
  return { cost, trips, note, oneWayKm };
}

/**
 * Coût transport de TOUS les chantiers en un seul lot (pour le P&L consolidé /
 * le partage des bénéfices). Renvoie une map worksiteId → coût estimé.
 */
export async function allWorksitesTransport(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const depot = await getDepot();
  if (depot.lat == null || depot.lng == null) return out;

  const [worksites, events] = await Promise.all([
    prisma.worksite.findMany({
      where: { lat: { not: null }, lng: { not: null } },
      select: { id: true, lat: true, lng: true },
    }),
    prisma.planningEvent.findMany({
      where: { vehicleId: { not: null } },
      select: {
        worksiteId: true, startAt: true, vehicleId: true,
        vehicle: { select: { fuelConsoL100: true, fuelPricePerL: true, costPerKmExtra: true } },
      },
    }),
  ]);

  const oneWay = new Map<string, number>();
  for (const w of worksites) {
    if (w.lat == null || w.lng == null) continue;
    oneWay.set(w.id, round2((distanceMeters(depot.lat, depot.lng, w.lat, w.lng) / 1000) * depot.roadFactor));
  }

  const seen = new Set<string>();
  for (const ev of events) {
    if (!ev.vehicleId || !ev.vehicle || !ev.worksiteId) continue;
    const km = oneWay.get(ev.worksiteId);
    if (km == null) continue;
    const date = ev.startAt.toISOString().slice(0, 10);
    const key = `${ev.worksiteId}|${date}|${ev.vehicleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const perKm = vehicleCostPerKm(ev.vehicle);
    if (perKm == null) continue;
    out.set(ev.worksiteId, round2((out.get(ev.worksiteId) ?? 0) + km * 2 * perKm));
  }
  return out;
}
