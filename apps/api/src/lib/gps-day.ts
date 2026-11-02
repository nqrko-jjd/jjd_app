/** Résumé de la journée d'un véhicule à partir de l'historique PAJ : arrêté depuis quand, kilomètres, première sortie, tracé. Pur (sans accès réseau ni base). */
import { distanceKm } from './arrival-notices.js';

export interface DayPoint { lat: number; lng: number; at: Date; speed: number | null }
export interface DaySummary {
  points: number;
  lastSignalAt: string | null;
  /** Début de l'immobilisation en cours (null si le véhicule roule). */
  stoppedSince: string | null;
  /** true : aucun déplacement dans la période lue, « stoppedSince » est alors le premier signal de la période. */
  noMoveToday: boolean;
  firstMoveAt: string | null;
  km: number;
  track: [number, number][];
}

const MOVING_KMH = 3;
const JITTER_KM = 0.015; // sous 15 m entre deux points : bruit GPS à l'arrêt, ignoré dans le total
const MAX_TRACK = 400;

export function summarizeDay(raw: DayPoint[]): DaySummary {
  const pts = [...raw].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!pts.length) return { points: 0, lastSignalAt: null, stoppedSince: null, noMoveToday: false, firstMoveAt: null, km: 0, track: [] };
  const moving = (p: DayPoint) => p.speed != null && p.speed >= MOVING_KMH;

  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distanceKm(pts[i - 1]!, pts[i]!);
    if (d >= JITTER_KM && d < 5) km += d; // au-delà de 5 km entre deux points : trou de signal, on ne l'invente pas
  }

  const last = pts[pts.length - 1]!;
  const firstMove = pts.find(moving) ?? null;
  let stoppedSince: Date | null = null;
  let noMoveToday = false;
  if (!moving(last)) {
    let i = pts.length - 1;
    while (i >= 0 && !moving(pts[i]!)) i--;
    if (i < 0) { stoppedSince = pts[0]!.at; noMoveToday = true; } else stoppedSince = pts[Math.min(i + 1, pts.length - 1)]!.at;
  }

  const step = Math.max(1, Math.ceil(pts.length / MAX_TRACK));
  const track = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p): [number, number] => [p.lat, p.lng]);
  return {
    points: pts.length, lastSignalAt: last.at.toISOString(), stoppedSince: stoppedSince?.toISOString() ?? null, noMoveToday,
    firstMoveAt: firstMove?.at.toISOString() ?? null, km: Math.round(km * 10) / 10, track,
  };
}
