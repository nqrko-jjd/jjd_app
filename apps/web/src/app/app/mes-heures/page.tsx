'use client';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { formatHours } from '@jjd/shared';

interface Entry {
  id: string; date: string | null; hours: number | null; amount: number | null; status: string; task: string | null;
  worksite: { ref: string; title: string } | null;
}
interface Statement {
  totalHours: number; totalAmount: number; pendingCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  running: 'en cours', submitted: 'à valider', approved: 'validé', rejected: 'refusé',
};

export default function MesHeuresPage() {
  const { person } = useAuth();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: mine } = useApi<{ items: Entry[] }>(`/api/timesheet/mine?from=${from}`);
  const { data: statement } = useApi<Statement>(
    person ? `/api/statements/${person.id}?year=${now.getFullYear()}&month=${now.getMonth() + 1}` : null,
  );

  return (
    <>
      <PageHead title="Mes heures" sub={now.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })} />

      {statement && (
        <div className="kpis" style={{ marginBottom: '1.2rem' }}>
          <div className="kpi"><span className="ic">Σ</span><div className="label">Heures ce mois</div><div className="value">{formatHours(statement.totalHours)}</div></div>
          <div className="kpi"><span className="ic">€</span><div className="label">Montant</div><div className="value"><Money value={statement.totalAmount} /></div></div>
          {statement.pendingCount > 0 && (
            <div className="kpi warn"><span className="ic">⏳</span><div className="label">À valider</div><div className="value">{statement.pendingCount}</div></div>
          )}
        </div>
      )}

      <div className="section-title">Détail</div>
      {(mine?.items.length ?? 0) === 0 && <div className="card card-pad muted">Aucun pointage ce mois.</div>}
      {mine?.items.map((e) => (
        <div key={e.id} className="card card-pad" style={{ marginBottom: '0.6rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>{e.worksite?.ref ?? '—'}</span>
            <span className="muted">{e.date ? formatDateBE(e.date) : ''}</span>
          </div>
          <div className="muted">{e.worksite?.title}</div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: '0.3rem' }}>
            <span>{e.hours != null ? formatHours(e.hours) : '—'} · {e.amount != null ? <Money value={e.amount} /> : '—'}</span>
            <span className={`badge ${e.status === 'approved' ? 'ok' : e.status === 'rejected' ? 'crit' : ''}`}>{STATUS_LABEL[e.status] ?? e.status}</span>
          </div>
        </div>
      ))}
    </>
  );
}
