'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { formatHours } from '@jjd/shared';

interface Pending {
  id: string; date: string | null; hours: number | null; amount: number | null; task: string | null;
  person: { displayName: string | null; firstName: string };
  worksite: { ref: string; title: string } | null;
}

export default function PointagePage() {
  const { data, loading, reload } = useApi<{ items: Pending[] }>('/api/timesheet/pending');

  async function act(id: string, action: 'approve' | 'reject') {
    await api(`/api/timesheet/entries/${id}/${action}`, { method: 'POST' });
    reload();
  }

  return (
    <>
      <PageHead
        title="Pointage"
        sub="Heures à valider avant le décompte de paie"
        action={<Link href="/pointage/decomptes" className="btn primary">Décomptes du mois →</Link>}
      />
      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && (
        <div className="card card-pad muted">Rien à valider. Le compteur des ouvriers alimente cette file.</div>
      )}
      {data && data.items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Ouvrier</th><th>Chantier</th><th>Tâche</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="tnum">{formatDateBE(e.date)}</td>
                  <td>{e.person.displayName || e.person.firstName}</td>
                  <td>{e.worksite ? <span className="mono">{e.worksite.ref}</span> : <span className="muted">—</span>} {e.worksite?.title}</td>
                  <td className="muted">{e.task ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{formatHours(e.hours)}</td>
                  <td style={{ textAlign: 'right' }}><Money value={e.amount} /></td>
                  <td>
                    <div className="row" style={{ gap: '0.3rem' }}>
                      <button className="btn primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => act(e.id, 'approve')}>Valider</button>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => act(e.id, 'reject')}>Refuser</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
