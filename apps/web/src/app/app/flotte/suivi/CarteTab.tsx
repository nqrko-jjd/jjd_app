'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { BatteryMedium, Gauge, MapPin, Moon, Navigation, Route, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { SkeletonRows } from '@/components/States';
import type { MapSite, MapStop, MapVehicle } from '@/components/FleetMap';
import { ago, duration, hhmm, label, type Data, type Day, type Site, type Vehicle, type Visit } from './types';

const FleetMap = dynamic(() => import('@/components/FleetMap'), { ssr: false, loading: () => <SkeletonRows /> });

type VState = 'moving' | 'parked' | 'sleep';
const STALE_MS = 30 * 60_000;
const SITE_RADIUS_KM = 0.2;
const PILL: Record<VState, string> = { moving: 'En route', parked: 'À l’arrêt', sleep: 'En veille' };

const vState = (v: Vehicle, now: number): VState => {
  if (now - new Date(v.lastSeenAt!).getTime() > STALE_MS) return 'sleep';
  return v.lastSpeed != null && v.lastSpeed > 2 ? 'moving' : 'parked';
};
const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** État d'un chantier du jour d'après l'historique des véhicules : à l'heure, en retard, sur place, reparti… */
function siteStatus(site: Site, visits: Visit[], tracked: Set<string>, now: number): { tone: 'ok' | 'warn' | 'plain'; text: string; sub: string | null } {
  const start = new Date(site.startAt).getTime();
  const arrived = visits.find((x) => x.eventId === site.id && x.arrivedAt);
  if (arrived?.arrivedAt) {
    const late = Math.round((new Date(arrived.arrivedAt).getTime() - start) / 60_000);
    const gap = late > 5 ? `${late} min de retard` : late < -5 ? `${-late} min d’avance` : 'à l’heure';
    return { tone: late > 5 ? 'warn' : 'ok', text: arrived.leftAt ? `Reparti à ${hhmm(arrived.leftAt)}` : 'Sur place', sub: `Arrivé à ${hhmm(arrived.arrivedAt)} · ${gap}` };
  }
  if (!site.vehicleIds.some((id) => tracked.has(id))) return { tone: 'plain', text: 'Sans traceur', sub: null };
  if (start > now) return { tone: 'plain', text: `Dans ${duration(new Date(now).toISOString(), site.startAt)}`, sub: 'Pas encore arrivé' };
  return { tone: 'warn', text: 'Pas encore arrivé', sub: `Prévu à ${hhmm(site.startAt)}` };
}

