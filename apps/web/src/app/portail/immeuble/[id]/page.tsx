'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../../PortalShell';

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
  const router = useRouter();
  const [b, setB] = useState<Building | null>(null);

  useEffect(() => {
    if (!me) return;
    portalApi<{ buildings: Building[] }>('/buildings')
      .then((r) => setB(r.buildings.find((x) => x.id === id) ?? null))
      .catch(() => {});
  }, [me, id]);

  if (loading || !me) return null;

  return (
    <PortalShell>
      <Link href="/portail/immeubles" className="p-back">← Tous les immeubles</Link>
      {!b ? <p className="p-note">Chargement…</p> : (
        <>
          <div className="p-hero sm">
            <div className="eyebrow">Immeuble</div>
            <h1>{b.name}</h1>
            <div className="sub">{b.address || ''}{b.syndic ? ` · syndic ${b.syndic}` : ''}</div>
          </div>
          <h2 style={{ margin: '1.3rem 0 0.9rem' }}>Interventions</h2>
          <div className="p-panel" style={{ padding: '0.4rem 1rem' }}>
            <table className="p-tbl">
              <tbody>
                {b.worksites.map((w) => (
                  <tr key={w.id} onClick={() => router.push(`/portail/chantier/${w.id}`)} style={{ cursor: 'pointer' }}>
                    <td><span className="b-ico">⌂</span>{w.title}</td>
                    <td className="p-note" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{w.ref}</td>
                    <td style={{ textAlign: 'right' }}><span className="p-tag">{STATUS[w.status] ?? w.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {b.worksites.length === 0 && <p className="p-note" style={{ padding: '0.8rem 0' }}>Aucune intervention.</p>}
          </div>
        </>
      )}
    </PortalShell>
  );
}
