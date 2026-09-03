'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Money } from '@/lib/ui';
import { ROLE_LABEL, WORKER_CONTRACT_LABEL } from '@jjd/shared';

interface Person {
  id: string; firstName: string; lastName: string | null; displayName: string | null;
  role: string; contractType: string; hourlyRate: number | null; phone: string | null;
  active: boolean; languages: string[] | null;
  _count: { legalDocs: number; timeEntries: number };
}

export default function EquipePage() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  const { data, loading } = useApi<{ items: Person[] }>(`/api/people?${params}`);

  return (
    <>
      <PageHead title="Équipe" sub={data ? `${data.items.filter((p) => p.active).length} actifs` : undefined} />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 200 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous</option>
          <option value="foreman">Chefs de chantier</option>
          <option value="worker">Ouvriers</option>
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
                  <td><Link href={`/equipe/${p.id}`}>{p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim()}</Link></td>
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
