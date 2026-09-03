'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead } from '@/lib/ui';

interface Building {
  id: string; name: string; city: string | null;
  syndic: { id: string; name: string } | null;
  _count: { worksites: number };
}

export default function ImmeublesPage() {
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const { data, loading } = useApi<{ items: Building[] }>(`/api/buildings?${params}`);

  return (
    <>
      <PageHead title="Immeubles / ACP" sub={data ? `${data.items.length} dossiers` : undefined} />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Nom, ville…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && (
        <div className="card card-pad muted">
          Peu d'immeubles pour l'instant — ils se remplissent avec l'import des contacts TrustUp (les ACP « c/o Syndic »).
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Immeuble</th><th>Syndic</th><th>Ville</th><th style={{ textAlign: 'right' }}>Chantiers</th></tr></thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/immeubles/${b.id}`}>{b.name}</Link></td>
                  <td>{b.syndic?.name ?? '—'}</td>
                  <td>{b.city ?? '—'}</td>
                  <td style={{ textAlign: 'right' }} className="tnum">{b._count.worksites || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
