'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface Building {
  id: string; name: string; address: string; city: string | null; syndic: string | null; open: number;
  lotCount: number | null; photoThumbUrl: string | null;
  worksites: { id: string }[];
}

export default function PortalBuildings() {
  const { me, loading } = usePortalGuard();
  const [items, setItems] = useState<Building[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (me) portalApi<{ buildings: Building[] }>('/buildings').then((r) => setItems(r.buildings)).catch(() => {});
  }, [me]);

  if (loading || !me) return null;
  const filtered = (items ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase()) || b.address.toLowerCase().includes(q.toLowerCase()));

  return (
    <PortalShell title={me.isSyndic ? 'Immeubles / ACP' : 'Mes dossiers'} subtitle={`${items?.length ?? 0} au total`}>
      <input className="p-input" style={{ maxWidth: 280 }} placeholder="Rechercher un immeuble…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!items ? <div className="p-empty">Chargement…</div> : filtered.length === 0 ? <div className="p-empty">Aucun immeuble.</div> : (
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
