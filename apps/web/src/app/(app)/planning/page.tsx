'use client';
import { useMemo, useState } from 'react';
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

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function PlanningPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * 86400000).toISOString();
  const { data, loading, reload } = useApi<{ items: Ev[]; googleSync: boolean }>(
    `/api/planning?from=${from}&to=${to}`,
  );
  const [showForm, setShowForm] = useState(false);

  const byDay = useMemo(() => {
    const m: Record<number, Ev[]> = {};
    for (const e of data?.items ?? []) {
      const day = ((new Date(e.startAt).getDay() + 6) % 7);
      (m[day] ??= []).push(e);
    }
    return m;
  }, [data]);

  return (
    <>
      <PageHead
        title="Planning"
        sub={data?.googleSync ? 'Synchronisé avec Google Agenda' : 'Google Agenda : non connecté'}
        action={<button className="btn primary" onClick={() => setShowForm((v) => !v)}>+ Affectation</button>}
      />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="btn" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}>← Semaine préc.</button>
        <button className="btn" onClick={() => setWeekStart(mondayOf(new Date()))}>Cette semaine</button>
        <button className="btn" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}>Semaine suiv. →</button>
        <span className="muted">
          {weekStart.toLocaleDateString('fr-BE', { day: '2-digit', month: 'long' })} —{' '}
          {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })}
        </span>
      </div>

      {showForm && <NewEventForm onDone={() => { setShowForm(false); reload(); }} />}

      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="grid" style={{ gap: '1rem' }}>
          {DAYS.map((label, i) => {
            const evs = byDay[i] ?? [];
            const date = new Date(weekStart.getTime() + i * 86400000);
            return (
              <div key={i} className="card card-pad">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: evs.length ? '0.7rem' : 0 }}>
                  <h3>{label} <span className="muted" style={{ fontWeight: 400 }}>{date.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })}</span></h3>
                  {evs.length === 0 && <span className="muted" style={{ fontSize: '0.82rem' }}>—</span>}
                </div>
                <div className="grid" style={{ gap: '0.5rem' }}>
                  {evs.map((e) => (
                    <div key={e.id} className="row" style={{ alignItems: 'flex-start', gap: '0.8rem', padding: '0.5rem 0', borderTop: '1px solid var(--line)' }}>
                      <div className="mono muted" style={{ minWidth: 96, fontSize: '0.8rem' }}>
                        {e.allDay ? 'Journée' : `${new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                      <div style={{ flex: 1 }}>
                        <Link href={`/chantiers/${e.worksite.id}`} style={{ fontWeight: 500 }}>
                          <span className="mono">{e.worksite.ref}</span> — {e.title || e.worksite.title}
                        </Link>
                        <div className="row" style={{ gap: '0.4rem', marginTop: '0.3rem' }}>
                          {e.assignments.map((a) => (
                            <span key={a.person.id} className="badge">{a.person.displayName || a.person.firstName}</span>
                          ))}
                          {e.vehicle && <span className="chip">🚐 {e.vehicle.plate || e.vehicle.model}</span>}
                          {e.materialsNote && <span className="chip">🔧 {e.materialsNote}</span>}
                        </div>
                      </div>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={async () => { if (confirm('Supprimer ?')) { await api(`/api/planning/${e.id}`, { method: 'DELETE' }); reload(); } }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function NewEventForm({ onDone }: { onDone: () => void }) {
  const { data: ws } = useApi<{ items: { id: string; ref: string; title: string }[] }>('/api/worksites');
  const { data: people } = useApi<{ items: { id: string; displayName: string | null; firstName: string; role: string }[] }>('/api/people?active=1');
  const { data: vehicles } = useApi<{ items: { id: string; plate: string | null; model: string | null }[] }>('/api/vehicles');
  const [f, setF] = useState({ worksiteId: '', date: new Date().toISOString().slice(0, 10), start: '08:00', end: '17:00', vehicleId: '', materialsNote: '', personIds: [] as string[] });
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
        personIds: f.personIds,
      },
    });
    onDone();
  }

  return (
    <form className="card card-pad grid" style={{ marginBottom: '1.2rem', gap: '0.8rem' }} onSubmit={submit}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.7rem' }}>
        <div className="field">
          <label>Chantier</label>
          <select className="select" value={f.worksiteId} onChange={(e) => setF({ ...f, worksiteId: e.target.value })} required>
            <option value="">—</option>
            {(ws?.items ?? []).map((w) => <option key={w.id} value={w.id}>{w.ref} — {w.title}</option>)}
          </select>
        </div>
        <div className="field"><label>Date</label><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="field"><label>Début</label><input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div className="field"><label>Fin</label><input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <div className="field">
          <label>Véhicule</label>
          <select className="select" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
            <option value="">—</option>
            {(vehicles?.items ?? []).map((v) => <option key={v.id} value={v.id}>{v.plate || v.model}</option>)}
          </select>
        </div>
        <div className="field"><label>Matériel</label><input className="input" value={f.materialsNote} onChange={(e) => setF({ ...f, materialsNote: e.target.value })} placeholder="échafaudage, nacelle…" /></div>
      </div>
      <div className="field">
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
      <div className="row">
        <button className="btn primary" disabled={busy} type="submit">Planifier</button>
        <button className="btn" type="button" onClick={onDone}>Annuler</button>
      </div>
    </form>
  );
}
