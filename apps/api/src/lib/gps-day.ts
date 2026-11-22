/** Résumé de la journée d'un véhicule à partir de l'historique PAJ : arrêté depuis quand, kilomètres, première sortie, tracé. Pur (sans accès réseau ni base). */
import { distanceKm } from './arrival-notices.js';

export interface DayPoint { lat: number; lng: number; at: Date; speed: number | null }
/** Arrêt d'au moins 5 minutes : début, fin (null = toujours à l'arrêt) et position. */
export interface DayStop { from: string; to: string | null; lat: number; lng: number }
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
  stops: DayStop[];
}

const MOVING_KMH = 3;
const JITTER_KM = 0.015; // sous 15 m entre deux points : bruit GPS à l'arrêt, ignoré dans le total
const MAX_TRACK = 400;
const MIN_STOP_MS = 5 * 60_000;
const STOP_RADIUS_KM = 0.1;

/** Arrêts de la journée : suites de points à l'arrêt, dans un rayon de 100 m, d'au moins 5 minutes (la veille du traceur compte dans la durée). */
function findStops(pts: DayPoint[], moving: (p: DayPoint) => boolean): DayStop[] {
  const stops: DayStop[] = [];
  let i = 0;
  while (i < pts.length) {
    if (moving(pts[i]!)) { i++; continue; }
    let j = i;
    while (j + 1 < pts.length && !moving(pts[j + 1]!) && distanceKm(pts[i]!, pts[j + 1]!) <= STOP_RADIUS_KM) j++;
    const open = j === pts.length - 1;
    const end = open ? null : pts[j + 1]!.at;
    const lastMs = (end ?? pts[j]!.at).getTime();
    if (lastMs - pts[i]!.at.getTime() >= MIN_STOP_MS) stops.push({ from: pts[i]!.at.toISOString(), to: end?.toISOString() ?? null, lat: pts[i]!.lat, lng: pts[i]!.lng });
    i = j + 1;
  }
  return stops;
}

export interface SiteVisit { arrivedAt: string | null; leftAt: string | null }
/** Arrivée sur un chantier : premier point à l'arrêt dans le rayon ; départ : premier point hors du rayon ensuite. Un simple passage à vitesse normale ne compte pas. */
export function siteVisit(raw: DayPoint[], site: { lat: number; lng: number }, radiusKm = 0.2): SiteVisit {
  const pts = [...raw].sort((a, b) => a.at.getTime() - b.at.getTime());
  const inside = (p: DayPoint) => distanceKm(p, site) <= radiusKm;
  const i = pts.findIndex((p) => inside(p) && !(p.speed != null && p.speed >= MOVING_KMH));
  if (i < 0) return { arrivedAt: null, leftAt: null };
  const out = pts.findIndex((p, j) => j > i && !inside(p));
  return { arrivedAt: pts[i]!.at.toISOString(), leftAt: out >= 0 ? pts[out]!.at.toISOString() : null };
}

export function summarizeDay(raw: DayPoint[]): DaySummary {
  const pts = [...raw].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!pts.length) return { points: 0, lastSignalAt: null, stoppedSince: null, noMoveToday: false, firstMoveAt: null, km: 0, track: [], stops: [] };
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
    firstMoveAt: firstMove?.at.toISOString() ?? null, km: Math.round(km * 10) / 10, track, stops: findStops(pts, moving),
  };
}

/* ------------------------------------------------------------------ journal des trajets */

export interface JourneyStop { type: 'stop'; from: string; to: string | null; minutes: number; lat: number; lng: number }
export interface JourneyTrip { type: 'trip'; from: string; to: string; minutes: number; km: number; maxSpeed: number; avgSpeed: number; start: { lat: number; lng: number }; end: { lat: number; lng: number } }
export type JourneySegment = JourneyStop | JourneyTrip;
export interface Journey {
  summary: { km: number; driveMinutes: number; stopMinutes: number; maxSpeed: number; firstMoveAt: string | null; lastSignalAt: string | null };
  segments: JourneySegment[];
  /** Pour le rejeu : [lat, lng, secondes UNIX, vitesse km/h], allégé à ~800 points. */
  points: [number, number, number, number][];
}

