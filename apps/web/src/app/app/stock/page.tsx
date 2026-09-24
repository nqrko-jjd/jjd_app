'use client';
import { SkeletonRows, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, Kpi } from '@/lib/ui';
import { Warehouse, AlertTriangle, Layers, ScanLine, Package } from 'lucide-react';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { StockItemModal } from '@/components/StockItemModal';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';

interface StockItem {
  id: string; ref: string | null; brand: string | null; model: string | null; name: string; unit: string; category: string | null;
  minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean;
}

export default function StockPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper'; // un ouvrier consulte le stock, il ne le gère pas
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'ok'>('all');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useViewMode('stock');
  const ctxItems = useApi<{ items: StockItem[] }>(`/api/stock/items?${q ? `q=${encodeURIComponent(q)}` : ''}`);
  const { data, loading, reload } = ctxItems;

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
        <button className={stockFilter === 'all' ? 'on' : ''} onClick={() => setStockFilter('all')}>Tous</button>
        <button className={stockFilter === 'low' ? 'on' : ''} onClick={() => setStockFilter('low')}>À réapprovisionner</button>
        <button className={stockFilter === 'ok' ? 'on' : ''} onClick={() => setStockFilter('ok')}>Disponible</button>
      </div>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, réf., marque, réf. fabricant…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      {loading && <SkeletonRows />}
      {data && filteredItems.length === 0 && <EmptyState
          icon={Warehouse}
          title="Aucun article"
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
              <div className="gallery-thumb"><Package size={22} strokeWidth={1.6} /></div>
              <div className="gallery-body">
                <div className="gallery-title">
                  {it.name}
                  {it.low && <span className="badge warn" style={{ marginLeft: 6, fontSize: '0.68rem' }}>bas</span>}
                </div>
                <div className="gallery-sub">
                  {[it.ref, [it.brand, it.model].filter(Boolean).join(' ') || it.category].filter(Boolean).join(' · ') || '—'} · {it.qty} {it.unit}
                </div>
              </div>
              <div className="row" style={{ padding: '0 0.85rem 0.7rem', justifyContent: 'space-between' }}>
                <Money value={it.value} />
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
                <SortTh k="name" sort={sort} filter={colFilter}>Article</SortTh>
                <SortTh k="category" sort={sort} filter={colFilter}>Catégorie</SortTh>
                <SortTh k="qty" sort={sort} align="right" filter={colFilter}>Quantité</SortTh>
                <SortTh k="value" sort={sort} align="right" filter={colFilter}>Valeur</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((it) => (
                <tr key={it.id} className="row-link" onClick={rowNav(`/app/stock/${it.id}`, (h) => router.push(h))}>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{it.ref ?? '—'}</td>
                  <td>
                    {it.name}{(it.brand || it.model) && <span className="muted"> · {[it.brand, it.model].filter(Boolean).join(' ')}</span>}
                    {it.low && <span className="badge warn" style={{ marginLeft: 6, fontSize: '0.7rem' }}>sous le seuil ({it.minQty})</span>}
                  </td>
                  <td>{it.category ?? '—'}</td>
                  <td className="tnum">{it.qty} {it.unit}</td>
                  <td style={{ textAlign: 'right' }}><Money value={it.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