/** Onglet « Carte » du suivi GPS : carte + liste des véhicules (état en un coup d'œil, journée détaillée au clic) + chantiers du jour avec leur heure d'arrivée. */
export default function CarteTab({ data, onGoTraceurs }: { data: Data; onGoTraceurs: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number; n: number } | null>(null);
  const [day, setDay] = useState<{ id: string; d: Day } | null>(null);
  const [dayErr, setDayErr] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const tracked = useMemo(() => data.vehicles.filter((v) => v.pajDeviceId && v.lastLat != null && v.lastLng != null && v.lastSeenAt), [data]);
  const trackedIds = useMemo(() => new Set(tracked.map((v) => v.id)), [tracked]);
  const sites = useMemo(() => [...data.sites].sort((a, b) => a.startAt.localeCompare(b.startAt)), [data]);
  const selected = tracked.find((v) => v.id === sel) ?? null;

  // journée du véhicule sélectionné (arrêts, km, parcours) : lue à la demande chez le fournisseur du traceur
  useEffect(() => {
    if (!selected) { setDay(null); setDayErr(null); return; }
    const id = selected.id;
    let off = false;
    const load = () => api<Day>(`/api/gps/vehicles/${id}/day`).then((d) => { if (!off) { setDay({ id, d }); setDayErr(null); } }).catch((e) => { if (!off) setDayErr((e as Error).message); });
    load();
    const t = setInterval(load, 60_000);
    return () => { off = true; clearInterval(t); };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // heures d'arrivée / de départ sur les chantiers du jour
  const hasSites = sites.length > 0;
  useEffect(() => {
    if (!hasSites) return;
    let off = false;
    const load = () => api<{ arrivals: Visit[] }>('/api/gps/day-arrivals').then((r) => { if (!off) setVisits(r.arrivals); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { off = true; clearInterval(t); };
  }, [hasSites]);

  const mapVehicles = useMemo<MapVehicle[]>(() => tracked.map((v) => ({
    id: v.id, label: label(v), lat: v.lastLat!, lng: v.lastLng!, seenAgo: ago(v.lastSeenAt!), speed: v.lastSpeed, stale: vState(v, now) === 'sleep',
  })), [tracked, now]);
  const mapSites = useMemo<MapSite[]>(() => sites.map((x) => ({ id: x.id, label: `${x.ref}${x.client ? ` · ${x.client}` : ''} · ${hhmm(x.startAt)}`, lat: x.lat, lng: x.lng, vehicleIds: x.vehicleIds })), [sites]);

  const d = day && day.id === sel ? day.d : null;
  const siteAt = (p: { lat: number; lng: number }) => sites.find((x) => distKm(x, p) <= SITE_RADIUS_KM) ?? null;
  const stopLabel = (p: { lat: number; lng: number }) => { const s = siteAt(p); return s ? `${s.ref}${s.client ? ` · ${s.client}` : ''}` : 'Arrêt'; };
  const mapStops = useMemo<MapStop[] | null>(() => d?.stops.map((s) => ({ lat: s.lat, lng: s.lng, label: `${hhmm(s.from)} · ${stopLabel(s)}` })) ?? null, [d, sites]); // eslint-disable-line react-hooks/exhaustive-deps

  const fly = (p: { lat: number; lng: number }) => setPoint({ lat: p.lat, lng: p.lng, n: Date.now() });
  const pickVehicle = (v: Vehicle) => { if (sel === v.id) { setSel(null); return; } setSel(v.id); fly({ lat: v.lastLat!, lng: v.lastLng! }); };
  const pickSite = (x: Site) => {
    const v = x.vehicleIds.map((id) => tracked.find((t) => t.id === id)).find(Boolean);
    if (v) setSel(v.id);
    fly(x);
  };

  const counts = { moving: 0, parked: 0, sleep: 0 };
  for (const v of tracked) counts[vState(v, now)]++;

  return (
    <div className="gps-layout">
      <FleetMap vehicles={mapVehicles} sites={mapSites} selectedId={sel} track={d?.track ?? null} stops={mapStops} focusPoint={point} />

      <aside className="gps-side" aria-label="Véhicules et chantiers du jour">
        {tracked.length > 0 && (
          <div className="gps-stats" role="status">
            <span className="gps-chip moving"><i />{counts.moving} en route</span>
            <span className="gps-chip parked"><i />{counts.parked} à l’arrêt</span>
            {counts.sleep > 0 && <span className="gps-chip sleep"><i />{counts.sleep} en veille</span>}
          </div>
        )}

        <section>
          <h3 className="gps-h">Véhicules</h3>
          {tracked.length === 0 && (
            <div className="gps-empty">
              <Truck size={22} aria-hidden />
              <strong>Aucune position pour l’instant</strong>
              <span>Reliez un véhicule à son traceur pour le voir apparaître ici.</span>
              <button type="button" className="btn" onClick={onGoTraceurs}>Relier un traceur</button>
            </div>
          )}
          <div className="gps-stack">
            {tracked.map((v) => {
              const st = vState(v, now);
              const next = sites.find((x) => x.vehicleIds.includes(v.id) && new Date(x.startAt).getTime() > now - 3_600_000);
              const open = sel === v.id;
              return (
                <div key={v.id} className={`gps-veh-wrap${open ? ' open' : ''}`}>
                  <button type="button" className={`gps-veh ${st}`} aria-pressed={open} onClick={() => pickVehicle(v)}>
                    <span className="gps-veh-ic"><Truck size={18} aria-hidden /></span>
                    <span className="gps-veh-body">
                      <strong>{label(v)}</strong>
                      <span>{st === 'moving' ? `${Math.round(v.lastSpeed!)} km/h · signal ${ago(v.lastSeenAt!)}` : st === 'parked' ? `Signal ${ago(v.lastSeenAt!)}` : `Dernier signal à ${hhmm(v.lastSeenAt!)} (${ago(v.lastSeenAt!)})`}</span>
                      {next && !open && <span className="gps-veh-next">Prochain chantier : {next.ref} à {hhmm(next.startAt)}</span>}
                    </span>
                    <span className={`gps-pill ${st}`}>{PILL[st]}</span>
                  </button>

                  {open && (
                    <div className="gps-detail">
                      {d ? (
                        <>
                          <p className="gps-lead">
                            {st === 'moving' ? <>En route à <strong>{Math.round(v.lastSpeed!)} km/h</strong></>
                              : d.stoppedSince ? (d.noMoveToday ? <>N’a <strong>pas bougé aujourd’hui</strong> · immobile depuis {hhmm(d.stoppedSince)}</> : <>À l’arrêt depuis <strong>{hhmm(d.stoppedSince)}</strong> · {duration(d.stoppedSince)}</>)
                              : <>Position du <strong>{hhmm(v.lastSeenAt!)}</strong></>}
                          </p>
                          <div className="gps-kpis">
                            <div className="gps-kpi"><Route size={15} aria-hidden /><b>{d.km.toLocaleString('fr-BE')} km</b><span>aujourd’hui</span></div>
                            <div className="gps-kpi"><Navigation size={15} aria-hidden /><b>{d.firstMoveAt ? hhmm(d.firstMoveAt) : '—'}</b><span>premier départ</span></div>
                            <div className="gps-kpi"><BatteryMedium size={15} aria-hidden /><b>{v.lastBattery != null ? `${Math.round(v.lastBattery)} %` : '—'}</b><span>batterie</span></div>
                          </div>
                          {st === 'sleep' && <p className="gps-hint"><Moon size={14} aria-hidden /> Le traceur se met en veille quand le véhicule reste immobile : pas de nouveau signal, c’est normal.</p>}
                          <h4 className="gps-h2">Arrêts de la journée</h4>
                          {d.stops.length === 0 ? <p className="gps-hint">Aucun arrêt de plus de 5 minutes pour l’instant.</p> : (
                            <ol className="gps-tl">
                              {d.stops.map((s, i) => {
                                const site = siteAt(s);
                                return (
                                  <li key={s.from}>
                                    <button type="button" onClick={() => fly(s)}>
                                      <span className={`gps-tl-n${site ? ' site' : ''}`}>{i + 1}</span>
                                      <span className="gps-tl-body">
                                        <strong>{stopLabel(s)}</strong>
                                        <span>{s.to ? `${hhmm(s.from)} → ${hhmm(s.to)}` : `Depuis ${hhmm(s.from)} · en cours`}</span>
                                      </span>
                                      <span className="gps-tl-dur">{duration(s.from, s.to)}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </>
                      ) : dayErr ? <p className="gps-hint err">Détail indisponible : {dayErr}</p> : <SkeletonRows />}
                      <a className="gps-link" href={`https://www.google.com/maps?q=${v.lastLat},${v.lastLng}`} target="_blank" rel="noreferrer"><MapPin size={14} aria-hidden /> Ouvrir dans Google Maps</a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="gps-h">Chantiers du jour</h3>
          {sites.length === 0 ? <p className="gps-hint">Aucune intervention planifiée avec un véhicule aujourd’hui.</p> : (
            <div className="gps-stack">
              {sites.map((x) => {
                const s = siteStatus(x, visits, trackedIds, now);
                const vehicles = x.vehicleIds.map((id) => data.vehicles.find((v) => v.id === id)).filter((v): v is Vehicle => !!v);
                return (
                  <button key={x.id} type="button" className="gps-site" onClick={() => pickSite(x)}>
                    <span className="gps-site-time">{hhmm(x.startAt)}</span>
                    <span className="gps-site-body">
                      <strong>{x.ref}{x.client ? ` · ${x.client}` : ''}</strong>
                      <span>{vehicles.length ? vehicles.map(label).join(', ') : 'Aucun véhicule'}</span>
                      {s.sub && <span className="gps-site-sub">{s.sub}</span>}
                    </span>
                    <span className={`gps-pill ${s.tone}`}>{s.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <p className="gps-foot"><Gauge size={13} aria-hidden /> Positions mises à jour automatiquement. « En veille » : aucun signal depuis plus de 30 minutes.</p>
      </aside>
    </div>
  );
}
