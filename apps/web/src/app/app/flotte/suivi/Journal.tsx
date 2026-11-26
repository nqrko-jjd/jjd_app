'use client';
import { dateLocale } from '@/lib/ui-language';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Navigation, Pause, Play, Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { SkeletonRows } from '@/components/States';
import type { MapFocus, MapJourney, MapReplay } from '@/components/FleetMap';
import { hhmm } from './types';

export interface JStop { type: 'stop'; from: string; to: string | null; minutes: number; lat: number; lng: number; label: string | null; worksite: string | null }
export interface JTrip { type: 'trip'; from: string; to: string; minutes: number; km: number; maxSpeed: number; avgSpeed: number; start: { lat: number; lng: number }; end: { lat: number; lng: number }; startPlace: string | null; endPlace: string | null }
export interface Journey {
  date: string;
  summary: { km: number; driveMinutes: number; stopMinutes: number; maxSpeed: number; firstMoveAt: string | null; lastSignalAt: string | null };
  segments: (JStop | JTrip)[];
  points: [number, number, number, number][];
}

const LONG_STOP_MIN = 60;
const LIVE_MS = 20_000;
const RATES = [{ label: '×1', rate: 60 }, { label: '×5', rate: 300 }, { label: '×15', rate: 900 }];
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);
const km1 = (n: number) => `${n.toFixed(1).replace('.', ',')} km`;
const dkey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clock = (sec: number) => new Date(sec * 1000).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
const parseKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const idxAt = (pts: Journey['points'], t: number) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m][2] <= t) lo = m; else hi = m - 1; } return lo; };

