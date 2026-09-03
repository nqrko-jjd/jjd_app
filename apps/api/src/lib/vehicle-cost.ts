import {
  distanceMeters, vehicleCostPerKm, perDayFromMonthly,
  DEFAULT_ROAD_FACTOR, DEFAULT_WORK_DAYS_PER_YEAR, round2,
} from '@jjd/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export interface Depot {
  label: string;
  address: string;
  postalCode: string;
  city: string;
  lat: number | null;
  lng: number | null;
  roadFactor: number;
  workDaysPerYear: number;
}

const DEPOT_DEFAULTS: Depot = {
  label: 'Dépôt', address: '', postalCode: '', city: '', lat: null, lng: null,
  roadFactor: DEFAULT_ROAD_FACTOR, workDaysPerYear: DEFAULT_WORK_DAYS_PER_YEAR,
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
    workDaysPerYear: Number(v.workDaysPerYear) > 0 ? Number(v.workDaysPerYear) : DEFAULT_WORK_DAYS_PER_YEAR,
  };
}

/* ---------------------------------------------------------------- coût fixe */

/** Sélection Prisma minimale pour calculer le coût d'un véhicule. */
export const vehicleCostSelect = {
  code: true, brand: true, model: true, plate: true,
  fuelConsoL100: true, fuelPricePerL: true, costPerKmExtra: true,
  parkingMonthly: true, otherMonthly: true,
  monthlyPayment: true, circulationTax: true, biv: true,
  insurances: { select: { monthlyAmount: true, annualAmount: true } },
} satisfies Prisma.VehicleSelect;

type VehicleForCost = Prisma.VehicleGetPayload<{ select: typeof vehicleCostSelect }>;

export interface VehicleFixedCost {
  insurance: number;
  financing: number;
  tax: number; // taxe de circulation + BIV amorti
  parking: number;
  other: number;
  monthly: number;
  perDay: number;
}

/** Coût fixe mensuel d'un véhicule à partir des données déjà connues + saisies. */
export function vehicleFixedCost(v: VehicleForCost, workDaysPerYear = DEFAULT_WORK_DAYS_PER_YEAR): VehicleFixedCost {
  const insurance = round2(
    (v.insurances ?? []).reduce((s, i) => s + (i.monthlyAmount ?? (i.annualAmount ? i.annualAmount / 12 : 0)), 0),
  );
  const financing = round2(v.monthlyPayment ?? 0);
  const tax = round2((v.circulationTax ?? 0) / 12 + (v.biv ?? 0) / 60); // BIV amorti sur 5 ans
  const parking = round2(v.parkingMonthly ?? 0);
  const other = round2(v.otherMonthly ?? 0);
  const monthly = round2(insurance + financing + tax + parking + other);
  return { insurance, financing, tax, parking, other, monthly, perDay: perDayFromMonthly(monthly, workDaysPerYear) };
}

/** Détail du coût de revient d'un véhicule (pour sa fiche). */
export async function vehicleCostBreakdown(vehicleId: string) {
  const [v, depot] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id: vehicleId }, select: vehicleCostSelect }),
    getDepot(),
  ]);
  if (!v) return null;
  const fixed = vehicleFixedCost(v, depot.workDaysPerYear);
  return {
    fixed,
    fuelPerKm: vehicleCostPerKm(v),
    workDaysPerYear: depot.workDaysPerYear,
  };
}

/* ---------------------------------------------------------------- par chantier */

