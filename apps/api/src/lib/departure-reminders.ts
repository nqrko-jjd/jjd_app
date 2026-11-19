/**
 * Rappel de départ avant une intervention (notification sur le téléphone de l'ouvrier) : « partez maintenant » quand l'heure actuelle
 * + le trajet estimé + une marge atteint l'heure de début ; « risque de retard » si c'est déjà dépassé.
 * Version SANS circulation : durée de route libre (OSRM, à défaut une estimation à vol d'oiseau), majorée de 20 %.
 * Point de départ : position GPS récente du véhicule de l'intervention, sinon le chantier précédent de la journée ; sans point
 * de départ connu : heure de départ du dépôt si elle est planifiée, sinon un simple rappel 45 min avant.
 * Désactivé tant que le réglage `departureReminders` n'est pas activé (aucun schéma ajouté : réglage + liste des envois dans `Setting`).
 */
import { prisma } from '../db.js';
import { STAFF } from './auth.js';
import { distanceKm } from './arrival-notices.js';
import { notifyMobile } from './native-push.js';

const SETTINGS_KEY = 'departureReminders';
const SENT_KEY = 'departureRemindersSent';

export const MARGIN_MIN = 10; // marge de sécurité ajoutée au trajet
export const HEADS_UP_MIN = 45; // rappel simple quand le trajet est inconnu
export const DEPOT_LEAD_MIN = 15; // rappel avant l'heure de départ du dépôt
export const LATE_GRACE_MIN = 10; // on ne prévient plus passé ce délai après l'heure de début
export const TRAFFIC_CUSHION = 1.2; // coussin sur la durée « route libre »
const VEHICLE_FRESH_MIN = 20; // position du véhicule considérée récente
const ARRIVED_KM = 0.3; // déjà sur place : aucun rappel
const WINDOW_AHEAD_MIN = 180; // on ne regarde que les interventions des 3 prochaines heures

export type ReminderKind = 'leave' | 'late' | 'depot' | 'heads-up';
export interface ReminderPlan { due: boolean; kind: ReminderKind; remindAt: Date }

const min = (n: number) => n * 60_000;

/** Partie pure (testable) : faut-il prévenir maintenant, et avec quel message ? */
export function planReminder(i: { now: Date; start: Date; travelMin: number | null; departureAt: Date | null; hasPrevious: boolean }): ReminderPlan {
  const t = i.now.getTime();
  const start = i.start.getTime();
  if (i.travelMin != null) {
    const leaveBy = start - min(i.travelMin + MARGIN_MIN);
    const lateBy = start - min(i.travelMin);
    return { due: t >= leaveBy && t <= start + min(LATE_GRACE_MIN), kind: t >= lateBy ? 'late' : 'leave', remindAt: new Date(leaveBy) };
  }
  if (i.departureAt && !i.hasPrevious) {
    const at = i.departureAt.getTime() - min(DEPOT_LEAD_MIN);
    return { due: t >= at && t <= i.departureAt.getTime() + min(LATE_GRACE_MIN), kind: 'depot', remindAt: new Date(at) };
  }
  const at = start - min(HEADS_UP_MIN);
  return { due: t >= at && t <= start, kind: 'heads-up', remindAt: new Date(at) };
}

export function reminderText(kind: ReminderKind, startLabel: string, travelMin: number | null, departureLabel?: string): { title: string; body: string } {
  switch (kind) {
    case 'leave': return { title: 'Heure de partir', body: `Prochaine intervention à ${startLabel} : partez maintenant (trajet estimé ${travelMin} min).` };
    case 'late': return { title: 'Risque de retard', body: `Prochaine intervention à ${startLabel} : le trajet estimé (${travelMin} min) dépasse le temps restant.` };
    case 'depot': return { title: 'Départ bientôt', body: `Départ prévu à ${departureLabel ?? startLabel}. Intervention à ${startLabel}.` };
    default: return { title: 'Prochaine intervention', body: `Intervention à ${startLabel}, dans environ ${HEADS_UP_MIN} min.` };
  }
}

const fmtTime = (d: Date) => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).replace(':', 'h');
const brusselsDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });

/* ------------------------------------------------------------------ trajet */

const routeCache = new Map<string, { min: number; at: number }>();
type Pt = { lat: number; lng: number };

