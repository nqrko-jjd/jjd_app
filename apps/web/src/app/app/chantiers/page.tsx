'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, PriorityBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { WORKSITE_STATUS_LABEL, WORKSITE_STATUSES, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL, ENTITIES, ENTITY_LABEL } from '@jjd/shared';

interface WS {
  id: string; ref: string; title: string; status: string; priority: string; entity: string;
  city: string | null; quotedHt: number | null; endedOn: string | null;
  client: { name: string } | null;
  manager: { displayName: string | null; firstName: string } | null;
}

export default function ChantiersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const { data, loading, reload } = useApi<{ items: WS[] }>(`/api/worksites?${params}`);
  const { data: refs } = useApi<{
    clients: { id: string; name: string }[];
    buildings: { id: string; name: string; syndicId: string | null }[];
    people: { id: string; name: string }[];
  }>(creating ? '/api/meta/pickers' : null);

  const fields: FieldDef[] = [
    { name: 'title', label: 'Intitulé du chantier', required: true, full: true, placeholder: 'Uccle - Dupont - Toiture' },
    { name: 'entity', label: 'Entité', type: 'select', options: ENTITIES.filter((e) => e !== 'm7').map((e) => ({ value: e, label: ENTITY_LABEL[e] })) },
    { name: 'status', label: 'Statut', type: 'select', options: WORKSITE_STATUSES.map((s) => ({ value: s, label: WORKSITE_STATUS_LABEL[s] })) },
    { name: 'priority', label: 'Priorité', type: 'select', options: WORKSITE_PRIORITIES.map((p) => ({ value: p, label: WORKSITE_PRIORITY_LABEL[p] })) },
    { name: 'clientId', label: 'Client', type: 'select', options: (refs?.clients ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { name: 'buildingId', label: 'Immeuble / ACP', type: 'select', options: (refs?.buildings ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'managerId', label: 'Chef de chantier', type: 'select', options: (refs?.people ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { name: 'address', label: 'Adresse', full: true },
    { name: 'postalCode', label: 'Code postal' },
    { name: 'city', label: 'Ville' },
    { name: 'startedOn', label: 'Date de début', type: 'date' },
    { name: 'endedOn', label: 'Date de fin', type: 'date' },
    { name: 'quotedHt', label: 'Total devisé HT', type: 'number' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ];

  return (
    <>
      {creating && (
        <FormModal
          title="Nouveau chantier"
          fields={fields}
          initial={{ entity: 'jjd', status: 'to_plan', priority: 'normal' }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/worksites', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        title="Chantiers"
        sub={data ? `${data.items.length} chantiers` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau chantier</button>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Rechercher (réf, titre, ville)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(WORKSITE_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Réf</th><th>Chantier</th><th>Client</th><th>Chef</th>
                <th>Statut</th><th>Entité</th><th style={{ textAlign: 'right' }}>Devisé</th><th>Fin</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.ref}</td>
                  <td><Link href={`/app/chantiers/${w.id}`}>{w.title}</Link></td>
                  <td>{w.client?.name ?? '—'}</td>
                  <td>{w.manager?.displayName ?? w.manager?.firstName ?? '—'}</td>
                  <td><span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}><StatusBadge status={w.status} /><PriorityBadge priority={w.priority} /></span></td>
                  <td><EntityBadge entity={w.entity} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
                  <td className="tnum">{w.endedOn ? formatDateBE(w.endedOn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
