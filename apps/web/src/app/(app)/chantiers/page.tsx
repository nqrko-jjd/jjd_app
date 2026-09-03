'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, StatusBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { WORKSITE_STATUS_LABEL } from '@jjd/shared';

interface WS {
  id: string; ref: string; title: string; status: string; entity: string;
  city: string | null; quotedHt: number | null; endedOn: string | null;
  client: { name: string } | null;
  manager: { displayName: string | null; firstName: string } | null;
}

export default function ChantiersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const { data, loading } = useApi<{ items: WS[] }>(`/api/worksites?${params}`);

  return (
    <>
      <PageHead
        title="Chantiers"
        sub={data ? `${data.items.length} chantiers` : undefined}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Rechercher (réf, titre, ville)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(WORKSITE_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Réf</th><th>Chantier</th><th>Client</th><th>Chef</th>
                <th>Statut</th><th>Entité</th><th style={{ textAlign: 'right' }}>Devisé</th><th>Fin</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.ref}</td>
                  <td><Link href={`/chantiers/${w.id}`}>{w.title}</Link></td>
                  <td>{w.client?.name ?? '—'}</td>
                  <td>{w.manager?.displayName ?? w.manager?.firstName ?? '—'}</td>
                  <td><StatusBadge status={w.status} /></td>
                  <td><EntityBadge entity={w.entity} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
                  <td className="tnum">{w.endedOn ? formatDateBE(w.endedOn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
