'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { PortalShell } from '../PortalShell';

interface Building {
  id: string; name: string; address: string; city: string | null; syndic: string | null; open: number;
  lotCount: number | null; photoThumbUrl: string | null;
  worksites: { id: string }[];
}

export default function PortalBuildings() {
  const { me, loading } = usePortalGuard();
  const [q, setQ] = useState('');
  const { data, error, reload } = usePortalApi<{ buildings: Building[] }>(me ? '/buildings' : null);
  const items = data?.buildings ?? null;

  if (loading || !me) return null;
  const filtered = (items ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase()) || b.address.toLowerCase().includes(q.toLowerCase()));

  return (
    <PortalShell title={me.isSyndic ? 'Immeubles / ACP' : 'Mes dossiers'} subtitle={`${items?.length ?? 0} au total`}>
      <input className="p-input" style={{ maxWidth: 280 }} placeholder="Rechercher un immeuble…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <ErrorState message={error} onRetry={reload} /> : !items ? <SkeletonRows rows={4} height={150} /> : filtered.length === 0 ? <EmptyState icon={Building2} title={q ? 'Aucun immeuble ne correspond' : 'Aucun immeuble pour l’instant'} text={q ? `Rien ne correspond à « ${q} ». Vérifiez l’orthographe ou effacez la recherche.` : 'Les immeubles rattachés à votre compte apparaîtront ici. Contactez JJD Consult s’il en manque.'} action={q ? <button type="button" className="btn primary" onClick={() => setQ('')}>Effacer la recherche</button> : <Link href="/portail/demande" className="btn primary">Nouvelle demande</Link>} /> : (
        <div className="p-bgrid">
          {filtered.map((b) => (
            <Link key={b.id} href={`/portail/immeuble/${b.id}`} className="p-bcard">
              {b.photoThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <div className="photo"><img src={b.photoThumbUrl} alt="" /></div>
              ) : (
                <div className="photo" style={{ display: 'grid', placeItems: 'center', fontSize: '1.6rem', color: 'var(--p-green-600)' }}>⌂</div>
              )}
              <div className="body">
                {b.city && <div className="eyebrow">{b.city}</div>}
                <div className="name">{b.name}</div>
                <div className="meta">{b.lotCount ? `Copropriété · ${b.lotCount} lots` : (b.address || '—')}</div>
                <div className="foot">
                  <span className="meta">{b.worksites.length} intervention(s){b.syndic ? ` · ${b.syndic}` : ''}</span>
                  {b.open > 0 && <span className="p-tag gold">{b.open} en cours</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