async function osrmMinutes(a: Pt, b: Pt): Promise<number | null> {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, {
      headers: { 'User-Agent': 'JJD-App/1.0 (info@jjd-consult.be)' }, signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const d = ((await r.json()) as { routes?: { duration: number }[] }).routes?.[0]?.duration;
    return typeof d === 'number' ? d / 60 : null;
  } catch { return null; }
}

/** Minutes de trajet (route libre × coussin). À défaut d'OSRM : vol d'oiseau × 1,35 à 45 km/h de moyenne. */
export async function travelMinutes(a: Pt, b: Pt): Promise<number> {
  const key = [a.lat, a.lng, b.lat, b.lng].map((x) => x.toFixed(4)).join(',');
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.min;
  const raw = (await osrmMinutes(a, b)) ?? (distanceKm(a, b) * 1.35 / 45) * 60;
  const out = Math.max(5, Math.round((raw * TRAFFIC_CUSHION) / 5) * 5);
  routeCache.set(key, { min: out, at: Date.now() });
  return out;
}

/* --------------------------------------------------------------- réglages */

export interface ReminderSettings { enabled: boolean; onlyEmails: string[] }
export async function getReminderSettings(): Promise<ReminderSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const v = (row?.value ?? {}) as Partial<ReminderSettings>;
  return { enabled: v.enabled === true, onlyEmails: Array.isArray(v.onlyEmails) ? v.onlyEmails.map((e) => String(e).toLowerCase()) : [] };
}
export async function saveReminderSettings(s: ReminderSettings): Promise<void> {
  const value = { enabled: !!s.enabled, onlyEmails: s.onlyEmails.map((e) => e.trim().toLowerCase()).filter(Boolean) };
  await prisma.setting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
}

async function getSent(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: SENT_KEY } });
  const raw = (row?.value ?? {}) as Record<string, string>;
  const cutoff = Date.now() - 36 * 3600_000;
  return Object.fromEntries(Object.entries(raw).filter(([, iso]) => new Date(iso).getTime() > cutoff));
}

/* ---------------------------------------------------------------- calcul */

export interface ReminderCandidate {
  key: string; eventId: string; personId: string; person: string; userIds: string[]; worksiteRef: string; startAt: Date;
  origin: string; travelMin: number | null; plan: ReminderPlan; title: string; body: string; skipped: string | null; alreadySent: boolean;
}

