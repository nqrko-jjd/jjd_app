/**
 * Avis d'arrivée au client : quand le véhicule affecté à une intervention du jour est à moins de X km du chantier, le client reçoit un e-mail
 * « notre équipe arrive d'ici ~N minutes ». Jamais de position ni de trajet, une seule fois par intervention. Désactivé par défaut ;
 * « adresse de test » = tous les e-mails vont à cette adresse (pour essayer sans prévenir les clients).
 */
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import { emailConfigured, sendEmailWithPdf } from './doc-mail.js';
import { getCompany } from './documents.js';
import { fillTemplate } from './reminders.js';

export interface ArrivalSettings { enabled: boolean; radiusKm: number; maxPositionAgeMin: number; copyToSelf: boolean; testTo: string; subject: string; body: string }
export const DEFAULT_ARRIVAL_SETTINGS: ArrivalSettings = {
  enabled: false, radiusKm: 5, maxPositionAgeMin: 10, copyToSelf: true, testTo: '',
  subject: 'Notre équipe arrive{chantier}',
  body: 'Bonjour,\n\nNotre équipe JJD Consult est en route{chantier} et devrait arriver d’ici environ {minutes} minutes.\n\nSi vous n’êtes pas disponible, ou si l’accès nécessite une précision, appelez-nous au {telephone}.\n\nÀ tout de suite,\n{societe}',
};
const KEY = 'arrivalNotices';
export async function getArrivalSettings(): Promise<ArrivalSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { ...DEFAULT_ARRIVAL_SETTINGS, ...((row?.value ?? {}) as Partial<ArrivalSettings>) };
}
export async function saveArrivalSettings(i: ArrivalSettings): Promise<ArrivalSettings> {
  const testTo = String(i.testTo ?? '').trim();
  if (testTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo)) throw new HttpError(422, 'Adresse de test invalide.');
  const clean: ArrivalSettings = {
    enabled: !!i.enabled, radiusKm: Math.min(30, Math.max(1, Number(i.radiusKm) || 5)), maxPositionAgeMin: Math.min(60, Math.max(2, Math.round(Number(i.maxPositionAgeMin) || 10))),
    copyToSelf: !!i.copyToSelf, testTo, subject: String(i.subject).slice(0, 200), body: String(i.body).slice(0, 4000),
  };
  if (!clean.subject.trim() || !clean.body.trim()) throw new HttpError(422, 'L’objet et le texte sont obligatoires.');
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: clean as never }, update: { value: clean as never } });
  return clean;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** ~27 km/h de moyenne en ville, arrondi aux 5 minutes (jamais moins de 5). */
export const etaMinutes = (km: number) => Math.max(5, Math.round(km / 0.45 / 5) * 5);

export interface ArrivalCandidate { eventId: string; worksiteRef: string; client: string; to: string | null; startAt: Date; vehicle: string; km: number; minutes: number; subject: string; body: string; blocked: string | null }

export async function computeArrivals(now = new Date()): Promise<ArrivalCandidate[]> {
  const s = await getArrivalSettings();
  const company = await getCompany();
  const events = await prisma.planningEvent.findMany({
    where: {
      kind: 'intervention', status: 'confirmed', startAt: { gte: new Date(now.getTime() - 60 * 60_000), lte: new Date(now.getTime() + 90 * 60_000) },
      vehicles: { some: {} }, worksite: { lat: { not: null }, lng: { not: null } },
    },
    include: { worksite: { select: { ref: true, lat: true, lng: true, client: { select: { name: true, email: true, reminderMode: true } } } }, vehicles: { include: { vehicle: true } } },
    orderBy: { startAt: 'asc' },
  });
  if (!events.length) return [];
  const done = new Set((await prisma.arrivalNotice.findMany({ where: { eventId: { in: events.map((e) => e.id) } }, select: { eventId: true } })).map((d) => d.eventId));
  const out: ArrivalCandidate[] = [];
  for (const e of events) {
    if (done.has(e.id) || e.worksite.client?.reminderMode === 'off') continue;
    const target = { lat: e.worksite.lat!, lng: e.worksite.lng! };
    const near = e.vehicles
      .filter((l) => l.vehicle.lastLat != null && l.vehicle.lastLng != null && l.vehicle.lastSeenAt && now.getTime() - l.vehicle.lastSeenAt.getTime() <= s.maxPositionAgeMin * 60_000)
      .map((l) => ({ v: l.vehicle, km: distanceKm({ lat: l.vehicle.lastLat!, lng: l.vehicle.lastLng! }, target) }))
      .sort((a, b) => a.km - b.km)[0];
    if (!near || near.km > s.radiusKm) continue;
    const minutes = etaMinutes(near.km);
    const vars = { client: e.worksite.client?.name ?? '', minutes: String(minutes), chantier: ` (chantier ${e.worksite.ref})`, societe: company.name, telephone: company.phone ?? '', heure: e.startAt.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) };
    const to = s.testTo || e.worksite.client?.email || null;
    out.push({
      eventId: e.id, worksiteRef: e.worksite.ref, client: e.worksite.client?.name ?? '—', to, startAt: e.startAt, vehicle: near.v.name ?? near.v.plate ?? near.v.code ?? 'Véhicule', km: Math.round(near.km * 10) / 10, minutes,
      subject: fillTemplate(s.subject, vars), body: fillTemplate(s.body, vars).replace(/\n{3,}/g, '\n\n').trimEnd(), blocked: to ? null : 'Aucune adresse e-mail pour ce client',
    });
  }
  return out;
}

/** Envoie les avis d'arrivée dus. Un seul essai par intervention (même en cas d'échec : on ne harcèle pas le client). */
export async function runArrivalNotices(now = new Date()): Promise<number> {
  const s = await getArrivalSettings();
  if (!s.enabled || !emailConfigured()) return 0;
  let sent = 0;
  for (const c of (await computeArrivals(now)).filter((x) => !x.blocked)) {
    const claimed = await prisma.arrivalNotice.createMany({ data: [{ eventId: c.eventId, toEmail: c.to, etaMinutes: c.minutes, status: 'sent' }] }).catch(() => ({ count: 0 }));
    if (!claimed.count) continue;
    try {
      await sendEmailWithPdf({ to: [c.to!], subject: c.subject, message: c.body, copyToSelf: s.copyToSelf }, { buffer: Buffer.alloc(0), filename: '' }, true);
      await prisma.arrivalNotice.update({ where: { eventId: c.eventId }, data: { sentAt: new Date() } });
      sent++;
    } catch (e) {
      await prisma.arrivalNotice.update({ where: { eventId: c.eventId }, data: { status: 'failed', error: (e as Error).message.slice(0, 300) } });
    }
  }
  return sent;
}
