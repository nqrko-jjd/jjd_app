'use client';
import { use } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, StatusBadge, Money, formatDateBE } from '@/lib/ui';

interface Detail {
  building: {
    id: string; name: string; address: string | null; city: string | null; note: string | null;
    syndic: { id: string; name: string; email: string | null; phone: string | null } | null;
    client: { id: string; name: string } | null;
    worksites: {
      id: string; ref: string; title: string; status: string; quotedHt: number | null; endedOn: string | null;
      manager: { firstName: string; displayName: string | null } | null;
    }[];
  };
}

export default function ImmeubleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading } = useApi<Detail>(`/api/buildings/${id}`);
  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Immeuble introuvable.</div>;
  const b = data.building;

  return (
    <>
      <PageHead
        title={b.name}
        sub={[b.address, b.city].filter(Boolean).join(', ') || undefined}
        action={<Link href="/immeubles" className="btn">← Immeubles</Link>}
      />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '1.4rem' }}>
        {b.syndic && <Info label="Syndic" value={<>{b.syndic.name}<br /><span className="muted" style={{ fontSize: '0.8rem' }}>{b.syndic.email ?? b.syndic.phone ?? ''}</span></>} />}
        {b.client && <Info label="Client" value={<Link href={`/contacts/${b.client.id}`}>{b.client.name}</Link>} />}
        <Info label="Interventions" value={`${b.worksites.length}`} />
      </div>

      <section>
        <h2 style={{ marginBottom: '0.7rem' }}>Interventions</h2>
        {b.worksites.length === 0 ? (
          <div className="card card-pad muted">Aucune intervention.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Réf</th><th>Objet</th><th>Chef</th><th>Statut</th><th style={{ textAlign: 'right' }}>Devisé</th><th>Fin</th></tr></thead>
              <tbody>
                {b.worksites.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.ref}</td>
                    <td><Link href={`/chantiers/${w.id}`}>{w.title}</Link></td>
                    <td>{w.manager?.displayName ?? w.manager?.firstName ?? '—'}</td>
                    <td><StatusBadge status={w.status} /></td>
                    <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
                    <td className="tnum">{w.endedOn ? formatDateBE(w.endedOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="eyebrow">{label}</div>
      <div style={{ marginTop: '0.3rem', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
