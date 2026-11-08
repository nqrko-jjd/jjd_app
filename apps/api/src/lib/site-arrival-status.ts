/** Statut d'arrivée sur chantier, pur (sans base ni réseau) : voir lib/site-arrivals.ts. */
export type ArrivalStatus = 'sur_place' | 'reparti' | 'en_retard' | 'prevu' | 'sans_gps';
export interface SiteArrival {
  chantier: string; chantierTitre: string; debutPrevu: string; equipe: string[]; vehicule: string | null;
  arriveA: string | null; repartiA: string | null; statut: ArrivalStatus; retardMinutes: number | null;
}

const LATE_MS = 30 * 60_000;

/** Statut pur, testable : à partir de l'heure prévue, de la visite GPS et de l'heure actuelle. */
export function arrivalStatus(startAt: Date, visit: { arrivedAt: string | null; leftAt: string | null } | null, now: Date): { statut: ArrivalStatus; retardMinutes: number | null } {
  if (!visit) return { statut: 'sans_gps', retardMinutes: null };
  if (visit.arrivedAt) {
    const late = Math.round((new Date(visit.arrivedAt).getTime() - startAt.getTime()) / 60_000);
    return { statut: visit.leftAt ? 'reparti' : 'sur_place', retardMinutes: late > 15 ? late : null };
  }
  const over = now.getTime() - startAt.getTime();
  return over > LATE_MS ? { statut: 'en_retard', retardMinutes: Math.round(over / 60_000) } : { statut: 'prevu', retardMinutes: null };
}

