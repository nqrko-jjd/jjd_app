/**
 * Boîtiers GPS sans abonnement (SinoTrack ST-903…) via Traccar auto-hébergé (docker-compose.traccar.yml).
 * Lecture seule : dernière position et historique. Un traceur Traccar est relié à un véhicule avec l'identifiant « tc:<id Traccar> »
 * (même colonne pajDeviceId que PAJ, pour ne pas toucher au schéma).
 */
import { env } from '../env.js';

export const TRACCAR_PREFIX = 'tc:';
export const isTraccarId = (deviceId: string) => deviceId.startsWith(TRACCAR_PREFIX);
export const traccarConfigured = () => !!(env.traccarUrl && env.traccarToken);
const KMH_PER_KNOT = 1.852; // Traccar donne la vitesse en nœuds

async function tcFetch(path: string): Promise<unknown> {
  const res = await fetch(`${env.traccarUrl.replace(/\/$/, '')}/api${path}`, {
    headers: { Authorization: `Bearer ${env.traccarToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json();
}

const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v as Record<string, unknown>[] : [];
const num = (v: unknown): number | null => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const rawId = (deviceId: string) => encodeURIComponent(deviceId.slice(TRACCAR_PREFIX.length));

export interface TcPoint { lat: number; lng: number; at: Date; speed: number | null; battery: number | null }
function toPoint(p: Record<string, unknown>): TcPoint | null {
  const lat = num(p.latitude), lng = num(p.longitude), at = new Date(String(p.fixTime ?? p.deviceTime ?? ''));
  if (lat == null || lng == null || !Number.isFinite(at.getTime()) || (lat === 0 && lng === 0)) return null;
  const knots = num(p.speed);
  const attrs = (p.attributes && typeof p.attributes === 'object' ? p.attributes : {}) as Record<string, unknown>;
  return { lat, lng, at, speed: knots != null ? knots * KMH_PER_KNOT : null, battery: num(attrs.batteryLevel) };
}

export async function listTraccarDevices(): Promise<{ id: string; name: string }[]> {
  return rows(await tcFetch('/devices')).map((d) => ({ id: `${TRACCAR_PREFIX}${d.id}`, name: `${d.name ?? d.uniqueId ?? d.id} (Traccar)` })).filter((d) => d.id !== TRACCAR_PREFIX);
}

export async function lastTraccarPoint(deviceId: string): Promise<TcPoint | null> {
  const p = rows(await tcFetch(`/positions?deviceId=${rawId(deviceId)}`))[0];
  return p ? toPoint(p) : null;
}

export async function traccarPointsBetween(deviceId: string, from: Date, to: Date): Promise<TcPoint[]> {
  const q = `deviceId=${rawId(deviceId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  return rows(await tcFetch(`/positions?${q}`)).map(toPoint).filter((p): p is TcPoint => !!p).sort((a, b) => a.at.getTime() - b.at.getTime());
}