const vehLabel = (v: { code: string | null; brand: string | null; model: string | null; plate: string | null }) =>
  [v.code, [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean)[0] ?? 'Véhicule';

export interface WorksiteTrip {
  date: string; // YYYY-MM-DD
  vehicleId: string;
  vehicleLabel: string;
  roundTripKm: number;
  fuelPerKm: number;
  fuelCost: number;
  fixedCost: number; // part des coûts fixes (assurance, financement…) pour cette journée
  cost: number;
}

export interface WorksiteTransport {
  cost: number;
  fuelCost: number;
  fixedCost: number;
  trips: WorksiteTrip[];
  note: string | null;
  oneWayKm: number | null;
}

/**
 * Coût véhicule estimé d'un chantier. Pour chaque jour où un véhicule est
 * planifié sur le chantier :
 *  - carburant + usure : aller-retour dépôt ↔ chantier × coût/km du véhicule
 *  - coûts fixes : quote-part journalière (assurance, financement, taxe,
 *    parking, autres) = coût mensuel × 12 ÷ jours ouvrés/an.
 * La distance est « à vol d'oiseau » × facteur routier du dépôt.
 */
export async function worksiteTransport(worksiteId: string): Promise<WorksiteTransport> {
  const empty = (note: string | null, oneWayKm: number | null = null): WorksiteTransport => ({
    cost: 0, fuelCost: 0, fixedCost: 0, trips: [], note, oneWayKm,
  });

  const [depot, ws] = await Promise.all([
    getDepot(),
    prisma.worksite.findUnique({ where: { id: worksiteId }, select: { lat: true, lng: true } }),
  ]);
  if (!ws) return empty('Chantier introuvable');

  const events = await prisma.planningEvent.findMany({
    where: { worksiteId, vehicleId: { not: null } },
    select: { startAt: true, vehicleId: true, vehicle: { select: vehicleCostSelect } },
  });
  if (events.length === 0) return empty('Aucun véhicule planifié sur ce chantier');

  const geoOk = ws.lat != null && ws.lng != null && depot.lat != null && depot.lng != null;
  const oneWayKm = geoOk
    ? round2((distanceMeters(depot.lat!, depot.lng!, ws.lat!, ws.lng!) / 1000) * depot.roadFactor)
    : null;

  const seen = new Set<string>();
  const trips: WorksiteTrip[] = [];
  let missingGeo = false;
  let missingData = false;

  for (const ev of events) {
    if (!ev.vehicleId || !ev.vehicle) continue;
    const date = ev.startAt.toISOString().slice(0, 10);
    const key = `${date}|${ev.vehicleId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fixed = vehicleFixedCost(ev.vehicle, depot.workDaysPerYear);
    const fuelPerKm = vehicleCostPerKm(ev.vehicle) ?? 0;
    const roundTripKm = oneWayKm != null ? round2(oneWayKm * 2) : 0;
    const fuelCost = round2(roundTripKm * fuelPerKm);

    if (oneWayKm == null && fuelPerKm > 0) missingGeo = true;
    if (fixed.monthly === 0 && fuelPerKm === 0) missingData = true;
    if (fixed.perDay === 0 && fuelCost === 0) continue;

    trips.push({
      date, vehicleId: ev.vehicleId, vehicleLabel: vehLabel(ev.vehicle),
      roundTripKm, fuelPerKm, fuelCost, fixedCost: fixed.perDay,
      cost: round2(fuelCost + fixed.perDay),
    });
  }

  trips.sort((a, b) => a.date.localeCompare(b.date));
  const fuelCost = round2(trips.reduce((s, t) => s + t.fuelCost, 0));
  const fixedCost = round2(trips.reduce((s, t) => s + t.fixedCost, 0));
  const notes: string[] = [];
  if (missingGeo) notes.push('chantier ou dépôt non géolocalisé (carburant non compté)');
  if (missingData) notes.push('coûts non renseignés sur certains véhicules (fiche flotte)');
  return {
    cost: round2(fuelCost + fixedCost), fuelCost, fixedCost, trips,
    note: notes.length ? `Estimation partielle : ${notes.join(' ; ')}.` : null,
    oneWayKm,
  };
}

/**
 * Coût véhicule de TOUS les chantiers en un lot (P&L consolidé / partage des
 * bénéfices). Renvoie une map worksiteId → coût estimé.
 */
export async function allWorksitesTransport(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const depot = await getDepot();

  const [worksites, events] = await Promise.all([
    prisma.worksite.findMany({ select: { id: true, lat: true, lng: true } }),
    prisma.planningEvent.findMany({
      where: { vehicleId: { not: null } },
      select: { worksiteId: true, startAt: true, vehicleId: true, vehicle: { select: vehicleCostSelect } },
    }),
  ]);

  const oneWay = new Map<string, number>();
  if (depot.lat != null && depot.lng != null) {
    for (const w of worksites) {
      if (w.lat == null || w.lng == null) continue;
      oneWay.set(w.id, round2((distanceMeters(depot.lat, depot.lng, w.lat, w.lng) / 1000) * depot.roadFactor));
    }
  }

  const seen = new Set<string>();
  for (const ev of events) {
    if (!ev.vehicleId || !ev.vehicle || !ev.worksiteId) continue;
    const date = ev.startAt.toISOString().slice(0, 10);
    const key = `${ev.worksiteId}|${date}|${ev.vehicleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fixed = vehicleFixedCost(ev.vehicle, depot.workDaysPerYear).perDay;
    const km = oneWay.get(ev.worksiteId);
    const fuel = km != null ? km * 2 * (vehicleCostPerKm(ev.vehicle) ?? 0) : 0;
    const add = fixed + fuel;
    if (add > 0) out.set(ev.worksiteId, round2((out.get(ev.worksiteId) ?? 0) + add));
  }
  return out;
}
