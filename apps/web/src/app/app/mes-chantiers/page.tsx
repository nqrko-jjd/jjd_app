'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, StatusBadge } from '@/lib/ui';

interface WS {
  id: string; ref: string; title: string; status: string; city: string | null;
  client: { name: string } | null;
}

export default function MesChantiersPage() {
  const [q, setQ] = useState('');
  const { data } = useApi<{ items: WS[] }>(`/api/worksites/mine${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <>
      <PageHead title="Mes chantiers" sub="Chantiers où tu es affecté ou as pointé" />
      <input
        className="input"
        style={{ marginBottom: '1rem', maxWidth: 360 }}
        placeholder="Rechercher (réf, titre, ville)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {(data?.items.length ?? 0) === 0 && <div className="card card-pad muted">Aucun chantier pour l’instant.</div>}
      {data?.items.map((w) => (
        <Link key={w.id} href={`/app/fiche/${w.id}`} className="card card-pad" style={{ display: 'block', marginBottom: '0.6rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 700 }}>{w.ref}</span> — {w.title}
              {w.city && <div className="muted">{w.city}</div>}
            </div>
            <StatusBadge status={w.status} />
          </div>
        </Link>
      ))}
    </>
  );
}
