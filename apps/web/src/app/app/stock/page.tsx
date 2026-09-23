'use client';
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
import { FormModal, type FieldDef } from '@/components/FormModal';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';

interface StockItem {
  id: string; name: string; unit: string; category: string | null;
  minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean;
}

export default function StockPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = user?.role !== 'worker'; // un ouvrier consulte le stock, il ne le gère pas
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'ok'>('all');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useViewMode('stock');
  const ctxItems = useApi<{ items: StockItem[] }>(`/api/stock/items?${q ? `q=${encodeURIComponent(q)}` : ''}`);
  const { data, loading, reload } = ctxItems;

  const allItems = data?.items ?? [];
  const filteredItems = stockFilter === 'all' ? allItems : allItems.filter((i) => (stockFilter === 'low' ? i.low : !i.low));

  const stockAccessors = {
    name: (i: StockItem) => i.name,
    category: (i: StockItem) => i.category,
    qty: (i: StockItem) => i.qty,
    value: (i: StockItem) => i.value,
  };
  const colFilter = useColumnFilter<StockItem>(filteredItems, stockAccessors);
  const sort = useSort<StockItem>(colFilter.rows, stockAccessors);

  const totalValue = allItems.reduce((s, i) => s + i.value, 0);
  const lowCount = allItems.filter((i) => i.low).length;

  const itemFields: FieldDef[] = [
    { name: 'name', label: 'Nom', required: true, full: true, placeholder: 'Sac de ciment 25kg' },
    { name: 'unit', label: 'Unité', required: true, placeholder: 'sac, m², u, L…' },
    { name: 'category', label: 'Catégorie', placeholder: 'facultatif' },
    { name: 'minQty', label: 'Seuil d’alerte (mini)', type: 'number' },
  ];

  return (
    <>
      {ctxItems.error && <div className="empty">Erreur de chargement.</div>}
      {creating && (
        <FormModal
          title="Nouvel article"
          fields={itemFields}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/stock/items', { method: 'POST', body: v }); reload(); }}
        />
      )}
      <PageHead
        eyebrow="Ressources"
        title="Stock de matériaux"
        sub={data ? `${allItems.length} article${allItems.length > 1 ? 's' : ''} · clic sur une ligne pour ouvrir la fiche` : undefined}
        action={
          canManage ? (
            <div className="row">
              <Link href="/app/stock/scan" className="btn"><ScanLine size={15} strokeWidth={2} /> Scan &amp; mouvements →</Link>
              <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvel article</button>
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
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, catégorie…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  {it.category ?? '—'} · {it.qty} {it.unit}
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
                <SortTh k="name" sort={sort} filter={colFilter}>Article</SortTh>
                <SortTh k="category" sort={sort} filter={colFilter}>Catégorie</SortTh>
                <SortTh k="qty" sort={sort} align="right" filter={colFilter}>Quantité</SortTh>
                <SortTh k="value" sort={sort} align="right" filter={colFilter}>Valeur</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((it) => (
                <tr key={it.id} className="row-link" onClick={rowNav(`/app/stock/${it.id}`, (h) => router.push(h))}>
                  <td>
                    {it.name}
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
