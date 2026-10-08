'use client';
import Link from 'next/link';
import { ChevronRight, ListChecks } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { formatDateBE } from '@/lib/ui';

interface MyTask {
  id: string; title: string; status: string; priority: string; dueOn: string | null;
  assignees: { id: string; name: string }[];
  worksite: { ref: string; title: string } | null;
}
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dueDate(task: MyTask) { return task.dueOn ? localDate(new Date(task.dueOn)) : ''; }

/** Only personal pending tasks. Server derives mine from the authenticated user. */
export function DashboardMyTasks() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<{ items: MyTask[] }>(user?.personId ? '/api/tasks?mine=1' : null);
  const today = localDate(new Date());
  const priority: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const tasks = (data?.items ?? []).filter((t) => t.status !== 'done' && t.assignees.some((a) => a.id === user?.personId)).sort((a, b) => {
    const da = dueDate(a); const db = dueDate(b);
    const ga = da && da < today ? 0 : da === today ? 1 : 2;
    const gb = db && db < today ? 0 : db === today ? 1 : 2;
    return ga - gb || (da || '9999').localeCompare(db || '9999') || (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2) || a.title.localeCompare(b.title);
  });

  return <div style={{ borderBottom: '1px solid var(--line)' }}>
    <div className="panelhead"><h2><ListChecks size={18} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 7 }}/>Mes tâches{data && <span className="hint" style={{ marginLeft: 7 }}>{tasks.length}</span>}</h2><Link className="hint" href="/app/taches?view=mine">Voir tout →</Link></div>
    {!user?.personId ? <p className="muted" style={{ padding: '0 18px 16px', margin: 0 }}>Votre compte doit être lié à votre fiche personne pour afficher vos tâches.</p> : loading ? <p className="muted" role="status" style={{ padding: '0 18px 16px', margin: 0 }}>Chargement de vos tâches…</p> : error ? <div role="alert" style={{ padding: '0 18px 16px' }}><p className="muted">Impossible de charger vos tâches.</p><button className="btn ghost" type="button" onClick={reload}>Réessayer</button></div> : tasks.length === 0 ? <p className="muted" style={{ padding: '0 18px 16px', margin: 0 }}>Aucune tâche à faire ne vous est attribuée.</p> : <div className="alert-list">
      {tasks.slice(0, 4).map((t) => {
        const due = dueDate(t); const overdue = !!due && due < today;
        const label = !due ? 'Sans échéance' : overdue ? `En retard · ${formatDateBE(t.dueOn!)}` : due === today ? 'Aujourd’hui' : formatDateBE(t.dueOn!);
        return <Link key={t.id} href={`/app/taches?view=mine&taskId=${encodeURIComponent(t.id)}`} className={`alert ${overdue ? 'crit' : ''}`} style={{ minHeight: 62 }}>
          <span className="label" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t.title}<span className="n">{t.worksite ? `${t.worksite.ref} · ${t.worksite.title}` : 'Tâche générale'}</span><span style={{ display: 'block', fontSize: 12, marginTop: 4, color: overdue ? 'var(--crit)' : 'var(--ink-3)' }}>{label}{t.priority === 'urgent' ? ' · Urgent' : ''}</span></span><ChevronRight size={18} className="chev" aria-hidden="true"/>
        </Link>;
      })}
      {tasks.length > 4 && <Link className="dashboard-show-more" style={{ display: 'block', textAlign: 'center' }} href="/app/taches?view=mine">Voir mes {tasks.length} tâches</Link>}
    </div>}
  </div>;
}
