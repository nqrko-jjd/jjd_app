'use client';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { formatDateBE } from '@/lib/ui';

interface Task {
  id: string; title: string; description: string | null; status: string; phaseId: string | null;
  dueOn: string | null; doneAt: string | null; doneByName: string | null; source: string | null;
  assignees: { id: string; name: string }[];
}
interface Phase { id: string; name: string; position: number }

const NEXT: Record<string, string> = { todo: 'doing', doing: 'done', done: 'todo' };
const DOT: Record<string, string> = { todo: 'var(--ink-3)', doing: 'var(--warn)', done: 'var(--ok)' };

function selectedOptions(e: React.ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(e.target.selectedOptions).map((o) => o.value);
}

export function WorksiteTasks({ worksiteId }: { worksiteId: string }) {
  const { data, reload } = useApi<{ items: Task[] }>(`/api/worksites/${worksiteId}/tasks`);
  const { data: phaseData, reload: reloadPhases } = useApi<{ items: Phase[] }>(`/api/worksites/${worksiteId}/phases`);
  const { data: pick } = useApi<{ staff: { id: string; name: string }[] }>('/api/meta/pickers');

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
      <div className="row" style={{ gap: '0.7rem', padding: '0.55rem 0', borderTop: '1px solid var(--line)', alignItems: 'flex-start' }}>
        <button
          title="Changer l'état"
          onClick={() => patch(t.id, { status: NEXT[t.status] })}
          style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${DOT[t.status]}`, background: t.status === 'done' ? 'var(--ok)' : t.status === 'doing' ? 'var(--warn)' : 'transparent', cursor: 'pointer', marginTop: 2, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <span style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined, color: t.status === 'done' ? 'var(--ink-3)' : undefined }}>{t.title}</span>
          <div className="row" style={{ gap: '0.4rem', marginTop: 3, flexWrap: 'wrap' }}>
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

  function Composer({ phaseId }: { phaseId: string | null }) {
    const [title, setTitle] = useState('');
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
    const [due, setDue] = useState('');
    async function add() {
      if (!title.trim()) return;
      await api(`/api/worksites/${worksiteId}/tasks`, { method: 'POST', body: { title: title.trim(), phaseId, assigneeIds, dueOn: due || null } });
      setTitle(''); setAssigneeIds([]); setDue('');
      reload();
    }
    return (
      <div className="row" style={{ gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="+ Nouvelle tâche…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select
          className="select"
          multiple
          style={{ maxWidth: 160, height: 62 }}
          value={assigneeIds}
          onChange={(e) => setAssigneeIds(selectedOptions(e))}
          title="Qui (ctrl/cmd + clic pour plusieurs)"
        >
          {(pick?.staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 150 }} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn primary" onClick={add}>Ajouter</button>
      </div>
    );
  }

  function Section({ phase, items }: { phase: Phase | null; items: Task[] }) {
    const open = items.filter((t) => t.status !== 'done');
    const done = items.filter((t) => t.status === 'done');
    return (
      <div style={{ marginTop: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {phase ? phase.name : 'Tâches sans phase'}
          </div>
          {phase && (
            <div className="row" style={{ gap: '0.3rem' }}>
              <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => renamePhase(phase)}>Renommer</button>
              <button className="btn ghost" style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }} onClick={() => deletePhase(phase)}>Supprimer</button>
            </div>
          )}
        </div>
        {open.length === 0 && done.length === 0 && <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>Aucune tâche.</p>}
        {open.map((t) => <Row key={t.id} t={t} />)}
        {done.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: '0.72rem', margin: '0.5rem 0 0' }}>Terminées ({done.length})</div>
            {done.map((t) => <Row key={t.id} t={t} />)}
          </>
        )}
        <Composer phaseId={phase?.id ?? null} />
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" style={{ fontSize: '0.8rem' }} onClick={addPhase}>+ Phase</button>
      </div>
      {phases.map((phase) => (
        <Section key={phase.id} phase={phase} items={tasks.filter((t) => t.phaseId === phase.id)} />
      ))}
      <Section phase={null} items={tasks.filter((t) => !t.phaseId)} />
    </div>
  );
}
