'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalHeader } from '../../PortalHeader';

interface Building {
  id: string; name: string; address: string; syndic: string | null;
  worksites: { id: string; ref: string; title: string; status: string }[];
}
const STATUS: Record<string, string> = {
  to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours', on_hold: 'En attente',
  done: 'Terminé', to_invoice: 'À facturer', invoiced: 'Facturé', closed: 'Clôturé', cancelled: 'Annulé', lead: 'Demande',
};

export default function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = usePortalGuard();
  const [b, setB] = useState<Building | null>(null);

  useEffect(() => {
    if (!me) return;
    portalApi<{ buildings: Building[] }>('/buildings')
      .then((r) => setB(r.buildings.find((x) => x.id === id) ?? null))
      .catch(() => {});
  }, [me, id]);

  if (loading || !me) return null;

  return (
    <>
      <PortalHeader />
      <main className="p-main">
        <Link href="/portail/accueil" className="p-back">← Mes immeubles</Link>
        {!b ? <p className="p-note">Chargement…</p> : (
          <>
            <div className="p-hero">
              <h1>{b.name}</h1>
              <p>{b.address || ''}{b.syndic ? ` · syndic ${b.syndic}` : ''}</p>
            </div>
            <h2 style={{ marginBottom: '0.9rem' }}>Interventions</h2>
            <div className="p-list">
              {b.worksites.map((w) => (
                <Link key={w.id} href={`/portail/chantier/${w.id}`} className="p-tile">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span className="name">{w.title}</span>
                    <span className="p-pill">{STATUS[w.status] ?? w.status}</span>
                  </div>
                  <div className="meta">{w.ref}</div>
                </Link>
              ))}
              {b.worksites.length === 0 && <p className="p-note">Aucune intervention.</p>}
            </div>
          </>
        )}
      </main>
    </>
  );
}
