/**
 * Suivi des véhicules par les traceurs PAJ GPS (API PAJ Finder, https://connect.paj-gps.de/api/documentation).
 * Compte unique du portail PAJ (PAJ_EMAIL / PAJ_PASSWORD dans l'environnement du serveur) : jamais exposé au navigateur.
 * Lecture seule : on lit la dernière position de chaque traceur relié à un véhicule, on ne pilote rien.
 */
import { prisma } from '../db.js';
import { env } from '../env.js';
import { HttpError } from './http.js';

const BASE = 'https://connect.paj-gps.de/api/v1';
export const pajConfigured = () => !!(env.pajEmail && env.pajPassword);

let session: { token: string; expires: number } | null = null;
/** Tests : remplace la session (ou la vide). */
export function resetPajSessionForTests() { session = null; }

async function pajFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) throw Object.assign(new Error(typeof body?.error === 'string' ? body.error : `PAJ ${res.status}`), { status: res.status });
  return body;
}

async function login(): Promise<string> {
  if (!pajConfigured()) throw new HttpError(503, 'Le compte PAJ GPS n’est pas configuré sur le serveur.');
  const q = new URLSearchParams({ email: env.pajEmail, password: env.pajPassword });
  const body = await pajFetch(`/login?${q.toString()}`, { method: 'POST' }) as { success?: { token?: string; expires_in?: number }; error?: string } | null;
  const token = body?.success?.token;
  if (!token) throw new HttpError(502, `Connexion PAJ refusée${body?.error ? ` : ${body.error}` : ''}`);
  const ttl = Math.max(3600, (body?.success?.expires_in ?? 86_400) - 3600) * 1000;
  session = { token, expires: Date.now() + ttl };
  return token;
}

async function authed(path: string): Promise<unknown> {
  const token = session && session.expires > Date.now() ? session.token : await login();
  try {
    return await pajFetch(path, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if ((e as { status?: number }).status === 401) { session = null; return pajFetch(path, { headers: { Authorization: `Bearer ${await login()}` } }); }
    throw e;
  }
}

const arr = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v as Record<string, unknown>[] : [];
export interface PajDevice { id: string; name: string }
/** Traceurs du compte PAJ (pour les relier aux véhicules). Lecture tolérante : la forme exacte de la réponse n'est pas figée côté PAJ. */
export async function listPajDevices(): Promise<PajDevice[]> {
  const body = await authed('/device') as Record<string, unknown> | unknown[] | null;
  const rows = Array.isArray(body) ? arr(body) : arr((body as Record<string, unknown> | null)?.success ?? (body as Record<string, unknown> | null)?.data);
  return rows.map((d) => ({ id: String(d.id ?? d.device_id ?? ''), name: String(d.name ?? d.device_name ?? d.imei ?? d.id ?? '') })).filter((d) => d.id);
}

export interface PajPoint { lat: number; lng: number; at: Date; speed: number | null; battery: number | null }
export async function lastPajPoint(deviceId: string): Promise<PajPoint | null> {
  const body = await authed(`/trackerdata/${encodeURIComponent(deviceId)}/last_points?lastPoints=1&gps=1&wifi=0`) as { success?: unknown } | null;
  const p = arr(body?.success)[0];
  if (!p) return null;
  const lat = Number(p.lat), lng = Number(p.lng), unix = Number(p.dateunix);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(unix) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, at: new Date(unix * 1000), speed: p.speed != null && Number.isFinite(Number(p.speed)) ? Number(p.speed) : null, battery: p.battery != null && Number.isFinite(Number(p.battery)) ? Number(p.battery) : null };
}

/** Met à jour la dernière position connue de chaque véhicule relié à un traceur. Un échec sur un traceur n'arrête pas les autres. */
export async function syncVehiclePositions(): Promise<number> {
  if (!pajConfigured()) return 0;
  const vehicles = await prisma.vehicle.findMany({ where: { active: true, pajDeviceId: { not: null } }, select: { id: true, pajDeviceId: true } });
  let n = 0;
  for (const v of vehicles) {
    try {
      const p = await lastPajPoint(v.pajDeviceId!);
      if (!p) continue;
      await prisma.vehicle.update({ where: { id: v.id }, data: { lastLat: p.lat, lastLng: p.lng, lastSeenAt: p.at, lastSpeed: p.speed, lastBattery: p.battery } });
      n++;
    } catch (e) { console.error(`[paj] échec traceur ${v.pajDeviceId} :`, (e as Error).message); }
  }
  return n;
}