const MAX_REPLAY_POINTS = 800;
const MIN_TRIP_KM = 0.15;

/** Trajets et arrêts de la journée : un « arrêt » est une immobilisation d'au moins 5 min (même règle que summarizeDay), un « trajet » ce qu'il y a entre deux arrêts. */
export function buildJourney(raw: DayPoint[]): Journey {
  const pts = [...raw].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!pts.length) return { summary: { km: 0, driveMinutes: 0, stopMinutes: 0, maxSpeed: 0, firstMoveAt: null, lastSignalAt: null }, segments: [], points: [] };
  const moving = (p: DayPoint) => p.speed != null && p.speed >= MOVING_KMH;
  const stops = findStops(pts, moving);
  const t = (iso: string) => new Date(iso).getTime();
  const firstT = pts[0]!.at.getTime();
  const lastT = pts[pts.length - 1]!.at.getTime();

  const kmBetween = (from: number, to: number) => {
    let km = 0, max = 0;
    let prev: DayPoint | null = null;
    for (const p of pts) {
      const ts = p.at.getTime();
      if (ts < from || ts > to) continue;
      if (p.speed != null && p.speed > max) max = p.speed;
      if (prev) { const d = distanceKm(prev, p); if (d >= JITTER_KM && d < 5) km += d; }
      prev = p;
    }
    return { km, max };
  };

  const segments: JourneySegment[] = [];
  const pushTrip = (from: number, to: number) => {
    if (to - from < 60_000) return;
    const inside = pts.filter((p) => p.at.getTime() >= from && p.at.getTime() <= to);
    if (inside.length < 2) return;
    const { km, max } = kmBetween(from, to);
    if (km < MIN_TRIP_KM) return;
    const minutes = Math.max(1, Math.round((to - from) / 60_000));
    segments.push({
      type: 'trip', from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes,
      km: Math.round(km * 10) / 10, maxSpeed: Math.round(max), avgSpeed: Math.round(km / (minutes / 60)),
      start: { lat: inside[0]!.lat, lng: inside[0]!.lng }, end: { lat: inside[inside.length - 1]!.lat, lng: inside[inside.length - 1]!.lng },
    });
  };

  let cursor = firstT;
  for (const st of stops) {
    const sFrom = t(st.from);
    const sTo = st.to ? t(st.to) : lastT;
    pushTrip(cursor, sFrom);
    segments.push({ type: 'stop', from: st.from, to: st.to, minutes: Math.max(1, Math.round((sTo - sFrom) / 60_000)), lat: st.lat, lng: st.lng });
    cursor = sTo;
  }
  if (!stops.length || stops[stops.length - 1]!.to) pushTrip(cursor, lastT);

  const step = Math.max(1, Math.ceil(pts.length / MAX_REPLAY_POINTS));
  const points = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map((p): [number, number, number, number] => [p.lat, p.lng, Math.round(p.at.getTime() / 1000), Math.round(p.speed ?? 0)]);

  const trips = segments.filter((s): s is JourneyTrip => s.type === 'trip');
  const firstMove = pts.find(moving);
  return {
    summary: {
      km: Math.round(trips.reduce((s, x) => s + x.km, 0) * 10) / 10,
      driveMinutes: trips.reduce((s, x) => s + x.minutes, 0),
      stopMinutes: segments.filter((s): s is JourneyStop => s.type === 'stop').reduce((s, x) => s + x.minutes, 0),
      maxSpeed: Math.max(0, ...trips.map((x) => x.maxSpeed)),
      firstMoveAt: firstMove?.at.toISOString() ?? null,
      lastSignalAt: pts[pts.length - 1]!.at.toISOString(),
    },
    segments, points,
  };
}
