'use client';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { formatDateBE } from '@/lib/ui';

interface Task {
  id: string; title: string; description: string | null; status: string;
  dueOn: string | null; doneAt: string | null; doneByName: string | null;
  assignee: { id: string; displayName: string | null; firstName: string } | null;
}

const NEXT: Record<string, string> = { todo: 'doing', doing: 'done', done: 'todo' };
const DOT: Record<string, string> = { todo: 'var(--ink-3)', doing: 'var(--warn)', done: 'var(--ok)' };

export function WorksiteTasks({ worksiteId }: { worksiteId: string }) {
  const { data, reload } = useApi<{ items: Task[] }>(`/api/worksites/${worksiteId}/tasks`);
  const { data: pick } = useApi<{ people: { id: string; name: string }[] }>('/api/meta/pickers');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');

  const tasks = data?.items ?? [];
  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');

  async function add() {
    if (!title.trim()) return;
    await api(`/api/worksites/${worksiteId}/tasks`, { method: 'POST', body: { title: title.trim(), assigneeId: assignee || null, dueOn: due || null } });
    setTitle(''); setAssignee(''); setDue('');
    reload();
  }
  const patch = (id: string, body: Record<string, unknown>) => api(`/api/tasks/${id}`, { method: 'PATCH', body }).then(reload);

  function Row({ t }: { t: Task }) {
    const late = t.dueOn && t.status !== 'done' && new Date(t.dueOn) < new Date();
    return (
      <div className="row" style={{ gap: '0.7rem', padding: '0.55rem 0', borderTop: '1px solid var(--line)', alignItems: 'flex-start' }}>
        <button
          title="Changer l'état"
          onClick={() => patch(t.id, { status: NEXT[t.status] })}
          style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${DOT[t.status]}`, background: t.status === 'done' ? 'var(--ok)' : t.status === 'doing' ? 'var(--warn)' : 'transparent', cursor: 'pointer', marginTop: 2, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <span style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined, color: t.status === 'done' ? 'var(--ink-3)' : undefined }}>{t.title}</span>
          <div className="row" style={{ gap: '0.4rem', marginTop: 3 }}>
            {t.assignee && <span className="badge plain">{t.assignee.displayName || t.assignee.firstName}</span>}
            {t.dueOn && <span className={`badge ${late ? 'crit' : 'plain'}`}>{formatDateBE(t.dueOn)}</span>}
            {t.status === 'done' && t.doneByName && <span className="muted" style={{ fontSize: '0.76rem' }}>fait par {t.doneByName}</span>}
          </div>
        </div>
        <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => { if (confirm('Supprimer ?')) api(`/api/tasks/${t.id}`, { method: 'DELETE' }).then(reload); }}>✕</button>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      {open.length === 0 && done.length === 0 && <p className="muted" style={{ margin: '0 0 0.6rem' }}>Aucune tâche.</p>}
      {open.map((t) => <Row key={t.id} t={t} />)}
      {done.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0.8rem 0 0' }}>Terminées ({done.length})</div>
          {done.map((t) => <Row key={t.id} t={t} />)}
        </>
      )}
      <div className="row" style={{ gap: '0.4rem', marginTop: '0.9rem', borderTop: '1px solid var(--line)', paddingTop: '0.8rem' }}>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Nouvelle tâche…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="select" style={{ maxWidth: 140 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Qui ?</option>
          {(pick?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 150 }} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn primary" onClick={add}>Ajouter</button>
      </div>
    </div>
  );
}
