import { formatDateBE } from '@/lib/ui';

export interface Vehicle { id: string; code: string | null; name: string | null; plate: string | null; brand: string | null; model: string | null; pajDeviceId: string | null; lastLat: number | null; lastLng: number | null; lastSeenAt: string | null; lastSpeed: number | null; lastBattery: number | null }
export interface Settings { enabled: boolean; radiusKm: number; maxPositionAgeMin: number; copyToSelf: boolean; testTo: string; subject: string; body: string }
export interface Arrival { eventId: string; worksiteRef: string; client: string; to: string | null; startAt: string; vehicle: string; km: number; minutes: number; blocked: string | null }
export interface Hist { id: string; status: string; toEmail: string | null; etaMinutes: number | null; sentAt: string | null; error: string | null; createdAt: string; event: { startAt: string; worksite: { ref: string; client: { name: string } | null } } | null }
export interface Site { id: string; ref: string; client: string | null; lat: number; lng: number; startAt: string; vehicleIds: string[] }
export interface Data { pajConfigured: boolean; emailConfigured: boolean; vehicles: Vehicle[]; sites: Site[]; settings: Settings; arrivals: Arrival[]; history: Hist[] }
export interface Device { id: string; name: string }
export interface DayStop { from: string; to: string | null; lat: number; lng: number }
export interface Day { points: number; lastSignalAt: string | null; stoppedSince: string | null; noMoveToday: boolean; firstMoveAt: string | null; km: number; track: [number, number][]; stops: DayStop[] }
export interface Visit { eventId: string; vehicleId: string; arrivedAt: string | null; leftAt: string | null }

export const label = (v: Vehicle) => [v.code, v.name ?? [v.brand, v.model].filter(Boolean).join(' '), v.plate].filter(Boolean).join(' · ') || 'Véhicule';
export const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : formatDateBE(iso); };
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
/** Durée entre deux instants (ou jusqu'à maintenant) : « 12 min », « 3 h 05 ». */
export const duration = (fromIso: string, toIso?: string | null) => {
  const m = Math.max(0, Math.round(((toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
