'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalHeader } from '../PortalHeader';

interface Building {
  id: string; name: string; address: string; syndic: string | null; open: number;
  worksites: { id: string; ref: string; title: string; status: string }[];
}
interface WS {
  id: string; ref: string; title: string; statusLabel: string;
  building: { id: string; name: string } | null; urgent: boolean;
}

export default function PortalHome() {
  const { me, loading } = usePortalGuard();
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [worksites, setWorksites] = useState<WS[] | null>(null);

  useEffect(() => {
    if (!me) return;
    portalApi<{ buildings: Building[] }>('/buildings').then((r) => setBuildings(r.buildings)).catch(() => {});
    portalApi<{ items: WS[] }>('/worksites').then((r) => setWorksites(r.items)).catch(() => {});
  }, [me]);

  if (loading || !me) return null;
  const urgent = (worksites ?? []).filter((w) => w.urgent);

  return (
    <>
      <PortalHeader />
      <main className="p-main">
        <div className="p-hero">
          <h1>Bonjour {me.label}</h1>
          <p>{me.isSyndic ? 'Vos immeubles et leurs interventions.' : 'Vos chantiers avec JJD Consult.'}</p>
        </div>

        {urgent.length > 0 && (
          <div className="p-urgent">
            <span className="dot" />
            <div>
              <strong>{urgent.length} intervention{urgent.length > 1 ? 's' : ''} à suivre</strong>
              <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {urgent.map((w) => (
                  <Link key={w.id} href={`/portail/chantier/${w.id}`} className="p-pill warn">{w.ref} — {w.statusLabel}</Link>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
          <h2>{me.isSyndic ? 'Immeubles / ACP' : 'Dossiers'}</h2>
          <Link href="/portail/demande" className="p-btn primary">Nouvelle demande</Link>
        </div>

        {me.isSyndic ? (
          <div className="p-list">
            {(buildings ?? []).map((b) => (
              <Link key={b.id} href={`/portail/immeuble/${b.id}`} className="p-tile">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="name">{b.name}</span>
                  {b.open > 0 && <span className="p-pill">{b.open} en cours</span>}
                </div>
                <div className="meta">{b.address || '—'} · {b.worksites.length} intervention(s)</div>
              </Link>
            ))}
            {buildings && buildings.length === 0 && <p className="p-note">Aucun immeuble pour le moment.</p>}
          </div>
        ) : (
          <div className="p-list">
            {(worksites ?? []).map((w) => (
              <Link key={w.id} href={`/portail/chantier/${w.id}`} className="p-tile">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="name">{w.title}</span>
                  <span className={`p-pill${w.urgent ? ' warn' : ''}`}>{w.statusLabel}</span>
                </div>
                <div className="meta">{w.ref}{w.building ? ` · ${w.building.name}` : ''}</div>
              </Link>
            ))}
            {worksites && worksites.length === 0 && <p className="p-note">Aucun chantier pour le moment.</p>}
          </div>
        )}
      </main>
    </>
  );
}
