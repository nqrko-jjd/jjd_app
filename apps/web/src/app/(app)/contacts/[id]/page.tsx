'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, Money } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { CONTACT_FIELDS } from '@/lib/forms';
import { CLIENT_KIND_LABEL, formatVat } from '@jjd/shared';

interface Detail {
  contact: {
    id: string; name: string; type: string; kind: string | null;
    email: string | null; phone: string | null; vat: string | null;
    address: string | null; postalCode: string | null; city: string | null; note: string | null;
    syndic: { id: string; name: string } | null;
    buildings: { id: string; name: string }[];
    worksites: { id: string; ref: string; title: string; status: string; quotedHt: number | null }[];
  };
}

export default function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, reload } = useApi<Detail>(`/api/contacts/${id}`);
  const [editing, setEditing] = useState(false);
  if (loading) return <div className="empty">Chargement…</div>;
  if (!data) return <div className="empty">Contact introuvable.</div>;
  const c = data.contact;

  return (
    <>
      {editing && (
        <FormModal
          title={`Modifier ${c.name}`}
          fields={CONTACT_FIELDS}
          initial={{
            name: c.name, type: c.type, kind: c.kind, email: c.email, phone: c.phone,
            vat: c.vat, address: c.address, postalCode: c.postalCode, city: c.city, note: c.note,
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => { await api(`/api/contacts/${id}`, { method: 'PATCH', body: v }); reload(); }}
        />
      )}
      <PageHead
        title={c.name}
        sub={c.kind ? CLIENT_KIND_LABEL[c.kind as keyof typeof CLIENT_KIND_LABEL] : c.type}
        action={
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
            <Link href="/contacts" className="btn">← Contacts</Link>
          </div>
        }
      />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '1.4rem' }}>
        <Info label="E-mail" value={c.email ?? '—'} />
        <Info label="Téléphone" value={c.phone ?? '—'} />
        <Info label="TVA" value={formatVat(c.vat) ?? '—'} />
        <Info label="Adresse" value={[c.address, c.postalCode, c.city].filter(Boolean).join(' ') || '—'} />
        {c.syndic && <Info label="Syndic" value={<Link href={`/immeubles?syndicId=${c.syndic.id}`}>{c.syndic.name}</Link>} />}
      </div>

      {c.buildings.length > 0 && (
        <section style={{ marginBottom: '1.4rem' }}>
          <h2 style={{ marginBottom: '0.7rem' }}>Immeubles ({c.buildings.length})</h2>
          <div className="row">
            {c.buildings.map((b) => (
              <Link key={b.id} href={`/immeubles/${b.id}`} className="badge primary">{b.name}</Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ marginBottom: '0.7rem' }}>Chantiers ({c.worksites.length})</h2>
        {c.worksites.length === 0 ? (
          <div className="card card-pad muted">Aucun chantier.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Réf</th><th>Chantier</th><th>Statut</th><th style={{ textAlign: 'right' }}>Devisé</th></tr></thead>
              <tbody>
                {c.worksites.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.ref}</td>
                    <td><Link href={`/chantiers/${w.id}`}>{w.title}</Link></td>
                    <td><StatusBadge status={w.status} /></td>
                    <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
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
