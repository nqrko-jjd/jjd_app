'use client';
import { useState } from 'react';
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

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function MesHeuresPage() {
  const { person } = useAuth();
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1);
    setY(d.getFullYear()); setM(d.getMonth() + 1);
  }

  const from = new Date(y, m - 1, 1).toISOString();
  const to = new Date(y, m, 1).toISOString();

  const { data: mine } = useApi<{ items: Entry[] }>(`/api/timesheet/mine?from=${from}&to=${to}`);
  const { data: statement } = useApi<Statement>(person ? `/api/statements/${person.id}?year=${y}&month=${m}` : null);

  return (
    <>
      <PageHead title="Mes heures" sub="Historique de pointage" />

      <div className="row" style={{ marginBottom: '1.2rem' }}>
        <button className="btn" onClick={() => shift(-1)}>←</button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{MONTHS[m - 1]} {y}</strong>
        <button className="btn" onClick={() => shift(1)} disabled={isCurrentMonth}>→</button>
        {!isCurrentMonth && <button className="btn ghost" onClick={() => { setY(now.getFullYear()); setM(now.getMonth() + 1); }}>Ce mois-ci</button>}
      </div>

      {statement && (
        <div className="kpis" style={{ marginBottom: '1.2rem' }}>
          <div className="kpi"><span className="ic">Σ</span><div className="label">Heures</div><div className="value">{formatHours(statement.totalHours)}</div></div>
          <div className="kpi"><span className="ic">€</span><div className="label">Montant</div><div className="value"><Money value={statement.totalAmount} /></div></div>
          {statement.pendingCount > 0 && (
            <div className="kpi warn"><span className="ic">⏳</span><div className="label">À valider</div><div className="value">{statement.pendingCount}</div></div>
          )}
        </div>
      )}

      <div className="section-title">Détail</div>
      {(mine?.items.length ?? 0) === 0 && <div className="card card-pad muted">Aucun pointage sur ce mois.</div>}
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