/** Toutes les interventions des 3 prochaines heures et le rappel qui s'applique à chaque personne affectée (sans rien envoyer). */
export async function computeReminders(now = new Date(), opts: { ignoreSettingsFilter?: boolean } = {}): Promise<ReminderCandidate[]> {
  const settings = await getReminderSettings();
  const events = await prisma.planningEvent.findMany({
    where: {
      allDay: false, status: 'confirmed', kind: { in: ['intervention', 'meeting'] },
      startAt: { gte: new Date(now.getTime() - min(LATE_GRACE_MIN)), lte: new Date(now.getTime() + min(WINDOW_AHEAD_MIN)) },
    },
    include: {
      worksite: { select: { ref: true, lat: true, lng: true } },
      assignments: { select: { personId: true } },
      vehicles: { include: { vehicle: { select: { lastLat: true, lastLng: true, lastSeenAt: true } } } },
    },
    orderBy: { startAt: 'asc' },
  });
  if (!events.length) return [];

  const personIds = [...new Set(events.flatMap((e) => [...e.assignments.map((a) => a.personId), e.leadPersonId, e.driverPersonId].filter((x): x is string => !!x)))];
  const users = await prisma.user.findMany({ where: { active: true, role: { in: STAFF }, personId: { in: personIds } }, select: { id: true, email: true, personId: true, person: { select: { displayName: true, firstName: true } } } });
  const sent = await getSent();

  // chantier précédent de la journée, par personne
  const earliest = new Date(Math.min(...events.map((e) => e.startAt.getTime())) - 12 * 3600_000);
  const prevEvents = await prisma.planningEvent.findMany({
    where: { allDay: false, status: 'confirmed', endAt: { gte: earliest, lte: new Date(Math.max(...events.map((e) => e.startAt.getTime()))) }, assignments: { some: { personId: { in: personIds } } } },
    include: { worksite: { select: { ref: true, lat: true, lng: true } }, assignments: { select: { personId: true } } },
  });
  // absences couvrant le jour
  const days = [...new Set(events.map((e) => brusselsDay(e.startAt)))];
  const absences = await prisma.absence.findMany({ where: { personId: { in: personIds }, startsOn: { lte: new Date(`${days[days.length - 1]}T00:00:00.000Z`) }, endsOn: { gte: new Date(`${days[0]}T00:00:00.000Z`) } }, select: { personId: true, startsOn: true, endsOn: true } });

  const out: ReminderCandidate[] = [];
  for (const e of events) {
    const target = e.worksite.lat != null && e.worksite.lng != null && (e.kind === 'intervention' || e.meetingOnSite) ? { lat: e.worksite.lat, lng: e.worksite.lng } : null;
    const day = brusselsDay(e.startAt);
    const persons = [...new Set([...e.assignments.map((a) => a.personId), e.leadPersonId, e.driverPersonId].filter((x): x is string => !!x))];
    const fresh = e.vehicles.map((l) => l.vehicle).find((v) => v.lastLat != null && v.lastLng != null && v.lastSeenAt && now.getTime() - v.lastSeenAt.getTime() <= min(VEHICLE_FRESH_MIN));
    for (const pid of persons) {
      const us = users.filter((u) => u.personId === pid && (opts.ignoreSettingsFilter || !settings.onlyEmails.length || settings.onlyEmails.includes(u.email.toLowerCase())));
      if (!us.length) continue;
      const key = `${e.id}:${pid}`;
      const person = us[0]!.person?.displayName ?? us[0]!.person?.firstName ?? pid;
      const base = { key, eventId: e.id, personId: pid, person, userIds: us.map((u) => u.id), worksiteRef: e.worksite.ref, startAt: e.startAt, alreadySent: !!sent[key] };
      const absent = absences.some((a) => a.personId === pid && a.startsOn.toISOString().slice(0, 10) <= day && a.endsOn.toISOString().slice(0, 10) >= day);

      // point de départ : véhicule (position récente), sinon chantier précédent du même jour
      const prev = prevEvents
        .filter((p) => p.id !== e.id && p.endAt <= e.startAt && brusselsDay(p.endAt) === day && p.assignments.some((a) => a.personId === pid) && p.worksite.lat != null)
        .sort((a, b) => b.endAt.getTime() - a.endAt.getTime())[0];
      let from: Pt | null = null; let origin = 'inconnu';
      if (fresh) { from = { lat: fresh.lastLat!, lng: fresh.lastLng! }; origin = 'véhicule (GPS)'; }
      else if (prev) { from = { lat: prev.worksite.lat!, lng: prev.worksite.lng! }; origin = `chantier précédent ${prev.worksite.ref}`; }

      let skipped: string | null = absent ? 'absent ce jour-là' : null;
      if (!skipped && from && target && distanceKm(from, target) <= ARRIVED_KM) skipped = 'déjà sur place';
      const travelMin = !skipped && from && target ? await travelMinutes(from, target) : null;
      const plan = planReminder({ now, start: e.startAt, travelMin, departureAt: e.departureAt, hasPrevious: !!prev });
      const text = reminderText(plan.kind, fmtTime(e.startAt), travelMin, e.departureAt ? fmtTime(e.departureAt) : undefined);
      out.push({ ...base, origin, travelMin, plan, skipped, ...text });
    }
  }
  return out;
}

/** À appeler toutes les ~2 min : envoie les rappels dus, une seule fois par intervention et par personne. Renvoie le nombre d'envois. */
export async function runDepartureReminders(now = new Date()): Promise<number> {
  const settings = await getReminderSettings();
  if (!settings.enabled) return 0;
  const due = (await computeReminders(now)).filter((c) => c.plan.due && !c.alreadySent && !c.skipped);
  if (!due.length) return 0;
  const sent = await getSent();
  for (const c of due) {
    try { await notifyMobile(c.userIds, '/planning', c.title, c.body, 'departure'); } catch { continue; }
    sent[c.key] = now.toISOString();
  }
  await prisma.setting.upsert({ where: { key: SENT_KEY }, create: { key: SENT_KEY, value: sent }, update: { value: sent } });
  return due.length;
}
