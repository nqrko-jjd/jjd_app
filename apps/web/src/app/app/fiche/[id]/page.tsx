'use client';
import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';

interface Task { id: string; title: string; status: string; assignee: { displayName: string | null; firstName: string } | null }

const CONTACT_ROLE: Record<string, string> = {
  concierge: 'Concierge', president: 'Président', council: 'Conseil', syndic_manager: 'Gestionnaire syndic',
  contact: 'Contact', owner_rep: 'Représentant copro', other: 'Autre',
};

interface Field {
  worksite: { id: string; ref: string; title: string; description: string | null; address: string };
  building: { name: string; digicode: string | null; accessNote: string | null; contacts: { role: string; name: string; phone: string | null }[] } | null;
  client: { name: string; phone: string | null } | null;
  manager: { name: string; phone: string | null } | null;
  today: {
    startAt: string; endAt: string; allDay: boolean; toDo: string | null; materials: string | null;
    team: string | null; vehicle: string | null; people: { name: string; phone: string | null }[];
    equipment: { name: string; reference: string | null }[];
    consumables: { name: string; qty: number; unit: string }[];
  } | null;
}

function PhoneLine({ label, name, phone }: { label: string; name: string; phone: string | null }) {
  return (
    <div style={{ padding: '0.3rem 0' }}>
      <span className="muted">{label} · </span>
      {phone ? <a href={`tel:${phone.replace(/\s/g, '')}`} style={{ color: 'var(--primary)', fontWeight: 700 }}>{name} · {phone}</a> : name}
    </div>
  );
}

export default function WorkerFichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d } = useApi<Field>(`/api/worksites/${id}/field`);
  const { data: taskData, reload: reloadTasks } = useApi<{ items: Task[] }>(`/api/worksites/${id}/tasks`);
  const [busy, setBusy] = useState<string | null>(null);

  const toggleTask = useCallback(async (t: Task) => {
    setBusy(t.id);
    const next = t.status === 'done' ? 'todo' : 'done';
    await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: next } });
    await reloadTasks();
    setBusy(null);
  }, [reloadTasks]);

  if (!d) return <div className="empty">Chargement…</div>;
  const w = d.worksite;
  const tasks = taskData?.items ?? [];
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  return (
    <>
      <PageHead title={`${w.ref} — ${w.title}`} sub={w.address} />

      {w.address && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}`}
          target="_blank" rel="noreferrer"
          className="btn" style={{ display: 'inline-block', marginBottom: '1rem' }}
        >
          📍 Itinéraire
        </a>
      )}

      {d.building?.digicode && (
        <div className="card card-pad" style={{ background: 'var(--warn-soft, #fbf3e3)', marginBottom: '1rem' }}>
          <span className="muted">Digicode · </span><strong style={{ fontSize: '1.1rem' }}>{d.building.digicode}</strong>
        </div>
      )}
      {d.building?.accessNote && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="muted" style={{ marginBottom: '0.2rem' }}>Accès</div>
          {d.building.accessNote}
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="muted" style={{ marginBottom: '0.2rem' }}>
          À faire{d.today && !d.today.allDay ? ` · ${new Date(d.today.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}–${new Date(d.today.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{d.today?.toDo || w.description || 'Voir avec le bureau.'}</div>
        {d.today?.materials && <div className="muted" style={{ marginTop: '0.4rem' }}>{d.today.materials}</div>}
        {d.today?.vehicle && <div className="muted" style={{ marginTop: '0.2rem' }}>🚐 {d.today.vehicle}</div>}
      </div>

      {d.today && (d.today.equipment.length > 0 || d.today.consumables.length > 0) && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="muted" style={{ marginBottom: '0.3rem' }}>Matériel &amp; consommables</div>
          {d.today.equipment.map((e, i) => <div key={`e${i}`} style={{ padding: '0.15rem 0' }}>🧰 {e.name}{e.reference ? ` (${e.reference})` : ''}</div>)}
          {d.today.consumables.map((c, i) => <div key={`c${i}`} style={{ padding: '0.15rem 0' }}>📦 {c.qty} {c.unit} — {c.name}</div>)}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="muted" style={{ marginBottom: '0.3rem' }}>Tâches ({openTasks.length} à faire)</div>
          {[...openTasks, ...doneTasks].map((t) => (
            <div
              key={t.id}
              onClick={() => busy !== t.id && toggleTask(t)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', cursor: 'pointer', opacity: busy === t.id ? 0.5 : 1 }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: 5, border: `2px solid ${t.status === 'done' ? 'var(--ok)' : 'var(--line)'}`,
                background: t.status === 'done' ? 'var(--ok)' : 'transparent', color: '#fff', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0,
              }}>
                {t.status === 'done' ? '✓' : ''}
              </span>
              <span style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--ink-3)' : 'var(--ink)' }}>
                {t.title}{t.assignee ? ` · ${t.assignee.displayName || t.assignee.firstName}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {d.today && d.today.people.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: '1rem' }}>
          <div className="muted" style={{ marginBottom: '0.2rem' }}>Équipe du jour</div>
          {d.today.people.map((p, i) => <PhoneLine key={i} label="Ouvrier" name={p.name} phone={p.phone} />)}
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: '1.2rem' }}>
        <div className="muted" style={{ marginBottom: '0.2rem' }}>Contacts</div>
        {d.manager && <PhoneLine label="Chef de chantier" name={d.manager.name} phone={d.manager.phone} />}
        {d.client && <PhoneLine label="Client" name={d.client.name} phone={d.client.phone} />}
        {(d.building?.contacts ?? []).map((c, i) => <PhoneLine key={i} label={CONTACT_ROLE[c.role] ?? c.role} name={c.name} phone={c.phone} />)}
        {!d.manager && !d.client && (d.building?.contacts ?? []).length === 0 && <div className="muted">Aucun contact renseigné.</div>}
      </div>

      <Link href={`/app/chantiers/${w.id}`} className="btn primary" style={{ display: 'block', textAlign: 'center' }}>
        Ouvrir le chantier (photos, rapports…)
      </Link>
    </>
  );
}
