'use client';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { PortalShell } from '../../PortalShell';

interface Building {
  id: string; name: string; address: string; syndic: string | null; manager: string | null;
  lotCount: number | null; photoThumbUrl: string | null;
  worksites: { id: string; ref: string; title: string; status: string; updatedAt: string }[];
}
const STATUS: Record<string, string> = {
  to_plan: 'À planifier', scheduled: 'Planifié', in_progress: 'En cours', on_hold: 'En attente',
  done: 'Terminé', to_invoice: 'À facturer', invoiced: 'Facturé', closed: 'Clôturé', cancelled: 'Annulé', lead: 'Demande',
};
const fdate = (s: string) => new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' });

export default function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = usePortalGuard();
  const router = useRouter();
  const { data, error, reload } = usePortalApi<{ buildings: Building[] }>(me ? '/buildings' : null);
  const b = data?.buildings.find((x) => x.id === id) ?? null;

  if (loading || !me) return null;

  return (
    <PortalShell>
      <Link href="/portail/immeubles" className="p-back">← Tous les immeubles</Link>
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <SkeletonRows rows={4} height={90} /> : !b ? (
        <EmptyState icon={Building2} title="Immeuble introuvable" text="Cet immeuble n’existe pas ou n’est pas rattaché à votre compte." action={<Link href="/portail/immeubles" className="btn primary">Tous les immeubles</Link>} />
      ) : (
        <>
          <div className="p-hero sm">
            <div className="eyebrow">Immeuble</div>
            <h1>{b.name}</h1>
            <div className="sub">{b.address || ''}{b.syndic ? ` · syndic ${b.syndic}` : ''}</div>
          </div>
          {b.photoThumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <div className="p-card" style={{ overflow: 'hidden', height: 220 }}>
              <img src={b.photoThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          {(b.lotCount != null || b.manager) && (
            <div className="p-card p-card-pad" style={{ background: 'var(--p-green-soft)', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none' }}>
              <span>
                {b.lotCount != null ? `Copropriété · ${b.lotCount} lots` : ''}
                {b.lotCount != null && b.manager ? ' · ' : ''}
                {b.manager ? `Interlocuteur JJD : ${b.manager}` : ''}
              </span>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', margin: '1.3rem 0 0.9rem' }}>
            <h2 style={{ margin: 0 }}>Interventions</h2>
            <Link href={`/portail/demande?building=${b.id}`} className="p-btn-primary p-btn-gold" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
              + Nouvelle intervention
            </Link>
          </div>
          <div className="p-panel" style={{ padding: '0.4rem 0.5rem' }}>
            <div className="p-ilist">
              {b.worksites.map((w) => (
                <div key={w.id} className="p-irow" onClick={() => router.push(`/portail/chantier/${w.id}`)}>
                  <span className="ico">⌂</span>
                  <div className="body">
                    <div className="t">{w.title}</div>
                    <div className="s">{w.ref}</div>
                  </div>
                  <div className="right">
                    <span className="p-tag">{STATUS[w.status] ?? w.status}</span>
                    <div className="d">{fdate(w.updatedAt)}</div>
                  </div>
                  <span className="chev">→</span>
                </div>
              ))}
            </div>
            {b.worksites.length === 0 && <p className="p-note" style={{ padding: '0.8rem 0' }}>Aucune intervention sur cet immeuble pour l’instant. <Link href={`/portail/demande?building=${b.id}`} style={{ color: 'var(--p-green-600)', fontWeight: 700 }}>Faire une demande →</Link></p>}
          </div>
        </>
      )}
    </PortalShell>
  );
}
