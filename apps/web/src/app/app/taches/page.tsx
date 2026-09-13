'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, formatDateBE } from '@/lib/ui';
import { AssigneePicker } from '@/components/AssigneePicker';

interface Task {
  id: string; title: string; description: string | null; status: string;
  dueOn: string | null; doneAt: string | null; doneByName: string | null; source: string | null;
  assignees: { id: string; name: string }[];
  worksite: { id: string; ref: string; title: string } | null;
}

type View = 'all' | 'today' | 'week' | 'overdue' | 'mine';

const VIEWS: { key: View; label: string }[] = [
  { key: 'all', label: 'Toutes les tâches' },
  { key: 'today', label: "Aujourd'hui" },
  { key: 'week', label: 'Cette semaine' },
  { key: 'overdue', label: 'En retard' },
  { key: 'mine', label: 'Mes tâches' },
];

const NEXT: Record<string, string> = { todo: 'doing', doing: 'done', done: 'todo' };
const DOT: Record<string, string> = { todo: 'var(--ink-3)', doing: 'var(--warn)', done: 'var(--ok)' };

function queryFor(view: View): string {
  if (view === 'mine') return '?mine=1';
  if (view === 'all') return '';
  return `?view=${view}`;
}

export default function TachesPage() {
  const [view, setView] = useState<View>('all');
  const { data, reload } = useApi<{ items: Task[] }>(`/api/tasks${queryFor(view)}`);
  const { data: pick } = useApi<{ people: { id: string; name: string }[]; worksites: { id: string; name: string }[] }>('/api/meta/pickers');
  const [creating, setCreating] = useState(false);

  const tasks = data?.items ?? [];
  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');

  const patch = (id: string, body: Record<string, unknown>) => api(`/api/tasks/${id}`, { method: 'PATCH', body }).then(reload);

  function Row({ t }: { t: Task }) {
    const late = t.dueOn && t.status !== 'done' && new Date(t.dueOn) < new Date();
    return (
      <div className="row" style={{ gap: '0.7rem', padding: '0.6rem 0', borderTop: '1px solid var(--line)', alignItems: 'flex-start' }}>
        <button
          title="Changer l'état"
          onClick={() => patch(t.id, { status: NEXT[t.status] })}
          style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${DOT[t.status]}`, background: t.status === 'done' ? 'var(--ok)' : t.status === 'doing' ? 'var(--warn)' : 'transparent', cursor: 'pointer', marginTop: 2, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <span style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined, color: t.status === 'done' ? 'var(--ink-3)' : undefined }}>{t.title}</span>
          {t.description && <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>{t.description}</div>}
          <div className="row" style={{ gap: '0.4rem', marginTop: 3, flexWrap: 'wrap' }}>
            {t.worksite && <Link href={`/app/chantiers/${t.worksite.id}`} className="badge plain">{t.worksite.ref} · {t.worksite.title}</Link>}
            {t.assignees.map((a) => <span key={a.id} className="badge plain">{a.name}</span>)}
            {t.dueOn && <span className={`badge ${late ? 'crit' : 'plain'}`}>{formatDateBE(t.dueOn)}</span>}
            {t.source === 'ai-draft' && <span className="badge warn" title="Proposée par l'assistant IA — à valider">✨ Proposé par l&apos;IA</span>}
            {t.source === 'quote' && <span className="badge plain" title="Créée depuis les lignes d'un devis">📄 Depuis un devis</span>}
            {t.status === 'done' && t.doneByName && <span className="muted" style={{ fontSize: '0.76rem' }}>fait par {t.doneByName}</span>}
          </div>
        </div>
        <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => { if (confirm('Supprimer ?')) api(`/api/tasks/${t.id}`, { method: 'DELETE' }).then(reload); }}>✕</button>
      </div>
    );
  }

  return (
    <>
      <PageHead
        title="Tâches"
        sub="Toutes les tâches, sur chantier ou générales — façon TrustUp"
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle tâche</button>}
      />
      <div className="seg" style={{ marginBottom: '1rem' }}>
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>{v.label}</button>
        ))}
      </div>

      <div className="card card-pad">
        {open.length === 0 && done.length === 0 && <p className="muted" style={{ margin: 0 }}>Aucune tâche.</p>}
        {open.map((t) => <Row key={t.id} t={t} />)}
        {done.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0.8rem 0 0' }}>Terminées ({done.length})</div>
            {done.map((t) => <Row key={t.id} t={t} />)}
          </>
        )}
      </div>

      {creating && (
        <TaskCreateModal
          people={pick?.people ?? []}
          worksites={pick?.worksites ?? []}
          onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            await api('/api/tasks', { method: 'POST', body });
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function TaskCreateModal({
  people,
  worksites,
  onClose,
  onSubmit,
}: {
  people: { id: string; name: string }[];
  worksites: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (body: { title: string; description: string | null; assigneeIds: string[]; dueOn: string | null; worksiteId: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onSubmit({ title: title.trim(), description: description.trim() || null, assigneeIds, dueOn: dueOn || null, worksiteId: worksiteId || null });
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Nouvelle tâche</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Titre *</label>
            <input className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Renouveler l'assurance flotte" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>Chantier <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>— vide = tâche générale</span></label>
            <select className="select" value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
              <option value="">— (tâche générale)</option>
              {worksites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Échéance</label>
            <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <div className="field">
            <label>Assigné(s)</label>
            <AssigneePicker people={people} value={assigneeIds} onChange={setAssigneeIds} />
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button>
        </div>
      </form>
    </div>
  );
}
