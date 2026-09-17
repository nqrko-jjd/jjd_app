'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, Money, ProgressCell, Avatar } from '@/lib/ui';
import { NewWorksiteWizard } from '@/components/NewWorksiteWizard';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { useSort, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { downloadCsv, pickAndImportCsv, summarizeImport } from '@/lib/csvIO';
import {
  WORKSITE_STATUS_LABEL, WORKSITE_STATUSES, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL,
  WORKSITE_SCOPES, WORKSITE_SCOPE_LABEL, WORKSITE_BILLING_MODES, WORKSITE_BILLING_MODE_LABEL,
  WORKSITE_PROGRESS_PCT, type WorksiteStatus,
} from '@jjd/shared';

const STATUS_VIEWS: { key: string; label: string }[] = [
  { key: '', label: 'Tous' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'to_plan,scheduled', label: 'À planifier' },
  { key: 'to_invoice', label: 'À facturer' },
  { key: 'done,invoiced,closed', label: 'Terminés' },
];

interface WS {
  id: string; ref: string; title: string; status: string; priority: string; entity: string;
  scope: string | null; billingMode: string | null;
  city: string | null; quotedHt: number | null; endedOn: string | null;
  client: { name: string } | null;
  manager: { displayName: string | null; firstName: string } | null;
  building: { photoThumbUrl: string | null } | null;
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
    manager: (w: WS) => w.manager?.displayName ?? w.manager?.firstName,
    status: (w: WS) => WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status,
    quotedHt: (w: WS) => w.quotedHt,
  };
  const sort = useSort<WS>(data?.items ?? [], wsAccessors);

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
      {
        label: 'Portée',
        items: WORKSITE_SCOPES.map((s) => ({
          label: WORKSITE_SCOPE_LABEL[s],
          check: s === w.scope,
          disabled: s === w.scope,
          onClick: () => patchWs(w.id, { scope: s }),
        })),
      },
      {
        label: 'Facturation',
        items: WORKSITE_BILLING_MODES.map((b) => ({
          label: WORKSITE_BILLING_MODE_LABEL[b],
          check: b === w.billingMode,
          disabled: b === w.billingMode,
          onClick: () => patchWs(w.id, { billingMode: b }),
        })),
      },
    ];
  }

  return (
    <>
      {creating && (
        <NewWorksiteWizard
          people={refs?.people ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); reload(); }}
        />
      )}
      {ctx.menu && (
        <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />
      )}
      <PageHead
        eyebrow="Suivi des travaux"
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
              <button className="btn ghost" onClick={() => { setKind('overhead'); setStatus(''); }} title="Frais généraux (postes E-xx), distincts des chantiers clients">Charges →</button>
            </div>
          ) : (
            <button className="btn" onClick={() => { setKind('project'); setStatus(''); }}>← Retour aux chantiers</button>
          )
        }
      />
      {kind === 'project' && (
        <div className="seg" style={{ marginBottom: '1rem' }}>
          {STATUS_VIEWS.map((v) => (
            <button key={v.key || 'all'} className={status === v.key ? 'on' : ''} onClick={() => setStatus(v.key)}>{v.label}</button>
          ))}
        </div>
      )}
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Rechercher (réf, titre, ville)…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                <SortTh k="ref" sort={sort}>Chantier</SortTh>
                <SortTh k="manager" sort={sort}>Responsable</SortTh>
                <SortTh k="status" sort={sort}>Statut</SortTh>
                <SortTh k="quotedHt" sort={sort} align="right">Devisé HT</SortTh>
                <th>Avancement</th>
                <th />
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
                  <td>
                    <Avatar src={w.building?.photoThumbUrl} label={w.title} />
                    <Link href={`/app/chantiers/${w.id}`}>{w.title}</Link>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      {w.ref}{w.client?.name ? ` · ${w.client.name}` : ''}{w.city ? ` · ${w.city}` : ''}
                    </div>
                  </td>
                  <td>{w.manager?.displayName ?? w.manager?.firstName ?? '—'}</td>
                  <td><StatusBadge status={w.status} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={w.quotedHt} /></td>
                  <td><ProgressCell pct={WORKSITE_PROGRESS_PCT[w.status as WorksiteStatus] ?? 0} /></td>
                  <td className="muted">→</td>
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
