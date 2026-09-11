'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, PriorityBadge, EntityBadge, Money, formatDateBE } from '@/lib/ui';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { WORKSITE_STATUS_LABEL, WORKSITE_STATUSES, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL, ENTITIES, ENTITY_LABEL } from '@jjd/shared';

interface WS {
  id: string; ref: string; title: string; status: string; priority: string; entity: string;
  city: string | null; quotedHt: number | null; endedOn: string | null;
  client: { name: string } | null;
  manager: { displayName: string | null; firstName: string } | null;
}

export default function ChantiersPage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <ChantiersInner />
    </Suspense>
  );
}

function ChantiersInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('statut') ?? '');
  const [kind, setKind] = useState<'project' | 'overhead'>('project');
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const ctx = useContextMenu<WS>();

  useEffect(() => { setPage(1); }, [q, status, kind]);

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  params.set('kind', kind);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, reload } = useApi<{ items: WS[]; page: number; pageSize: number; totalPages: number; totalCount: number }>(`/api/worksites?${params}`);
  const wsAccessors = {
    ref: (w: WS) => w.ref,
    title: (w: WS) => w.title,
    client: (w: WS) => w.client?.name,
    manager: (w: WS) => w.manager?.displayName ?? w.manager?.firstName,
    status: (w: WS) => WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status,
    entity: (w: WS) => ENTITY_LABEL[w.entity as keyof typeof ENTITY_LABEL] ?? w.entity,
    quotedHt: (w: WS) => w.quotedHt,
    endedOn: (w: WS) => (w.endedOn ? new Date(w.endedOn) : null),
  };
  const colFilter = useColumnFilter<WS>(data?.items ?? [], wsAccessors);
  const sort = useSort<WS>(colFilter.rows, wsAccessors);
  const { data: refs } = useApi<{
    clients: { id: string; name: string }[];
    buildings: { id: string; name: string; syndicId: string | null }[];
    people: { id: string; name: string }[];
  }>(creating ? '/api/meta/pickers' : null);

  async function patchWs(id: string, body: Record<string, unknown>) {
    await api(`/api/worksites/${id}`, { method: 'PATCH', body });
    reload();
  }

  function rowMenu(w: WS): MenuItem[] {
    return [
      ...openActions(`/app/chantiers/${w.id}`, (h) => router.push(h)),
      'separator',
      {
        label: 'Changer le statut',
        items: WORKSITE_STATUSES.map((s) => ({
          label: WORKSITE_STATUS_LABEL[s],
          check: s === w.status,
          disabled: s === w.status,
          onClick: () => patchWs(w.id, { status: s }),
        })),
      },
      {
        label: 'Priorité',
        items: WORKSITE_PRIORITIES.map((p) => ({
          label: WORKSITE_PRIORITY_LABEL[p],
          check: p === w.priority,
          disabled: p === w.priority,
          onClick: () => patchWs(w.id, { priority: p }),
        })),
      },
    ];
  }

  const fields: FieldDef[] = [
    { name: 'title', label: 'Intitulé du chantier', required: true, full: true, placeholder: 'Uccle - Dupont - Toiture' },
    { name: 'entity', label: 'Entité', type: 'select', options: ENTITIES.filter((e) => e !== 'm7').map((e) => ({ value: e, label: ENTITY_LABEL[e] })) },
    { name: 'status', label: 'Statut', type: 'select', options: WORKSITE_STATUSES.map((s) => ({ value: s, label: WORKSITE_STATUS_LABEL[s] })) },
    { name: 'priority', label: 'Priorité', type: 'select', options: WORKSITE_PRIORITIES.map((p) => ({ value: p, label: WORKSITE_PRIORITY_LABEL[p] })) },
    { name: 'clientId', label: 'Client', type: 'select', options: (refs?.clients ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { name: 'buildingId', label: 'Immeuble / ACP', type: 'select', options: (refs?.buildings ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'managerId', label: 'Chef de chantier', type: 'select', options: (refs?.people ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { name: 'address', label: 'Adresse', full: true, type: 'address', addressFill: { postalCode: 'postalCode', city: 'city' } },
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
      {ctx.menu && (
        <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />
      )}
      <PageHead
        title={kind === 'project' ? 'Chantiers' : 'Charges'}
        sub={data ? `${data.totalCount} ${kind === 'project' ? 'chantiers' : 'postes de charges'} · page ${data.page}/${data.totalPages} · clic droit pour les actions rapides` : undefined}
        action={kind === 'project' ? <button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau chantier</button> : undefined}
      />
      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={kind === 'project' ? 'on' : ''} onClick={() => setKind('project')}>Chantiers</button>
        <button className={kind === 'overhead' ? 'on' : ''} onClick={() => setKind('overhead')}>Charges</button>
      </div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Rechercher (réf, titre, ville)…" value={q} onChange={(e) => setQ(e.target.value)} />
        {kind === 'project' && (
          <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {Object.entries(WORKSITE_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        )}
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh k="ref" sort={sort} filter={colFilter}>Réf</SortTh>
                <SortTh k="title" sort={sort} filter={colFilter}>Chantier</SortTh>
                <SortTh k="client" sort={sort} filter={colFilter}>Client</SortTh>
                <SortTh k="manager" sort={sort} filter={colFilter}>Chef</SortTh>
                <SortTh k="status" sort={sort} filter={colFilter}>Statut</SortTh>
                <SortTh k="entity" sort={sort} filter={colFilter}>Entité</SortTh>
                <SortTh k="quotedHt" sort={sort} align="right" filter={colFilter}>Devisé</SortTh>
                <SortTh k="endedOn" sort={sort} filter={colFilter}>Fin</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((w) => (
                <tr
                  key={w.id}
                  className={`row-link${ctx.menu?.row.id === w.id ? ' ctx-target' : ''}`}
                  onClick={rowNav(`/app/chantiers/${w.id}`, (h) => router.push(h))}
                  onContextMenu={(e) => ctx.open(e, w)}
                >
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

      {data && (
        <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      )}
    </>
  );
}
