'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';
import { AssigneePicker } from '@/components/AssigneePicker';
import { ComboBox } from '@/components/ComboBox';
import { WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL } from '@jjd/shared';

interface ChecklistItem { label: string; done: boolean }

interface Task {
  id: string; title: string; description: string | null; status: string; priority: string;
  checklist: ChecklistItem[] | null;
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

const TEMPLATES = [
  {
    label: 'Préparer le chantier',
    title: 'Installation et protection du chantier',
    checklist: ['Protéger les sols et les accès', 'Vérifier les équipements', 'Sécuriser la zone'],
  },
  {
    label: 'Commander / préparer',
    title: 'Préparer les matériaux de l’intervention',
    checklist: ['Vérifier les quantités', 'Confirmer la disponibilité', 'Prévoir l’enlèvement'],
  },
  {
    label: 'Contrôler les finitions',
    title: 'Contrôler les finitions avant réception',
    checklist: ['Vérifier les points repris au dossier', 'Photographier les finitions', 'Signaler les réserves'],
  },
];

// Heure locale — jamais toISOString() : décalerait la date d'un jour pour un fuseau en
// avance sur UTC (Belgique, UTC+1/+2), surtout tôt le matin.
function toDateInput(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function queryFor(view: View): string {
  if (view === 'mine') return '?mine=1';
  if (view === 'all') return '';
  return `?view=${view}`;
}

function dueLabel(dueOn: string | null, status: string): { text: string; tone: 'ok' | 'warn' | 'crit' | '' } | null {
  if (status === 'done') return { text: 'Terminé', tone: 'ok' };
  if (!dueOn) return null;
  const d = new Date(dueOn);
  const today = new Date();
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((dd.getTime() - d0.getTime()) / 86400000);
  if (diffDays < 0) return { text: `En retard · ${d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })}`, tone: 'crit' };
  if (diffDays === 0) return { text: 'Aujourd’hui', tone: 'warn' };
  if (diffDays === 1) return { text: 'Demain', tone: 'warn' };
  if (diffDays < 7) return { text: d.toLocaleDateString('fr-BE', { weekday: 'long' }), tone: 'warn' };
  return { text: d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' }), tone: '' };
}

export default function TachesPage() {
  const [view, setView] = useState<View>('all');
  const { data, reload } = useApi<{ items: Task[] }>(`/api/tasks${queryFor(view)}`);
  const { data: pick } = useApi<{
    people: { id: string; name: string }[];
    worksites: { id: string; name: string; city: string | null; managerId: string | null }[];
  }>('/api/meta/pickers');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const tasks = data?.items ?? [];
  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');

  const patch = (id: string, body: Record<string, unknown>) => api(`/api/tasks/${id}`, { method: 'PATCH', body }).then(reload);

  function Row({ t }: { t: Task }) {
    const badge = dueLabel(t.dueOn, t.status);
    return (
      <div className="taskrow">
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onChange={() => patch(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
          style={{ width: 20, height: 20, accentColor: 'var(--primary)', flexShrink: 0 }}
          title="Terminer / remettre à faire"
        />
        <div className="tasktext">
          <button type="button" className="task-title-button" onClick={() => setDetail(t)}>{t.title}</button>
          <small style={{ display: 'block', color: 'var(--ink-3)', marginTop: 2 }}>
            {[t.assignees.map((a) => a.name).join(', ') || null, t.worksite?.ref].filter(Boolean).join(' · ')}
            {t.worksite && <> · <Link href={`/app/chantiers/${t.worksite.id}`} onClick={(e) => e.stopPropagation()}>{t.worksite.title}</Link></>}
          </small>
        </div>
        <div className="task-tags">
          {t.source === 'ai-draft' && <span className="badge warn" title="Proposée par l'assistant IA — à valider">✨ IA</span>}
          {t.source === 'quote' && <span className="badge" title="Créée depuis les lignes d'un devis">📄 Devis</span>}
          {badge && <span className={`badge ${badge.tone}`}>{badge.text}</span>}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Organisation"
        title="Tâches"
        sub="Les prochaines actions et les responsables."
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle tâche</button>}
      />
      <div className="page-tabs">
        {VIEWS.map((v) => (
          <button key={v.key} className={`page-tab${view === v.key ? ' active' : ''}`} onClick={() => setView(v.key)}>{v.label}</button>
        ))}
      </div>

      <div className="card">
        {open.length === 0 && done.length === 0 && <p className="muted" style={{ margin: 0, padding: '1rem 1.3rem' }}>Aucune tâche.</p>}
        {open.map((t) => <Row key={t.id} t={t} />)}
        {done.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0.8rem 1.3rem 0.4rem' }}>Terminées ({done.length})</div>
            {done.map((t) => <Row key={t.id} t={t} />)}
          </>
        )}
      </div>

      {detail && (
        <TaskDetailModal
          t={detail}
          onClose={() => setDetail(null)}
          onToggleChecklistItem={async (idx) => {
            const next = (detail.checklist ?? []).map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
            await api(`/api/tasks/${detail.id}`, { method: 'PATCH', body: { checklist: next } });
            setDetail({ ...detail, checklist: next });
            reload();
          }}
          onToggleDone={async () => {
            await patch(detail.id, { status: detail.status === 'done' ? 'todo' : 'done' });
            setDetail(null);
          }}
          onEdit={() => { setEditing(detail); setDetail(null); }}
        />
      )}

      {(creating || editing) && (
        <TaskFormModal
          people={pick?.people ?? []}
          worksites={pick?.worksites ?? []}
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (body, again) => {
            if (editing) await api(`/api/tasks/${editing.id}`, { method: 'PATCH', body });
            else await api('/api/tasks', { method: 'POST', body });
            reload();
            if (!again) { setCreating(false); setEditing(null); }
          }}
        />
      )}
    </>
  );
}

function TaskDetailModal({
  t, onClose, onToggleChecklistItem, onToggleDone, onEdit,
}: {
  t: Task;
  onClose: () => void;
  onToggleChecklistItem: (idx: number) => void;
  onToggleDone: () => void;
  onEdit: () => void;
}) {
  const badge = dueLabel(t.dueOn, t.status);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Tâche{t.worksite ? ` · ${t.worksite.ref}` : ''}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body" style={{ display: 'block' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{t.title}</div>
          <p className="muted" style={{ margin: '0 0 0.8rem' }}>
            {[t.assignees.map((a) => a.name).join(', ') || 'À attribuer', badge?.tone !== 'ok' ? badge?.text : null, WORKSITE_PRIORITY_LABEL[t.priority as keyof typeof WORKSITE_PRIORITY_LABEL]].filter(Boolean).join(' · ')}
          </p>
          <p style={{ margin: '0 0 0.8rem', whiteSpace: 'pre-wrap' }}>{t.description || 'Aucune consigne complémentaire.'}</p>
          {t.checklist && t.checklist.length > 0 && (
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {t.checklist.map((c, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={c.done} onChange={() => onToggleChecklistItem(i)} style={{ accentColor: 'var(--primary)' }} />
                  <span style={{ textDecoration: c.done ? 'line-through' : undefined, color: c.done ? 'var(--ink-3)' : undefined }}>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Fermer</button>
          <button className="btn" onClick={onEdit}>Modifier</button>
          <button className="btn primary" onClick={onToggleDone}>{t.status === 'done' ? 'Remettre à faire' : 'Terminer la tâche'}</button>
        </div>
      </div>
    </div>
  );
}

function TaskFormModal({
  people, worksites, existing, onClose, onSubmit,
}: {
  people: { id: string; name: string }[];
  worksites: { id: string; name: string; city: string | null; managerId: string | null }[];
  existing: Task | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>, again: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [worksiteId, setWorksiteId] = useState(existing?.worksite?.id ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(existing?.assignees.map((a) => a.id) ?? []);
  const [dueOn, setDueOn] = useState(existing?.dueOn ? existing.dueOn.slice(0, 10) : '');
  const [priority, setPriority] = useState(existing?.priority ?? 'normal');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [checklistText, setChecklistText] = useState((existing?.checklist ?? []).map((c) => c.label).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ws = worksites.find((w) => w.id === worksiteId);
  const manager = ws?.managerId ? people.find((p) => p.id === ws.managerId) : null;

  function reset() {
    setTitle(''); setDueOn(''); setPriority('normal'); setDescription(''); setChecklistText('');
  }

  function buildBody() {
    const existingChecked = new Map((existing?.checklist ?? []).map((c) => [c.label, c.done]));
    const checklist = checklistText.split('\n').map((s) => s.trim()).filter(Boolean).map((label) => ({ label, done: existingChecked.get(label) ?? false }));
    return {
      title: title.trim(),
      worksiteId: worksiteId || null,
      description: description.trim() || null,
      priority,
      checklist,
      assigneeIds,
      dueOn: dueOn || null,
    };
  }

  async function submit(again: boolean) {
    if (!title.trim()) { setError('Indiquez ce qu’il faut faire.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(buildBody(), again);
      if (again) reset();
    } catch (e) {
      setError((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <div className="modal-head">
          <h2>{existing ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: '1.1rem', gridTemplateColumns: '1fr' }}>
          {error && <div className="plan-form-error">{error}</div>}
          <div className="field">
            <label>Que faut-il faire ?</label>
            <input className="input" autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Vérifier les raccords avant remise en eau" />
          </div>
          {!existing && (
            <div className="field">
              <label>Partir d’un modèle</label>
              <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                {TEMPLATES.map((tpl) => (
                  <button key={tpl.label} type="button" className="btn" onClick={() => { setTitle(tpl.title); setChecklistText(tpl.checklist.join('\n')); }}>
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Chantier <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>— vide = tâche générale</span></label>
            <ComboBox
              placeholder="Choisir un chantier…"
              value={worksiteId}
              onChange={setWorksiteId}
              options={worksites.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
          {ws && (
            <div className="wiz-note full">
              <strong>{ws.name}</strong>
              <div>{ws.city ?? ''}{manager ? ` · Référent : ${manager.name}` : ''}</div>
              {manager && (
                <button type="button" className="btn" style={{ marginTop: '0.5rem' }} onClick={() => setAssigneeIds((cur) => (cur.includes(manager.id) ? cur : [...cur, manager.id]))}>
                  Attribuer au référent
                </button>
              )}
            </div>
          )}
          <div className="field">
            <label>Responsable(s) <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>— vide = à attribuer</span></label>
            <AssigneePicker people={people} value={assigneeIds} onChange={setAssigneeIds} />
          </div>
          <div className="field">
            <label>Échéance</label>
            <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <div className="row" style={{ gap: '0.4rem', marginTop: '-0.6rem' }}>
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>Échéance rapide</span>
            <button type="button" className="btn" onClick={() => setDueOn(toDateInput(new Date()))}>Aujourd’hui</button>
            <button type="button" className="btn" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); setDueOn(toDateInput(d)); }}>Demain</button>
            <button type="button" className="btn" onClick={() => setDueOn('')}>Sans date</button>
          </div>
          <div className="field">
            <label>Priorité</label>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {WORKSITE_PRIORITIES.map((p) => <option key={p} value={p}>{WORKSITE_PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Consignes et checklist <span className="muted" style={{ fontWeight: 400 }}>facultatif</span></summary>
            <div className="field" style={{ marginTop: '0.8rem' }}>
              <label>Consignes</label>
              <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Accès, zone concernée, précautions, résultat attendu…" />
            </div>
            <div className="field">
              <label>Points à vérifier — un par ligne</label>
              <textarea className="input" rows={3} value={checklistText} onChange={(e) => setChecklistText(e.target.value)} placeholder={'Prendre les photos avant travaux\nContrôler l’étanchéité'} />
            </div>
          </details>
          <p className="hint" style={{ margin: 0 }}>Cette tâche sera visible dans le dossier du chantier. Elle ne réserve pas de créneau ni de matériel dans le planning.</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          {!existing && <button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>Créer et continuer</button>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? '…' : existing ? 'Enregistrer' : 'Créer la tâche'}</button>
        </div>
      </form>
    </div>
  );
}
