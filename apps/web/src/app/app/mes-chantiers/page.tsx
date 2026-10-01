'use client';
import { useState } from 'react';
import Link from 'next/link';
import { HardHat } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { useApi } from '@/lib/use-api';
import { PageHead, StatusBadge } from '@/lib/ui';

interface WS {
  id: string; ref: string; title: string; status: string; city: string | null;
  client: { name: string } | null;
  building: { name: string; photoThumbUrl: string | null } | null;
}

export default function MesChantiersPage() {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi<{ items: WS[] }>(`/api/worksites/mine${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <>
      <PageHead eyebrow="Mon espace ouvrier" title="Mes chantiers" sub="Chantiers où tu es affecté ou as pointé" />
      <input
        className="input"
        style={{ marginBottom: '1rem', maxWidth: 360 }}
        placeholder="Rechercher (réf, titre, ville)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {loading && !data && <SkeletonRows rows={4} height={88} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <EmptyState icon={HardHat} title={q ? 'Aucun chantier ne correspond' : 'Aucun chantier pour l’instant'} text={q ? `Rien ne correspond à « ${q} ». Vérifiez l’orthographe ou effacez la recherche.` : 'Les chantiers qui vous sont assignés apparaissent ici. Contactez le bureau s’il en manque.'} action={q ? <button type="button" className="btn primary" onClick={() => setQ('')}>Effacer la recherche</button> : undefined} />
      )}
      <div className="worker-worksites">{data?.items.map((w) => (
        <Link key={w.id} href={`/app/fiche/${w.id}`} className="card worker-worksite-card" style={{ display: 'block', marginBottom: '0.7rem', overflow: 'hidden' }}>
          {w.building?.photoThumbUrl && (
            <div style={{ height: 140 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.building.photoThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div className="card-pad worker-worksite-body" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="eyebrow">{w.ref}</div><h2 className="worker-mission-title">{w.title}</h2>
              {w.city && <div className="muted">{w.city}</div>}
            </div>
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <StatusBadge status={w.status} />
              <span className="muted">→</span>
            </div>
          </div>
        </Link>
      ))}</div>
    </>
  );
}
