'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, Avatar } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { PERSON_FIELDS } from '@/lib/forms';
import { ROLE_LABEL, WORKER_CONTRACT_LABEL } from '@jjd/shared';

interface Person {
  id: string; firstName: string; lastName: string | null; displayName: string | null;
  role: string; contractType: string; hourlyRate: number | null; phone: string | null;
  active: boolean; languages: string[] | null; photoThumbUrl: string | null;
  _count: { legalDocs: number; timeEntries: number };
}

export default function EquipePage() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('1');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  if (active) params.set('active', active);
  const { data, loading, reload } = useApi<{ items: Person[] }>(`/api/people?${params}`);

  return (
    <>
      {creating && (
        <FormModal
          title="Nouvelle personne"
          fields={PERSON_FIELDS}
          initial={{ role: 'worker', contractType: 'employee', active: true }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/people', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        title="Équipe"
        sub={data ? `${data.items.filter((p) => p.active).length} actifs` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle personne</button>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 200 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous rôles</option>
          <option value="foreman">Chefs de chantier</option>
          <option value="worker">Ouvriers</option>
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="1">Actifs</option>
          <option value="0">Anciens</option>
          <option value="">Tous</option>
        </select>
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Nom</th><th>Rôle</th><th>Contrat</th><th style={{ textAlign: 'right' }}>Taux</th><th>Langues</th><th>Docs</th><th>Pointages</th></tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <Avatar src={p.photoThumbUrl} label={p.displayName || `${p.firstName} ${p.lastName ?? ''}`} />
                    <Link href={`/app/equipe/${p.id}`}>{p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim()}</Link>
                    {!p.active && <span className="badge plain" style={{ marginLeft: 6 }}>Ancien</span>}
                  </td>
                  <td>{ROLE_LABEL[p.role as keyof typeof ROLE_LABEL] ?? p.role}</td>
                  <td>{WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? p.contractType}</td>
                  <td style={{ textAlign: 'right' }}>{p.hourlyRate != null ? <Money value={p.hourlyRate} /> : <span className="badge warn">à définir</span>}</td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{(p.languages ?? []).join(' ') || '—'}</td>
                  <td className="tnum">{p._count.legalDocs || ''}</td>
                  <td className="tnum">{p._count.timeEntries || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
