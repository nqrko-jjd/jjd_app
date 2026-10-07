/**
 * Comment on nomme un véhicule à l'écran : par son MODÈLE (« Transit », « Expert »…) — le code interne ne parle à personne —,
 * suivi de la plaque quand il y a la place.
 */
export interface VehicleLike { model?: string | null; brand?: string | null; name?: string | null; plate?: string | null; code?: string | null }

export const vehicleName = (v: VehicleLike) => v.model || v.brand || v.name || v.plate || v.code || 'Véhicule';
export const vehicleLabel = (v: VehicleLike) => {
  const n = vehicleName(v);
  return v.plate && v.plate !== n ? `${n} · ${v.plate}` : n;
};
