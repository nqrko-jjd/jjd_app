'use client';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { formatDateBE } from '@/lib/ui';
import { AssigneePicker } from './AssigneePicker';

interface Task {
  id: string; title: string; description: string | null; status: string; phaseId: string | null;
  dueOn: string | null; doneAt: string | null; doneByName: string | null; source: string | null;
  assignees: { id: string; name: string }[];
}
interface Phase { id: string; name: string; position: number }

const NEXT: Record<string, string> = { todo: 'doing', doing: 'done', done: 'todo' };
const STATUS_LABEL: Record<string, string> = { todo: 'À faire', doing: 'En cours', done: 'Réalisé' };

export function WorksiteTasks({ worksiteId }: { worksiteId: string }) {
  const { data, reload } = useApi<{ items: Task[] }>(`/api/worksites/${worksiteId}/tasks`);
  const { data: phaseData, reload: reloadPhases } = useApi<{ items: Phase[] }>(`/api/worksites/${worksiteId}/phases`);
  const { data: pick } = useApi<{ people: { id: string; name: string }[] }>('/api/meta/pickers');
  const [creatingFor, setCreatingFor] = useState<{ phaseId: string | null } | null>(null);

  const tasks = data?.items ?? [];
  const phases = phaseData?.items ?? [];

  const patch = (id: string, body: Record<string, unknown>) => api(`/api/tasks/${id}`, { method: 'PATCH', body }).then(reload);

  async function addPhase() {
    const name = window.prompt('Nom de la phase (ex. Gros-oeuvre, Finitions)');
    if (!name?.trim()) return;
    await api(`/api/worksites/${worksiteId}/phases`, { method: 'POST', body: { name: name.trim() } });
    reloadPhases();
  }
  async function renamePhase(phase: Phase) {
    const name = window.prompt('Renommer la phase', phase.name);
    if (!name?.trim() || name.trim() === phase.name) return;
    await api(`/api/phases/${phase.id}`, { method: 'PATCH', body: { name: name.trim() } });
    reloadPhases();
  }
  async function deletePhase(phase: Phase) {
    if (!confirm(`Supprimer la phase « ${phase.name} » ? Ses tâches repassent en « sans phase ».`)) return;
    await api(`/api/phases/${phase.id}`, { method: 'DELETE' });
    reloadPhases();
    reload();
  }

  function Row({ t }: { t: Task }) {
    const late = t.dueOn && t.status !== 'done' && new Date(t.dueOn) < new Date();
    return (
      <div className="task-row" onClick={() => patch(t.id, { status: NEXT[t.status] })} title="Changer l'état">
        <span className={`task-check${t.status === 'done' ? ' done' : t.status === 'doing' ? ' doing' : ''}`}>{t.status === 'done' ? '✓' : ''}</span>
        <div className="task-body">
          <span className="task-title">{t.title}</span>
          {t.description && <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>{t.description}</div>}
          <div className="task-meta">
            {t.assignees.map((a) => <span key={a.id} className="badge plain">{a.name}</span>)}
            {t.dueOn && <span className={`badge ${late ? 'crit' : 'plain'}`}>{formatDateBE(t.dueOn)}</span>}
            {t.source === 'ai-draft' && <span className="badge warn" title="Proposée par l'assistant IA — à valider">✨ Proposé par l&apos;IA</span>}
            {t.source === 'quote' && <span className="badge plain" title="Créée depuis les lignes d'un devis">📄 Depuis un devis</span>}
            {t.status === 'done' && t.doneByName && <span className="muted" style={{ fontSize: '0.76rem' }}>fait par {t.doneByName}</span>}
          </div>
        </div>
        <span className={`task-status${t.status === 'done' ? ' done' : t.status === 'doing' ? ' doing' : ''}`}>{STATUS_LABEL[t.status]}</span>
        <button
          className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }}
          onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer ?')) api(`/api/tasks/${t.id}`, { method: 'DELETE' }).then(reload); }}
        >
          ✕
        </button>
      </div>
    );
  }

  function Section({ phase, items }: { phase: Phase | null; items: Task[] }) {
    return (
      <div className="card card-pad" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{phase ? phase.name : 'Tâches sans phase'}</h3>
          <div className="row" style={{ gap: '0.5rem' }}>
            <span className="hint">{items.length} tâche{items.length > 1 ? 's' : ''}</span>
            <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => setCreatingFor({ phaseId: phase?.id ?? null })}>+ Tâche</button>
            {phase && (
              <>
                <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => renamePhase(phase)}>Renommer</button>
                <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => deletePhase(phase)}>Supprimer</button>
              </>
            )}
          </div>
        </div>
        {items.length === 0
          ? <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.85rem' }}>Aucune tâche.</p>
          : items.map((t) => <Row key={t.id} t={t} />)}
      </div>
    );
  }

  return (
    <>
      {phases.map((phase) => (
        <Section key={phase.id} phase={phase} items={tasks.filter((t) => t.phaseId === phase.id)} />
      ))}
      <Section phase={null} items={tasks.filter((t) => !t.phaseId)} />
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn ghost" onClick={addPhase}>+ Phase</button>
      </div>

      {creatingFor && (
        <TaskCreateModal
          people={pick?.people ?? []}
          onClose={() => setCreatingFor(null)}
          onSubmit={async (body) => {
            await api(`/api/worksites/${worksiteId}/tasks`, { method: 'POST', body: { ...body, phaseId: creatingFor.phaseId } });
            setCreatingFor(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function TaskCreateModal({
  people,
  onClose,
  onSubmit,
}: {
  people: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (body: { title: string; description: string | null; assigneeIds: string[]; dueOn: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onSubmit({ title: title.trim(), description: description.trim() || null, assigneeIds, dueOn: dueOn || null });
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
            <input className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Poser le carrelage" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
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
