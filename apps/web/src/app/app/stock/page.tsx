'use client';
import { tr } from '@/lib/ui-language';
import { SkeletonRows, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, Kpi } from '@/lib/ui';
import { Warehouse, AlertTriangle, Layers, ScanLine, Package } from 'lucide-react';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { StockItemModal } from '@/components/StockItemModal';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';

interface StockItem {
  id: string; ref: string | null; brand: string | null; model: string | null; name: string; unit: string; category: string | null;
  minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean; photoThumbUrl: string | null;
  displayUnitName: string | null; units: { name: string; factor: number }[];
}

/** Quantité affichée pour une ligne : son unité "préférée" (ex. sac) si réglée, sinon l'unité de base. */
function displayQty(it: StockItem): { qty: number; unit: string } {
  const pu = it.displayUnitName ? it.units.find((u) => u.name.toLowerCase() === it.displayUnitName!.toLowerCase()) : null;
  return pu ? { qty: it.qty / pu.factor, unit: pu.name } : { qty: it.qty, unit: it.unit };
}
const fmtQty = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);

export default function StockPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper'; // un ouvrier consulte le stock, il ne le gère pas
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'ok'>('all');
  // un article "supprimé" alors qu'il a un historique (mouvements, préparation, commande) est en
  // fait désactivé, pas effacé — invisible par défaut (comme l'API), ce bouton le fait réapparaître.
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useViewMode('stock');
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (showInactive) qs.set('active', '0');
  const ctxItems = useApi<{ items: StockItem[] }>(`/api/stock/items?${qs}`);
  const { data, loading, reload } = ctxItems;

  async function reactivate(id: string) {
    await api(`/api/stock/items/${id}`, { method: 'PATCH', body: { active: true } });
    reload();
  }

  const allItems = data?.items ?? [];
  const filteredItems = stockFilter === 'all' ? allItems : allItems.filter((i) => (stockFilter === 'low' ? i.low : !i.low));

  const stockAccessors = {
    ref: (i: StockItem) => i.ref,
    name: (i: StockItem) => i.name,
    category: (i: StockItem) => i.category,
    qty: (i: StockItem) => i.qty,
    value: (i: StockItem) => i.value,
  };
  const colFilter = useColumnFilter<StockItem>(filteredItems, stockAccessors);
  const sort = useSort<StockItem>(colFilter.rows, stockAccessors);

  const totalValue = allItems.reduce((s, i) => s + i.value, 0);
  const lowCount = allItems.filter((i) => i.low).length;

  return (
    <>
      {ctxItems.error && <div className="empty">Erreur de chargement.</div>}
      {creating && (
        <StockItemModal onClose={() => setCreating(false)} onSaved={(it) => router.push(`/app/stock/${it.id}`)} />
      )}
      <PageHead
        eyebrow="Ressources"
        title="Stock de matériaux"
        sub={data ? `${allItems.length} article${allItems.length > 1 ? 's' : ''} · clic sur une ligne pour ouvrir la fiche` : undefined}
        action={
          canManage ? (
            <div className="row">
              <Link href="/app/stock/racks" className="btn">Racks</Link>
              <a className="btn" href="/imprimer/etiquettes?all=1" target="_blank" rel="noreferrer">Étiquettes</a>
              <Link href="/app/stock/scan" className="btn primary"><ScanLine size={15} strokeWidth={2} /> Scan &amp; mouvements →</Link>
              <button className="btn" onClick={() => setCreating(true)}>+ Nouvel article</button>
            </div>
          ) : undefined
        }
      />

      <div className="kpis" style={{ marginBottom: '1.2rem' }}>
        <Kpi
          ic={Warehouse}
          label="Valeur du stock"
          value={<Money value={totalValue} />}
          sub={`${allItems.length} article${allItems.length > 1 ? 's' : ''}`}
          hero
        />
        <Kpi ic={Layers} label="Références" value={allItems.length} sub="Articles suivis" />
        <Kpi
          ic={AlertTriangle}
          label="Sous le seuil"
          value={lowCount}
          sub={lowCount > 0 ? 'À recompléter rapidement' : 'Tout est au-dessus du seuil'}
          warn={lowCount > 0}
        />
      </div>

      <div className="msg-filter-chips" style={{ marginBottom: '1rem' }}>
        <button className={stockFilter === 'all' ? 'on' : ''} onClick={() => setStockFilter('all')}>{tr("Tous")}</button>
        <button className={stockFilter === 'low' ? 'on' : ''} onClick={() => setStockFilter('low')}>À réapprovisionner</button>
        <button className={stockFilter === 'ok' ? 'on' : ''} onClick={() => setStockFilter('ok')}>Disponible</button>
      </div>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, réf., marque, réf. fabricant…" value={q} onChange={(e) => setQ(e.target.value)} />
        {canManage && (
          <button className={`btn${showInactive ? ' primary' : ''}`} onClick={() => setShowInactive((v) => !v)} title="Un article avec un historique est désactivé plutôt que supprimé — ce bouton le fait réapparaître">
            {showInactive ? 'Masquer les désactivés' : 'Afficher les désactivés'}
          </button>
        )}
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      {loading && <SkeletonRows />}
      {data && filteredItems.length === 0 && <EmptyState
          icon={Warehouse}
          title={tr("Aucun article")}
          text="Aucun article de stock ne correspond à cette recherche ou à ce filtre. Ajoutez un article pour suivre ses entrées et sorties."
          action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvel article</button>}
        />}
      {data && filteredItems.length > 0 && mode === 'gallery' && (
        <div className="gallery-grid">
          {sort.rows.map((it) => (
            <div
              key={it.id}
              className="card gallery-card"
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/app/stock/${it.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/app/stock/${it.id}`); }}
            >
              <div className="gallery-thumb">
                {it.photoThumbUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={it.photoThumbUrl} alt="" loading="lazy" />
                  : <Package size={22} strokeWidth={1.6} />}
              </div>
              <div className="gallery-body">
                <div className="gallery-title">
                  {it.name}
                  {it.low && <span className="badge warn" style={{ marginLeft: 6, fontSize: '0.68rem' }}>bas</span>}
                  {!it.active && <span className="badge plain" style={{ marginLeft: 6, fontSize: '0.68rem' }}>Désactivé</span>}
                </div>
                <div className="gallery-sub">
                  {[it.ref, [it.brand, it.model].filter(Boolean).join(' ') || it.category].filter(Boolean).join(' · ') || '—'} · {fmtQty(displayQty(it).qty)} {displayQty(it).unit}
                </div>
              </div>
              <div className="row" style={{ padding: '0 0.85rem 0.7rem', justifyContent: 'space-between' }}>
                <Money value={it.value} />
                {!it.active && canManage && (
                  <button className="btn ghost" style={{ fontSize: '0.76rem' }} onClick={(e) => { e.stopPropagation(); reactivate(it.id); }}>Réactiver</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && filteredItems.length > 0 && mode === 'list' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh k="ref" sort={sort} filter={colFilter}>Réf.</SortTh>
                <SortTh k="name" sort={sort} filter={colFilter}>{tr("Article")}</SortTh>
                <SortTh k="category" sort={sort} filter={colFilter}>{tr("Catégorie")}</SortTh>
                <SortTh k="qty" sort={sort} align="right" filter={colFilter}>Quantité</SortTh>
                <SortTh k="value" sort={sort} align="right" filter={colFilter}>Valeur</SortTh>
                {showInactive && <th></th>}
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((it) => (
                <tr key={it.id} className="row-link" onClick={rowNav(`/app/stock/${it.id}`, (h) => router.push(h))}>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{it.ref ?? '—'}</td>
                  <td>
                    <span className="row" style={{ display: 'inline-flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                      {it.photoThumbUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={it.photoThumbUrl} alt="" loading="lazy" style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                        : <span style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--surface-2)', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}><Package size={16} strokeWidth={1.6} /></span>}
                      <span>
                    {it.name}{(it.brand || it.model) && <span className="muted"> · {[it.brand, it.model].filter(Boolean).join(' ')}</span>}
                    {it.low && <span className="badge warn" style={{ marginLeft: 6, fontSize: '0.7rem' }}>sous le seuil ({it.minQty})</span>}
                    {!it.active && <span className="badge plain" style={{ marginLeft: 6, fontSize: '0.7rem' }}>Désactivé</span>}
                      </span>
                    </span>
                  </td>
                  <td>{it.category ?? '—'}</td>
                  <td className="tnum">{fmtQty(displayQty(it).qty)} {displayQty(it).unit}</td>
                  <td style={{ textAlign: 'right' }}><Money value={it.value} /></td>
                  {showInactive && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {!it.active && canManage && <button className="btn ghost" style={{ fontSize: '0.76rem' }} onClick={() => reactivate(it.id)}>Réactiver</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
