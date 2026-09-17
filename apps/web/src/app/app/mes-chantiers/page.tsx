'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, StatusBadge } from '@/lib/ui';

interface WS {
  id: string; ref: string; title: string; status: string; city: string | null;
  client: { name: string } | null;
  building: { name: string; photoThumbUrl: string | null } | null;
}

export default function MesChantiersPage() {
  const [q, setQ] = useState('');
  const { data } = useApi<{ items: WS[] }>(`/api/worksites/mine${q ? `?q=${encodeURIComponent(q)}` : ''}`);

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
      {(data?.items.length ?? 0) === 0 && <div className="card card-pad muted">Aucun chantier pour l’instant.</div>}
      {data?.items.map((w) => (
        <Link key={w.id} href={`/app/fiche/${w.id}`} className="card" style={{ display: 'block', marginBottom: '0.7rem', overflow: 'hidden' }}>
          {w.building?.photoThumbUrl && (
            <div style={{ height: 140 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.building.photoThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div className="card-pad row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 700 }}>{w.ref}</span> — {w.title}
              {w.city && <div className="muted">{w.city}</div>}
            </div>
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <StatusBadge status={w.status} />
              <span className="muted">→</span>
            </div>
          </div>
        </Link>
      ))}
    </>
  );
}
