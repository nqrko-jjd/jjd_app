'use client';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';

interface Issue {
  id: string; entity: string; sheet: string | null; rowRef: string | null;
  severity: string; message: string; resolved: boolean;
}

const ENTITY_LABEL: Record<string, string> = {
  worksite: 'Chantiers', ledger: 'Grand livre', time_entry: 'Pointage',
  contact: 'Contacts', person: 'Personnes',
};

export default function ControlePage() {
  const [resolved, setResolved] = useState('0');
  const [entity, setEntity] = useState('');
  const params = new URLSearchParams({ resolved });
  if (entity) params.set('entity', entity);
  const { data, loading, reload } = useApi<{ items: Issue[]; openBySeverity: Record<string, number> }>(`/api/imports/issues?${params}`);

  async function resolve(id: string) {
    await api(`/api/imports/issues/${id}`, { method: 'PATCH', body: { resolved: true } });
    reload();
  }

  return (
    <>
      <PageHead
        title="File de contrôle"
        sub="Données de l'import qui demandent une vérification manuelle"
      />
      {data && (
        <div className="row" style={{ marginBottom: '1rem' }}>
          <span className="badge crit">{data.openBySeverity.error ?? 0} erreurs</span>
          <span className="badge warn">{data.openBySeverity.warning ?? 0} avertissements</span>
          <span className="badge">{data.openBySeverity.info ?? 0} infos</span>
          <span style={{ flex: 1 }} />
          <select className="select" style={{ maxWidth: 180 }} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Toutes catégories</option>
            {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 150 }} value={resolved} onChange={(e) => setResolved(e.target.value)}>
            <option value="0">À traiter</option>
            <option value="1">Traités</option>
          </select>
        </div>
      )}
      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && <div className="card card-pad muted">Rien à traiter ici.</div>}
      {data && data.items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Sévérité</th><th>Catégorie</th><th>Ligne</th><th>Message</th><th></th></tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td><span className={`badge ${i.severity === 'error' ? 'crit' : i.severity === 'warning' ? 'warn' : ''}`}>{i.severity}</span></td>
                  <td>{ENTITY_LABEL[i.entity] ?? i.entity}</td>
                  <td className="mono" style={{ fontSize: '0.78rem' }}>{i.rowRef ?? '—'}</td>
                  <td>{i.message}</td>
                  <td>{!i.resolved && <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => resolve(i.id)}>Traité</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
