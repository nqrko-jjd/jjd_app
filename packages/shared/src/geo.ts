/** Distance en mètres entre deux points GPS (formule de haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Rayon toléré par défaut autour d'un chantier pour le pointage (mètres). */
export const DEFAULT_GEO_RADIUS = 250;

/**
 * Facteur « distance routière / distance à vol d'oiseau ».
 * ~1,4 en zone urbaine/périurbaine belge — utilisé pour estimer les km
 * parcourus entre le dépôt et un chantier faute de calcul d'itinéraire.
 */
export const DEFAULT_ROAD_FACTOR = 1.4;

/** Coût carburant au km d'un véhicule = (conso L/100 ÷ 100) × prix €/L, + éventuel coût/km additionnel. */
export function vehicleCostPerKm(v: {
  fuelConsoL100?: number | null;
  fuelPricePerL?: number | null;
  costPerKmExtra?: number | null;
}): number | null {
  const conso = v.fuelConsoL100 ?? 0;
  const price = v.fuelPricePerL ?? 0;
  const extra = v.costPerKmExtra ?? 0;
  if (conso <= 0 || price <= 0) return extra > 0 ? Math.round(extra * 1000) / 1000 : null;
  const perKm = (conso / 100) * price + extra;
  return Math.round(perKm * 1000) / 1000;
}