/** État du journal + du rejeu pour un véhicule : lecture du jour choisi, suivi en direct (20 s), lecteur animé. */
export function useJournal(vehicleId: string | null, visible: boolean) {
  const [dayKey, setDayKey] = useState(() => dkey(new Date()));
  const [data, setData] = useState<{ id: string; key: string; j: Journey } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rateIdx, setRateIdx] = useState(0);
  const [vt, setVt] = useState(0);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const vtRef = useRef(0);
  const todayKey = dkey(new Date());
  const isToday = dayKey === todayKey;
  const j = data && data.id === vehicleId && data.key === dayKey ? data.j : null;
  const pts = j?.points;

  // un autre véhicule : on repart d'aujourd'hui, sans direct
  useEffect(() => { setDayKey(dkey(new Date())); setLive(false); setPlaying(false); setErr(null); }, [vehicleId]);
  useEffect(() => { if (!isToday) setLive(false); }, [isToday]);

  const load = useCallback((silent: boolean) => {
    if (!vehicleId) return Promise.resolve();
    if (!silent) { setData(null); setErr(null); setPlaying(false); }
    return api<Journey>(`/api/gps/vehicles/${vehicleId}/journey?date=${dayKey}`)
      .then((r) => {
        setData({ id: vehicleId, key: dayKey, j: r }); setErr(null);
        if (!silent) {
          const p = r.points;
          setFocus(p.length > 1 ? { a: [Math.min(...p.map((x) => x[0])), Math.min(...p.map((x) => x[1]))], b: [Math.max(...p.map((x) => x[0])), Math.max(...p.map((x) => x[1]))], n: Date.now() } : null);
        }
      })
      .catch((e) => { if (!silent) setErr((e as Error).message); });
  }, [vehicleId, dayKey]);
  useEffect(() => { void load(false); }, [load]);

  // suivi en direct : relecture toutes les 20 s (suspendue tant que l'onglet est masqué)
  useEffect(() => {
    if (!live || !isToday || !vehicleId || !visible) return;
    const t = setInterval(() => { if (!document.hidden) void load(true); }, LIVE_MS);
    return () => clearInterval(t);
  }, [live, isToday, vehicleId, visible, load]);

  // curseur : début de journée, ou dernière position en direct
  useEffect(() => {
    if (!pts || pts.length === 0) return;
    const first = pts[0][2], last = pts[pts.length - 1][2];
    if (live && isToday) { vtRef.current = last; setVt(last); setPlaying(false); }
    else if (vtRef.current < first || vtRef.current > last) { vtRef.current = first; setVt(first); }
  }, [pts, live, isToday]);

  // lecture : requestAnimationFrame, état publié ~15 fois par seconde ; coupée si l'onglet est masqué ou le composant démonté
  useEffect(() => {
    if (!playing || !pts || pts.length < 2 || !visible) return;
    const end = pts[pts.length - 1][2];
    const rate = RATES[rateIdx].rate;
    if (vtRef.current >= end - 1) vtRef.current = pts[0][2];
    let raf = 0, last = performance.now(), pub = 0;
    const frame = (ts: number) => {
      if (document.hidden) { setPlaying(false); return; }
      vtRef.current = Math.min(end, vtRef.current + ((ts - last) / 1000) * rate); last = ts;
      if (ts - pub > 66 || vtRef.current >= end) { pub = ts; setVt(vtRef.current); }
      if (vtRef.current >= end) { setPlaying(false); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [playing, pts, rateIdx, visible]);

  const mapJourney = useMemo<MapJourney | null>(() => j && j.points.length > 0 ? {
    points: j.points.map((p) => [p[0], p[1]] as [number, number]),
    stops: j.segments.filter((s): s is JStop => s.type === 'stop').map((s) => ({ lat: s.lat, lng: s.lng, long: s.minutes >= LONG_STOP_MIN, label: `${hhmm(s.from)} → ${s.to ? hhmm(s.to) : 'maintenant'} · ${dur(s.minutes)}${s.label ? ` · ${s.label}` : ''}` })),
  } : null, [j]);

  const cursor = useMemo(() => {
    if (!pts || pts.length === 0) return null;
    const i = idxAt(pts, vt), a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const f = b[2] > a[2] ? Math.min(1, Math.max(0, (vt - a[2]) / (b[2] - a[2]))) : 0;
    return { i, lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, t: Math.min(Math.max(vt, a[2]), pts[pts.length - 1][2]), speed: a[3] };
  }, [pts, vt]);
  const replay = useMemo<MapReplay | null>(() => cursor ? { lat: cursor.lat, lng: cursor.lng, idx: cursor.i, playing } : null, [cursor, playing]);

  const seek = (i: number) => { if (!pts) return; setPlaying(false); vtRef.current = pts[i][2]; setVt(pts[i][2]); };
  const shift = (n: number) => { const d = parseKey(dayKey); d.setDate(d.getDate() + n); const k = dkey(d); if (k <= dkey(new Date())) setDayKey(k); };
  const changeDay = (k: string) => { setPlaying(false); setDayKey(k); };
  const focusOn = (a: { lat: number; lng: number }, b?: { lat: number; lng: number }) => setFocus({ a: [a.lat, a.lng], b: b ? [b.lat, b.lng] : null, n: Date.now() });

  return { dayKey, changeDay, todayKey, isToday, shift, j, err, live, setLive, playing, setPlaying, rateIdx, setRateIdx, cursor, replay, mapJourney, seek, focus, focusOn, reload: () => load(false) };
}
export type JournalState = ReturnType<typeof useJournal>;

/** Panneau « Trajets » : sélecteur de jour, chiffres, lecteur de rejeu et déroulé chronologique. */
export function JournalPanel({ s }: { s: JournalState }) {
  const { j, err, isToday, dayKey, todayKey } = s;
  const yesterday = dkey(new Date(Date.now() - 86_400_000));
  let stopNo = 0;
  return (
    <div className="gps-trip">
      <div className="gps-trip-day" role="group" aria-label="Choisir le jour">
        <button type="button" className="gps-trip-ico" aria-label="Jour précédent" onClick={() => s.shift(-1)}><ChevronLeft size={18} aria-hidden /></button>
        <input type="date" className="gps-trip-date" aria-label="Date du parcours" value={dayKey} max={todayKey} onChange={(e) => { if (e.target.value && e.target.value <= todayKey) s.changeDay(e.target.value); }} />
        <button type="button" className="gps-trip-ico" aria-label="Jour suivant" disabled={isToday} onClick={() => s.shift(1)}><ChevronRight size={18} aria-hidden /></button>
      </div>
      <div className="gps-trip-quick">
        <button type="button" className={`gps-trip-chip${isToday ? ' on' : ''}`} aria-pressed={isToday} onClick={() => s.changeDay(todayKey)}>Aujourd’hui</button>
        <button type="button" className={`gps-trip-chip${dayKey === yesterday ? ' on' : ''}`} aria-pressed={dayKey === yesterday} onClick={() => s.changeDay(yesterday)}>Hier</button>
      </div>

      {isToday && (
        <label className="gps-trip-live">
          <input type="checkbox" role="switch" checked={s.live} onChange={(e) => s.setLive(e.target.checked)} />
          <span><strong><Radio size={13} aria-hidden /> Suivre en direct</strong><small>Mise à jour toutes les 20 secondes.</small></span>
        </label>
      )}

      {!j && !err && <SkeletonRows />}
      {err && <p className="gps-hint err" role="alert">Journal indisponible : {err} <button type="button" className="gps-trip-chip" onClick={s.reload}>Réessayer</button></p>}

      {j && (
        <>
          <div className="gps-trip-kpis">
            <div><span>Parcourus</span><b>{km1(j.summary.km)}</b></div>
            <div><span>En route</span><b>{dur(j.summary.driveMinutes)}</b></div>
            <div><span>À l’arrêt</span><b>{dur(j.summary.stopMinutes)}</b></div>
            <div><span>Vitesse max</span><b>{j.summary.maxSpeed} km/h</b></div>
          </div>
          {j.summary.firstMoveAt && <p className="gps-hint">Premier départ {hhmm(j.summary.firstMoveAt)}{j.summary.lastSignalAt ? ` · dernier signal ${hhmm(j.summary.lastSignalAt)}` : ''}</p>}

          {j.points.length > 1 && s.cursor && (
            <div className="gps-trip-player" role="group" aria-label="Rejeu du parcours">
              <div className="gps-trip-row">
                <button type="button" className="gps-trip-play" aria-label={s.playing ? 'Mettre en pause' : 'Lancer le rejeu'} onClick={() => s.setPlaying(!s.playing)}>
                  {s.playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
                </button>
                <input type="range" className="gps-trip-range" aria-label="Position dans la journée" min={0} max={j.points.length - 1} value={s.cursor.i} onChange={(e) => s.seek(Number(e.target.value))} aria-valuetext={`${clock(s.cursor.t)}, ${Math.round(s.cursor.speed)} km/h`} />
                <span className="gps-trip-clock">{clock(s.cursor.t)} · {Math.round(s.cursor.speed)} km/h</span>
              </div>
              <div className="gps-trip-row" role="group" aria-label="Vitesse de lecture">
                {RATES.map((r, i) => <button key={r.label} type="button" className={`gps-trip-chip${s.rateIdx === i ? ' on' : ''}`} aria-pressed={s.rateIdx === i} aria-label={`Vitesse ${r.label}, ${r.rate / 60} min de journée par seconde`} onClick={() => s.setRateIdx(i)}>{r.label}</button>)}
                {s.live && isToday && <span className="gps-trip-livetag">● En direct</span>}
              </div>
            </div>
          )}

          <h4 className="gps-h2">Déroulé de la journée</h4>
          {j.segments.length === 0 ? <p className="gps-hint">Aucun déplacement enregistré ce jour-là.</p> : (
            <ol className="gps-tl gps-trip-list">
              {j.segments.map((g, i) => {
                if (g.type === 'stop') {
                  stopNo++;
                  const long = g.minutes >= LONG_STOP_MIN;
                  return (
                    <li key={i}>
                      <button type="button" className={long ? 'long' : undefined} aria-label={`Arrêt ${stopNo}, ${g.label ?? 'adresse inconnue'}, centrer la carte`} onClick={() => s.focusOn(g)}>
                        <span className={`gps-tl-n${g.worksite ? ' site' : ''}${long ? ' gps-trip-n-long' : ''}`}>{stopNo}</span>
                        <span className="gps-tl-body">
                          <strong>{g.worksite ? 'Sur chantier' : 'Arrêt'} · {dur(g.minutes)}{long ? ' · long arrêt' : ''}</strong>
                          <span>{hhmm(g.from)} → {g.to ? hhmm(g.to) : 'maintenant'}</span>
                          <span className="gps-trip-place">{g.label ?? `${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`}</span>
                        </span>
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={i}>
                    <button type="button" aria-label={`Trajet de ${hhmm(g.from)} à ${hhmm(g.to)}, centrer la carte`} onClick={() => s.focusOn(g.start, g.end)}>
                      <span className="gps-tl-n gps-trip-n-car"><Navigation size={13} aria-hidden /></span>
                      <span className="gps-tl-body">
                        <strong>Trajet · {km1(g.km)} · {dur(g.minutes)}</strong>
                        <span>{hhmm(g.from)} → {hhmm(g.to)} · moy. {g.avgSpeed} km/h · max {g.maxSpeed} km/h</span>
                        {(g.startPlace || g.endPlace) && <span className="gps-trip-place">de {g.startPlace ?? '…'} à {g.endPlace ?? '…'}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
