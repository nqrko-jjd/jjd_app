'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';

interface Ev {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean;
  materialsNote: string | null; note: string | null;
  worksite: { id: string; ref: string; title: string; city: string | null };
  team: { name: string; color: string | null } | null;
  vehicle: { plate: string | null; model: string | null } | null;
  assignments: { person: { id: string; displayName: string | null; firstName: string } }[];
}

const DAY_START = 6 * 60;
const DAY_END = 20 * 60;
const DAY_LABELS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const PALETTE = ['#2563eb', '#0891b2', '#7c3aed', '#c2410c', '#15803d', '#b91c1c', '#a16207', '#be185d', '#4338ca', '#0f766e'];

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const minsOfDay = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

function colorFor(e: Ev) {
  if (e.team?.color) return e.team.color;
  let h = 0;
  for (const c of e.worksite.ref) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

interface Block {
  key: string; worksite: Ev['worksite']; title: string | null; startAt: string; endAt: string;
  team: Ev['team']; vehicle: Ev['vehicle']; materialsNote: string | null; note: string | null;
  people: string[]; ids: string[]; color: string;
}

/** Regroupe les affectations d'un même chantier / même jour en un seul bloc. */
function mergeByWorksite(evs: Ev[]): Block[] {
  const map = new Map<string, Block>();
  for (const e of evs) {
    const cur = map.get(e.worksite.id);
    const names = e.assignments.map((a) => a.person.displayName || a.person.firstName);
    if (!cur) {
      map.set(e.worksite.id, {
        key: e.worksite.id, worksite: e.worksite, title: e.title, startAt: e.startAt, endAt: e.endAt,
        team: e.team, vehicle: e.vehicle, materialsNote: e.materialsNote, note: e.note,
        people: [...names], ids: [e.id], color: colorFor(e),
      });
    } else {
      if (new Date(e.startAt) < new Date(cur.startAt)) cur.startAt = e.startAt;
      if (new Date(e.endAt) > new Date(cur.endAt)) cur.endAt = e.endAt;
      cur.ids.push(e.id);
      for (const n of names) if (!cur.people.includes(n)) cur.people.push(n);
      cur.vehicle ??= e.vehicle;
      cur.materialsNote ??= e.materialsNote;
      if (e.note && !cur.note) cur.note = e.note;
    }
  }
  return [...map.values()];
}

/** Répartit les blocs d'un jour en colonnes qui ne se chevauchent pas. */
function layout(blocks: Block[]) {
  const sorted = [...blocks].sort((a, b) => minsOfDay(a.startAt) - minsOfDay(b.startAt));
  const lanes: number[] = []; // fin (min) de chaque colonne
  const placed = sorted.map((b) => {
    const s = minsOfDay(b.startAt);
    const end = Math.max(minsOfDay(b.endAt), s + 20);
    let lane = lanes.findIndex((f) => f <= s);
    if (lane === -1) { lane = lanes.length; lanes.push(end); } else lanes[lane] = end;
    return { b, s, end, lane };
  });
  const laneCount = Math.max(1, lanes.length);
  return { placed, laneCount };
}

export default function PlanningPage() {
  const [view, setView] = useState<'week' | 'day'>('week');
  const [anchor, setAnchor] = useState(() => new Date());

  // Sur petit écran, la vue semaine (7 colonnes) est illisible → bascule sur Jour au 1er rendu.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) setView('day');
  }, []);
  const cols = view === 'week' ? 7 : 1;
  const start = view === 'week' ? mondayOf(anchor) : new Date(anchor.setHours(0, 0, 0, 0));
  const days = Array.from({ length: cols }, (_, i) => addDays(start, i));
  const rangeFrom = days[0].toISOString();
  const rangeTo = addDays(days[days.length - 1], 1).toISOString();

  const { data, loading, reload } = useApi<{ items: Ev[]; googleSync: boolean }>(`/api/planning?from=${rangeFrom}&to=${rangeTo}`);
  const [showForm, setShowForm] = useState<{ date?: string; hour?: number } | null>(null);
  const [detail, setDetail] = useState<Block | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = (7 * 60 - DAY_START) / 60 * 46 - 20; }, [view]);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  const blocksByDay = useMemo(() => {
    const raw: Ev[][] = days.map(() => []);
    for (const e of data?.items ?? []) {
      const idx = days.findIndex((x) => sameDay(x, new Date(e.startAt)));
      if (idx >= 0) raw[idx].push(e);
    }
    return raw.map((evs) => ({
      timed: mergeByWorksite(evs.filter((e) => !e.allDay)),
      allDay: mergeByWorksite(evs.filter((e) => e.allDay)),
    }));
  }, [data, days]);

  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START / 60 + i);
  const now = new Date();
  const nowTop = (now.getHours() * 60 + now.getMinutes() - DAY_START) / 60 * 46;

  const label = view === 'week'
    ? `${days[0].toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })} – ${days[6].toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : days[0].toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });

  const step = view === 'week' ? 7 : 1;

  return (
    <>
      <PageHead
        title="Planning"
        sub={data?.googleSync ? 'Synchronisé avec Google Agenda' : 'Google Agenda : non connecté'}
        action={<button className="btn primary" onClick={() => setShowForm({})}>+ Affectation</button>}
      />

      <div className="cal">
        <div className="cal-toolbar">
          <div className="nav">
            <button onClick={() => setAnchor(addDays(new Date(days[0]), -step))}>‹</button>
            <button onClick={() => setAnchor(new Date())}>Aujourd’hui</button>
            <button onClick={() => setAnchor(addDays(new Date(days[0]), step))}>›</button>
          </div>
          <span className="range">{label}</span>
          <div className="seg" style={{ marginLeft: 'auto' }}>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Semaine</button>
            <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Jour</button>
          </div>
        </div>

        {loading && !data ? <div className="empty">Chargement…</div> : (
          <div className="cal-frame" style={{ ['--cal-cols' as string]: cols }}>
            <div className="cal-daysrow">
              <div className="cal-corner" />
              {days.map((d, i) => (
                <div key={i} className={`cal-day-h${sameDay(d, now) ? ' today' : ''}`}>
                  {DAY_LABELS[(d.getDay() + 6) % 7]}<b>{d.getDate()}</b>
                </div>
              ))}
            </div>

            {blocksByDay.some((b) => b.allDay.length > 0) && (
              <div className="cal-allday">
                <div className="lbl">jour.</div>
                {days.map((_, i) => (
                  <div key={i} className="col">
                    {blocksByDay[i].allDay.map((b) => (
                      <span key={b.key} className="chip-ev" style={{ ['--ev' as string]: b.color }} onClick={() => setDetail(b)}>
                        {b.worksite.ref} · {b.title || b.worksite.title}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="cal-body" ref={bodyRef}>
              <div className="cal-gutter">
                {hours.map((h) => <div key={h} className="h">{h}h</div>)}
              </div>
              {days.map((d, i) => {
                const { placed, laneCount } = layout(blocksByDay[i].timed);
                return (
                  <div
                    key={i}
                    className="cal-col"
                    onClick={(ev) => {
                      if (ev.target !== ev.currentTarget) return;
                      const rect = ev.currentTarget.getBoundingClientRect();
                      const mins = DAY_START + Math.floor((ev.clientY - rect.top) / 46) * 60;
                      setShowForm({ date: d.toISOString().slice(0, 10), hour: Math.max(6, Math.min(19, Math.round(mins / 60))) });
                    }}
                  >
                    {hours.map((h) => <div key={h} className="line" />)}
                    {sameDay(d, now) && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) / 60 * 46 && (
                      <div className="cal-now" style={{ top: nowTop }} />
                    )}
                    {placed.map(({ b, s, end, lane }) => {
                      const top = Math.max(0, (s - DAY_START) / 60 * 46);
                      const height = Math.max(18, (Math.min(end, DAY_END) - Math.max(s, DAY_START)) / 60 * 46 - 2);
                      const w = 100 / laneCount;
                      return (
                        <div
                          key={b.key}
                          className={`cal-ev${height < 34 ? ' mini' : ''}`}
                          style={{ top, height, left: `${lane * w}%`, width: `calc(${w}% - 3px)`, ['--ev' as string]: b.color }}
                          onClick={() => setDetail(b)}
                        >
                          <span className="t">{hhmm(b.startAt)} <span className="r">{b.worksite.ref}</span></span>
                          {height >= 34 && <div>{b.title || b.worksite.title}</div>}
                          {height >= 52 && b.people.length > 0 && (
                            <div style={{ opacity: 0.8 }}>{b.people.join(', ')}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {detail && <EventDetail b={detail} onClose={() => setDetail(null)} onDeleted={() => { setDetail(null); reload(); }} />}
      {showForm && <NewEventForm prefill={showForm} onDone={() => { setShowForm(null); reload(); }} onClose={() => setShowForm(null)} />}
    </>
  );
}

function EventDetail({ b, onClose, onDeleted }: { b: Block; onClose: () => void; onDeleted: () => void }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-head">
          <h2>{b.worksite.ref} — {b.title || b.worksite.title}</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'block' }}>
          <p style={{ margin: '0 0 0.6rem' }}>
            {`${hhmm(b.startAt)} – ${hhmm(b.endAt)}`}
            {b.worksite.city ? ` · ${b.worksite.city}` : ''}
            {b.ids.length > 1 ? ` · ${b.ids.length} affectations` : ''}
          </p>
          {b.people.length > 0 && (
            <p style={{ margin: '0 0 0.5rem' }}>
              <span className="muted">Équipe : </span>
              {b.people.map((n) => <span key={n} className="badge" style={{ marginRight: 4 }}>{n}</span>)}
            </p>
          )}
          {b.vehicle && <p className="muted" style={{ margin: '0 0 0.3rem' }}>🚐 {b.vehicle.plate || b.vehicle.model}</p>}
          {b.materialsNote && <p className="muted" style={{ margin: '0 0 0.3rem' }}>🔧 {b.materialsNote}</p>}
          {b.note && <p style={{ margin: '0.4rem 0 0', whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>{b.note}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" style={{ color: 'var(--crit)', marginRight: 'auto' }} onClick={async () => {
            if (!confirm(b.ids.length > 1 ? `Supprimer les ${b.ids.length} affectations de ce chantier ce jour ?` : 'Supprimer cette affectation ?')) return;
            await Promise.all(b.ids.map((id) => api(`/api/planning/${id}`, { method: 'DELETE' })));
            onDeleted();
          }}>Supprimer</button>
          <Link href={`/app/chantiers/${b.worksite.id}`} className="btn primary">Ouvrir le chantier</Link>
        </div>
      </div>
    </div>
  );
}

function NewEventForm({ prefill, onDone, onClose }: { prefill: { date?: string; hour?: number }; onDone: () => void; onClose: () => void }) {
  const { data: ws } = useApi<{ items: { id: string; ref: string; title: string }[] }>('/api/worksites');
  const { data: people } = useApi<{ items: { id: string; displayName: string | null; firstName: string; role: string }[] }>('/api/people?active=1');
  const { data: vehicles } = useApi<{ items: { id: string; plate: string | null; model: string | null }[] }>('/api/vehicles');
  const h = prefill.hour ?? 8;
  const [f, setF] = useState({
    worksiteId: '', date: prefill.date ?? new Date().toISOString().slice(0, 10),
    start: `${String(h).padStart(2, '0')}:00`, end: `${String(Math.min(h + 8, 20)).padStart(2, '0')}:00`,
    vehicleId: '', materialsNote: '', note: '', personIds: [] as string[],
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.worksiteId) return;
    setBusy(true);
    await api('/api/planning', {
      method: 'POST',
      body: {
        worksiteId: f.worksiteId,
        startAt: new Date(`${f.date}T${f.start}`).toISOString(),
        endAt: new Date(`${f.date}T${f.end}`).toISOString(),
        vehicleId: f.vehicleId || null,
        materialsNote: f.materialsNote || null,
        note: f.note || null,
        personIds: f.personIds,
      },
    });
    onDone();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><h2>Nouvelle affectation</h2><button type="button" className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Chantier</label>
            <select className="select" value={f.worksiteId} onChange={(e) => setF({ ...f, worksiteId: e.target.value })} required>
              <option value="">—</option>
              {(ws?.items ?? []).map((w) => <option key={w.id} value={w.id}>{w.ref} — {w.title}</option>)}
            </select>
          </div>
          <div className="field"><label>Date</label><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="field"><label>Véhicule</label>
            <select className="select" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
              <option value="">—</option>
              {(vehicles?.items ?? []).map((v) => <option key={v.id} value={v.id}>{v.plate || v.model}</option>)}
            </select>
          </div>
          <div className="field"><label>Début</label><input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div className="field"><label>Fin</label><input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Matériel</label><input className="input" value={f.materialsNote} onChange={(e) => setF({ ...f, materialsNote: e.target.value })} placeholder="échafaudage, nacelle…" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Note / tâches</label><textarea className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Ouvriers</label>
            <div className="row">
              {(people?.items ?? []).map((p) => {
                const on = f.personIds.includes(p.id);
                return (
                  <button type="button" key={p.id} className={`badge ${on ? 'primary' : ''}`} style={{ cursor: 'pointer' }}
                    onClick={() => setF({ ...f, personIds: on ? f.personIds.filter((x) => x !== p.id) : [...f.personIds, p.id] })}>
                    {p.displayName || p.firstName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={busy} type="submit">Planifier</button>
        </div>
      </form>
    </div>
  );
}
