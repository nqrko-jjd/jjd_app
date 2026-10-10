'use client';
import { tr } from '@/lib/ui-language';
import { SkeletonRows, ErrorState } from '@/components/States';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge, Money, ProgressCell } from '@/lib/ui';
import { NewWorksiteWizard } from '@/components/NewWorksiteWizard';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { PaginationBar } from '@/components/PaginationBar';
import { useSort, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { ArrowRight, Building2, CalendarPlus, LayoutGrid, List, MapPin, UserRound } from 'lucide-react';
import {
  WORKSITE_STATUS_LABEL, WORKSITE_STATUSES, WORKSITE_PRIORITIES, WORKSITE_PRIORITY_LABEL,
  WORKSITE_SCOPES, WORKSITE_SCOPE_LABEL, WORKSITE_BILLING_MODES, WORKSITE_BILLING_MODE_LABEL,
  WORKSITE_PROGRESS_PCT, type WorksiteStatus,
} from '@jjd/shared';
import { WORKSITE_STATUS_GROUPS } from '@/lib/worksite-status-groups';

/**
 * "Clôturé" est un statut comme un autre ici (au même titre que "Terminé"/"En cours") — même si,
 * côté backend, un chantier clôturé est aussi marqué archived=true pour ne pas encombrer le
 * tableau de bord/la messagerie/le picker planning-stock. L'onglet "Tous" doit donc explicitement
 * demander archived=all (sinon le filtre par défaut du backend masquerait les clôturés).
 */
// Chaque statut doit avoir son onglet (sinon un chantier « en attente », « demande »… n'est visible que dans « Tous »).
const STATUS_VIEWS: { key: string; label: string; archived?: '1' | 'all' }[] = [
  { key: '', label: 'Tous', archived: 'all' },
  { key: 'lead,quote_needed', label: 'Demandes / devis', archived: 'all' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'to_plan,scheduled', label: 'À planifier' },
  { key: 'on_hold', label: 'En attente', archived: 'all' },
  { key: 'to_invoice', label: 'À facturer' },
  { key: 'done,invoiced', label: 'Terminés' },
  { key: 'closed', label: 'Clôturé', archived: '1' },
  { key: 'refused,cancelled', label: 'Refusés / abandonnés', archived: 'all' },
];

interface WS {
  id: string; ref: string; title: string; status: string; priority: string; entity: string;
  scope: string | null; billingMode: string | null;
  city: string | null; quotedHt: number | null; invoicedHt: number; endedOn: string | null;
  client: { name: string } | null;
  manager: { displayName: string | null; firstName: string } | null;
  building?: { id: string; name: string; photoThumbUrl: string | null } | null;
}

export default function ChantiersPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <ChantiersInner />
    </Suspense>
  );
}

function ChantiersInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState(sp.get('statut') ?? '');
  const [kind, setKind] = useState<'project' | 'overhead'>('project');
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // vue liste par défaut ; le choix (liste / galerie) est mémorisé sur l'appareil
  const [view, setViewState] = useState<'cards' | 'list'>('list');
  useEffect(() => {
    try { if (localStorage.getItem('jjd-chantiers-vue') === 'cards') setViewState('cards'); } catch { /* stockage indisponible */ }
  }, []);
  const setView = (v: 'cards' | 'list') => { setViewState(v); try { localStorage.setItem('jjd-chantiers-vue', v); } catch { /* ignoré */ } };
  const ctx = useContextMenu<WS>();

  useEffect(() => { setPage(1); setSelected(new Set()); }, [q, status, kind]);

  const activeView = STATUS_VIEWS.find((v) => v.key === status);
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (activeView?.archived) params.set('archived', activeView.archived);
  params.set('kind', kind);
  params.set('sort', 'ref'); // R- le plus récent en haut
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { data, loading, error, reload } = useApi<{ items: WS[]; page: number; pageSize: number; totalPages: number; totalCount: number }>(`/api/worksites?${params}`);
  const wsAccessors = {
    ref: (w: WS) => w.ref,
    manager: (w: WS) => w.manager?.displayName ?? w.manager?.firstName,
    status: (w: WS) => WORKSITE_STATUS_LABEL[w.status as keyof typeof WORKSITE_STATUS_LABEL] ?? w.status,
    invoicedHt: (w: WS) => w.invoicedHt,
  };
  const sort = useSort<WS>(data?.items ?? [], wsAccessors);

  const { data: counts, reload: reloadCounts } = useApi<{ total: number; byStatus: Record<string, number> }>(
    kind === 'project' ? '/api/worksites/counts' : null,
  );
  const reloadAll = () => { reload(); reloadCounts(); };
  // « Planifier » : bouton rapide sur chaque ligne des onglets où l'on cherche surtout à programmer quelque chose (en attente, à planifier)
  const quickPlan = status === 'on_hold' || status === 'to_plan,scheduled';
  const countOf = (key: string) => (key === '' ? counts?.total : key.split(',').reduce((a, s) => a + (counts?.byStatus[s] ?? 0), 0));

  const { data: refs } = useApi<{
    clients: { id: string; name: string }[];
    buildings: { id: string; name: string; syndicId: string | null }[];
    people: { id: string; name: string }[];
  }>(creating ? '/api/meta/pickers' : null);

  async function patchWs(id: string, body: Record<string, unknown>) {
    await api(`/api/worksites/${id}`, { method: 'PATCH', body });
    reloadAll();
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
    reloadAll();
  }


  function rowMenu(w: WS): MenuItem[] {
    return [
      ...openActions(`/app/chantiers/${w.id}`, (h) => router.push(h)),
      'separator',
      {
        label: 'Changer le statut',
        items: WORKSITE_STATUS_GROUPS.flatMap((g): MenuItem[] => [
          { heading: g.label },
          ...g.statuses.map((s): MenuItem => ({
            label: WORKSITE_STATUS_LABEL[s],
            check: s === w.status,
            disabled: s === w.status,
            onClick: () => patchWs(w.id, { status: s }),
          })),
        ]),
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
          onCreated={() => { setCreating(false); reloadAll(); }}
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
              <button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau chantier</button>
              <button className="btn ghost" onClick={() => { setKind('overhead'); setStatus(''); }} title="Frais généraux (postes E-xx), distincts des chantiers clients">Charges →</button>
            </div>
          ) : (
            <button className="btn" onClick={() => { setKind('project'); setStatus(''); }}>← Retour aux chantiers</button>
          )
        }
      />
      {kind === 'project' && (
        <div className="seg" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
          {STATUS_VIEWS.map((v) => (
            <button key={v.key || 'all'} className={status === v.key ? 'on' : ''} onClick={() => setStatus(v.key)}>
              {v.label}
              {countOf(v.key) != null && <span className="cnt">{countOf(v.key)}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="filter-bar">
        <input className="input worksite-search" placeholder="Rechercher un chantier, une référence, une ville…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="btn ghost" onClick={() => setQ('')}>Effacer la recherche</button>}
        {kind === 'project' && (
          <div className="bulk">
            <span className={`bulk-count${selected.size ? ' on' : ''}`}>
              {selected.size ? `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : 'Aucune sélection'}
            </span>
            <select
              className="select"
              value=""
              disabled={selected.size === 0}
              onChange={(e) => { if (e.target.value) bulkSetStatus(e.target.value); }}
              title="Cochez des chantiers dans la liste pour changer leur statut en une fois"
              aria-label="Action groupée : changer le statut"
            >
              <option value="">Changer le statut…</option>
              {WORKSITE_STATUS_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.statuses.map((s) => <option key={s} value={s}>{WORKSITE_STATUS_LABEL[s]}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div className="worksite-view-switch" role="group" aria-label="Présentation des chantiers">
          <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} aria-label="Vue galerie" title="Vue galerie"><LayoutGrid size={17} /></button>
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="Vue en liste" title="Vue en liste"><List size={18} /></button>
        </div>
      </div>

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && view === 'cards' && kind === 'project' && (
        <div className="worksite-card-grid">
          {sort.rows.map((w, index) => {
            const progress = WORKSITE_PROGRESS_PCT[w.status as WorksiteStatus] ?? 0;
            const manager = w.manager?.displayName ?? w.manager?.firstName ?? 'À attribuer';
            return (
              <article
                key={w.id}
                className={`worksite-card${ctx.menu?.row.id === w.id ? ' ctx-target' : ''}`}
                onClick={rowNav(`/app/chantiers/${w.id}`, (h) => router.push(h))}
                onContextMenu={(e) => ctx.open(e, w)}
              >
                <div className={`worksite-card-media visual-${index % 4}`}>
                  {w.building?.photoThumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.building.photoThumbUrl} alt="" />
                  ) : (
                    <div className="worksite-card-fallback" aria-hidden="true"><Building2 size={37} strokeWidth={1.35} /></div>
                  )}
                  <label className="worksite-select" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleSelected(w.id)} aria-label={`Sélectionner ${w.title}`} />
                  </label>
                  <div className="worksite-card-status"><StatusBadge status={w.status} /></div>
                </div>
                <div className="worksite-card-body">
                  <div className="worksite-card-ref">
                    <span>{w.ref}</span>
                    {w.priority !== 'normal' && w.priority !== 'low' && <span className={`priority-dot ${w.priority}`}>{WORKSITE_PRIORITY_LABEL[w.priority as keyof typeof WORKSITE_PRIORITY_LABEL]}</span>}
                  </div>
                  <h2>{w.title}</h2>
                  <p className="worksite-card-client">{w.client?.name ?? w.building?.name ?? 'Client à préciser'}</p>
                  <div className="worksite-card-meta">
                    <span><MapPin size={15} />{w.city ?? 'Adresse à compléter'}</span>
                    <span><UserRound size={15} />{manager}</span>
                  </div>
                  <div className="worksite-progress">
                    <div><span>Avancement</span><strong>{progress}%</strong></div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                  </div>
                  {quickPlan && (
                    <Link
                      href={`/app/planning?new=${w.id}`}
                      className="btn primary"
                      style={{ margin: '0 0 0.7rem', justifyContent: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CalendarPlus size={16} /> Planifier un événement
                    </Link>
                  )}
                  <div className="worksite-card-foot">
                    <div>
                      <span>{w.scope ? WORKSITE_SCOPE_LABEL[w.scope as keyof typeof WORKSITE_SCOPE_LABEL] : 'Type à préciser'}</span>
                      {w.billingMode && <small>{WORKSITE_BILLING_MODE_LABEL[w.billingMode as keyof typeof WORKSITE_BILLING_MODE_LABEL]}</small>}
                    </div>
                    <div className="worksite-card-amount">
                      <small>Facturé HT</small>
                      <strong><Money value={w.invoicedHt} /></strong>
                    </div>
                    <ArrowRight className="worksite-card-arrow" size={19} />
                  </div>
                </div>
              </article>
            );
          })}
          {sort.rows.length === 0 && <div className="state worksite-empty"><Building2 size={30} /><h3>{tr("Aucun chantier trouvé")}</h3><p>Modifiez votre recherche ou choisissez un autre statut.</p></div>}
          <div className="worksite-card-pagination"><PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} /></div>
        </div>
      )}
      {data && (view === 'list' || kind !== 'project') && (
        <div className="list-card">
        <div className="tbl-wrap">
          <table className="tbl tbl-compact">
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
                <SortTh k="ref" sort={sort}>{tr("Chantier")}</SortTh>
                <SortTh k="manager" sort={sort}>Responsable</SortTh>
                <SortTh k="status" sort={sort}>Statut</SortTh>
                <SortTh k="invoicedHt" sort={sort} align="right">Facturé HT</SortTh>
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
                    <Link href={`/app/chantiers/${w.id}`}>{w.title}</Link>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      {w.ref}{w.client?.name ? ` · ${w.client.name}` : ''}{w.city ? ` · ${w.city}` : ''}
                    </div>
                  </td>
                  <td>{w.manager?.displayName ?? w.manager?.firstName ?? '—'}</td>
                  <td><StatusBadge status={w.status} /></td>
                  <td style={{ textAlign: 'right' }}><Money value={w.invoicedHt} /></td>
                  <td><ProgressCell pct={WORKSITE_PROGRESS_PCT[w.status as WorksiteStatus] ?? 0} /></td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {quickPlan && (
                      <Link href={`/app/planning?new=${w.id}`} className="btn" onClick={(e) => e.stopPropagation()}>
                        <CalendarPlus size={15} /> Planifier
                      </Link>
                    )}{' '}→
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar inCard page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
        </div>
      )}
    </>
  );
}
