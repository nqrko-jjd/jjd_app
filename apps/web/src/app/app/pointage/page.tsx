'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { formatHours } from '@jjd/shared';

interface Pending {
  id: string; date: string | null; hours: number | null; amount: number | null; task: string | null;
  geoFlag: boolean; geoDistance: number | null;
  person: { displayName: string | null; firstName: string };
  worksite: { ref: string; title: string } | null;
}

export default function PointagePage() {
  const { data, loading, reload } = useApi<{ items: Pending[] }>('/api/timesheet/pending');

  async function act(id: string, action: 'approve' | 'reject') {
    await api(`/api/timesheet/entries/${id}/${action}`, { method: 'POST' });
    reload();
  }
  async function approveAll() {
    const r = await api<{ approved: number }>('/api/timesheet/entries/approve-all', { method: 'POST' });
    alert(`${r.approved} pointage(s) validé(s).`);
    reload();
  }

  const items = data?.items ?? [];
  const totalHours = items.reduce((a, e) => a + (e.hours ?? 0), 0);
  const totalAmount = items.reduce((a, e) => a + (e.amount ?? 0), 0);
  const flagged = items.filter((e) => e.geoFlag).length;

  // groupe par personne
  const byPerson = new Map<string, Pending[]>();
  for (const e of items) {
    const k = e.person.displayName || e.person.firstName;
    byPerson.set(k, [...(byPerson.get(k) ?? []), e]);
  }

  return (
    <>
      <PageHead
        title="Pointage"
        sub="Heures à valider avant le décompte de paie"
        action={
          <div className="row">
            {items.length > 0 && <button className="btn primary" onClick={approveAll}>Tout valider{flagged ? ' (sauf hors zone)' : ''}</button>}
            <Link href="/app/pointage/decomptes" className="btn">Décomptes du mois →</Link>
          </div>
        }
      />

      {items.length > 0 && (
        <div className="kpis" style={{ marginBottom: '1.4rem' }}>
          <div className="kpi"><span className="ic">◷</span><div className="label">À valider</div><div className="value">{items.length}</div></div>
          <div className="kpi"><span className="ic">Σ</span><div className="label">Heures</div><div className="value">{formatHours(totalHours)}</div></div>
          <div className="kpi"><span className="ic">€</span><div className="label">Montant</div><div className="value"><Money value={totalAmount} /></div></div>
          <div className={`kpi${flagged ? ' warn' : ''}`}><span className="ic">⚑</span><div className="label">Hors zone</div><div className="value">{flagged}</div></div>
        </div>
      )}

      {loading && <div className="empty">Chargement…</div>}
      {data && items.length === 0 && (
        <div className="card card-pad muted">Rien à valider. Le compteur des ouvriers alimente cette file.</div>
      )}

      {[...byPerson.entries()].map(([name, entries]) => (
        <div key={name} style={{ marginBottom: '1.3rem' }}>
          <div className="section-title">
            {name} <span className="hint">{entries.length} · {formatHours(entries.reduce((a, e) => a + (e.hours ?? 0), 0))} · <Money value={entries.reduce((a, e) => a + (e.amount ?? 0), 0)} /></span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Date</th><th>Chantier</th><th>Tâche</th><th>Lieu</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} style={e.geoFlag ? { background: 'var(--warn-soft)' } : undefined}>
                    <td className="tnum">{formatDateBE(e.date)}</td>
                    <td>{e.worksite ? <><span className="mono">{e.worksite.ref}</span> {e.worksite.title}</> : <span className="muted">—</span>}</td>
                    <td className="muted">{e.task ?? '—'}</td>
                    <td>
                      {e.geoFlag
                        ? <span className="badge crit" title={`Pointé à ${e.geoDistance} m du chantier`}>Hors zone · {e.geoDistance} m</span>
                        : e.geoDistance != null ? <span className="badge ok">Sur place</span>
                        : <span className="muted" style={{ fontSize: '0.8rem' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="tnum">{formatHours(e.hours)}</td>
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
        </div>
      ))}
    </>
  );
}
