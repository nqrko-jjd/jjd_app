'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Avatar } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { rowNav } from '@/lib/rowNav';
import { BUILDING_FIELDS } from '@/lib/forms';

interface Building {
  id: string; name: string; city: string | null;
  photoUrl: string | null; photoThumbUrl: string | null;
  syndic: { id: string; name: string } | null;
  _count: { worksites: number };
}

export default function ImmeublesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useViewMode('immeubles');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const { data, loading, reload } = useApi<{ items: Building[] }>(`/api/buildings?${params}`);
  const { data: pick } = useApi<{ syndics: { id: string; name: string }[] }>(creating ? '/api/meta/pickers' : null);

  return (
    <>
      {creating && (
        <FormModal
          title="Nouvel immeuble / projet"
          fields={BUILDING_FIELDS(pick?.syndics ?? [])}
          initial={{ kind: 'acp' }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/buildings', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        eyebrow="Gestion"
        title="Immeubles / Projets"
        sub={data ? `${data.items.length} dossiers` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvel immeuble</button>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Nom, ville…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && (
        <div className="card card-pad muted">
          Peu d'immeubles pour l'instant — ils se remplissent avec l'import des contacts TrustUp (les ACP « c/o Syndic »).
        </div>
      )}
      {data && data.items.length > 0 && mode === 'list' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Immeuble</th><th>Ville</th><th>Gestionnaire</th><th style={{ textAlign: 'right' }}>Chantiers</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id} className="row-link" onClick={rowNav(`/app/immeubles/${b.id}`, (h) => router.push(h))}>
                  <td><Avatar src={b.photoThumbUrl} label={b.name} /><Link href={`/app/immeubles/${b.id}`}>{b.name}</Link></td>
                  <td>{b.city ?? '—'}</td>
                  <td>{b.syndic?.name ?? '—'}</td>
                  <td style={{ textAlign: 'right' }} className="tnum">{b._count.worksites || ''}</td>
                  <td><span className={`badge ${b._count.worksites > 0 ? 'ok' : 'plain'}`}>{b._count.worksites > 0 ? 'Avec chantiers' : 'Aucun chantier'}</span></td>
                  <td className="muted">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.items.length > 0 && mode === 'gallery' && (
        <div className="building-grid">
          {data.items.map((b) => (
            <Link key={b.id} href={`/app/immeubles/${b.id}`} className="building-card">
              <div className="building-media">
                {b.photoThumbUrl ? <img src={b.photoThumbUrl} alt="" /> : <span className="fallback">⌂</span>}
              </div>
              <div className="building-body">
                {b.city && <div className="eyebrow">{b.city}</div>}
                <h2>{b.name}</h2>
                <p className="building-sub">{b.syndic?.name ?? 'Gestion privée'}</p>
                <div className="building-foot">
                  <span>
                    {b._count.worksites > 0
                      ? `Chantiers : ${b._count.worksites} intervention${b._count.worksites > 1 ? 's' : ''}`
                      : 'Aucun chantier'}
                  </span>
                  <span className={`badge ${b._count.worksites > 0 ? 'ok' : 'plain'}`}>
                    {b._count.worksites > 0 ? 'Avec chantiers' : 'Aucun chantier'}
                  </span>
                </div>
                <span className="building-link">Ouvrir le dossier →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
