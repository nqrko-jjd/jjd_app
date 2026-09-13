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
import { useSort, useColumnFilter, SortTh, distinctValues } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { downloadCsv, pickAndImportCsv, summarizeImport } from '@/lib/csvIO';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useContextMenu<WS>();

  useEffect(() => { setPage(1); setSelected(new Set()); }, [q, status, kind]);

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

  // Valeurs distinctes pour les filtres à cases à cocher : calculées sur TOUS les chantiers
  // correspondant à la recherche/statut du haut (pas seulement la page affichée), sinon
  // le filtre ne proposerait que les valeurs de la page en cours.
  const filterScopeParams = new URLSearchParams();
  if (q) filterScopeParams.set('q', q);
  if (status) filterScopeParams.set('status', status);
  filterScopeParams.set('kind', kind);
  const { data: filterScope } = useApi<{ items: WS[] }>(`/api/worksites?${filterScopeParams}`);
  const filterRows = filterScope?.items ?? [];
  const { data: refs } = useApi<{
    clients: { id: string; name: string }[];
    buildings: { id: string; name: string; syndicId: string | null }[];
    people: { id: string; name: string }[];
  }>(creating ? '/api/meta/pickers' : null);

  async function patchWs(id: string, body: Record<string, unknown>) {
    await api(`/api/worksites/${id}`, { method: 'PATCH', body });
    reload();
  }

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === sort.rows.length ? new Set() : new Set(sort.rows.map((w) => w.id))));
  }
  async function bulkSetStatus(newStatus: string) {
    const ids = [...selected];
    if (!ids.length) return;
    await Promise.all(ids.map((id) => api(`/api/worksites/${id}`, { method: 'PATCH', body: { status: newStatus } })));
    setSelected(new Set());
    reload();
  }

  function exportCsv() {
    const p = new URLSearchParams(params);
    downloadCsv(`/api/worksites/export.csv?${p}`, `chantiers-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  function importCsv() {
    pickAndImportCsv(
      '/api/worksites/import',
      (r) => { alert(summarizeImport(r)); reload(); },
      (msg) => alert(`Échec de l’import : ${msg}`),
    );
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
    { name: 'clientId', label: 'Client', type: 'contact', full: true },
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
        action={
          kind === 'project' ? (
            <div className="row">
              {selected.size > 0 && (
                <select
                  className="select"
                  value=""
                  onChange={(e) => { if (e.target.value) bulkSetStatus(e.target.value); }}
                  title={`Changer le statut des ${selected.size} chantier(s) sélectionné(s)`}
                >
                  <option value="">Statut → {selected.size} sélectionné{selected.size > 1 ? 's' : ''}…</option>
                  {WORKSITE_STATUSES.map((s) => <option key={s} value={s}>{WORKSITE_STATUS_LABEL[s]}</option>)}
                </select>
              )}
              <button className="btn" onClick={exportCsv} title="Exporter la liste filtrée en CSV (éditable dans Excel)">⇩ Exporter CSV</button>
              <button className="btn" onClick={importCsv} title="Réimporter un CSV/Excel corrigé (met à jour par id, ne crée pas de nouveau chantier)">⇧ Importer</button>
              <button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau chantier</button>
            </div>
          ) : undefined
        }
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
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={sort.rows.length > 0 && selected.size === sort.rows.length}
                    onChange={toggleAll}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <SortTh k="ref" sort={sort} filter={colFilter} filterOptions={distinctValues(filterRows, wsAccessors.ref)}>Réf</SortTh>
                <SortTh k="title" sort={sort} filter={colFilter} filterOptions={distinctValues(filterRows, wsAccessors.title)}>Chantier</SortTh>
                <SortTh k="client" sort={sort} filter={colFilter} filterOptions={distinctValues(filterRows, wsAccessors.client)}>Client</SortTh>
                <SortTh k="manager" sort={sort} filter={colFilter} filterOptions={distinctValues(filterRows, wsAccessors.manager)}>Chef</SortTh>
                <SortTh k="status" sort={sort} filter={colFilter} filterOptions={WORKSITE_STATUSES.map((s) => WORKSITE_STATUS_LABEL[s])}>Statut</SortTh>
                <SortTh k="entity" sort={sort} filter={colFilter} filterOptions={ENTITIES.map((e) => ENTITY_LABEL[e])}>Entité</SortTh>
                <SortTh k="quotedHt" sort={sort} align="right" filter={colFilter} filterOptions={distinctValues(filterRows, wsAccessors.quotedHt)}>Devisé</SortTh>
                <SortTh k="endedOn" sort={sort} filter={colFilter} filterOptions={distinctValues(filterRows, wsAccessors.endedOn)}>Fin</SortTh>
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleSelected(w.id)} aria-label="Sélectionner" />
                  </td>
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
