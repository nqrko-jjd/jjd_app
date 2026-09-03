'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { CONTACT_FIELDS } from '@/lib/forms';
import { CLIENT_KIND_LABEL, formatVat } from '@jjd/shared';

interface Contact {
  id: string; name: string; type: string; kind: string | null;
  email: string | null; phone: string | null; vat: string | null; city: string | null;
  syndic: { name: string } | null;
  _count: { worksites: number };
}

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ type });
  if (q) params.set('q', q);
  const { data, loading, reload } = useApi<{ items: Contact[] }>(`/api/contacts?${params}`);

  return (
    <>
      {creating && (
        <FormModal
          title="Nouveau contact"
          fields={CONTACT_FIELDS}
          initial={{ type: 'client' }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/contacts', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        title="Contacts"
        sub={data ? `${data.items.length} affichés` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau contact</button>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, ville, TVA…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 180 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">Tous</option>
          <option value="client">Clients</option>
          <option value="supplier">Fournisseurs</option>
        </select>
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Nom</th><th>Type</th><th>Ville</th><th>TVA</th><th>Contact</th><th style={{ textAlign: 'right' }}>Chantiers</th></tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/contacts/${c.id}`}>{c.name}</Link>
                    {c.syndic && <div className="muted" style={{ fontSize: '0.78rem' }}>c/o {c.syndic.name}</div>}
                  </td>
                  <td>{c.kind ? CLIENT_KIND_LABEL[c.kind as keyof typeof CLIENT_KIND_LABEL] : c.type === 'supplier' ? 'Fournisseur' : '—'}</td>
                  <td>{c.city ?? '—'}</td>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{formatVat(c.vat) ?? '—'}</td>
                  <td>{c.email ?? c.phone ?? '—'}</td>
                  <td style={{ textAlign: 'right' }} className="tnum">{c._count.worksites || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
