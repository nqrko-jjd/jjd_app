'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, Kpi } from '@/lib/ui';
import { Warehouse, AlertTriangle, Layers, ArrowDownToLine, ArrowUpFromLine, Undo2 } from 'lucide-react';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { ComboBox } from '@/components/ComboBox';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { PaginationBar, PAGE_SIZE_ALL } from '@/components/PaginationBar';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';

interface StockItem {
  id: string; name: string; unit: string; category: string | null;
  minQty: number | null; qty: number; avgCost: number | null; value: number; low: boolean; active: boolean;
}
interface Movement {
  id: string; type: string; qty: number; unitCost: number | null; requestedByName: string | null; note: string | null; createdAt: string;
  stockItem: { id: string; name: string; unit: string };
  worksite: { id: string; ref: string; title: string } | null;
  createdBy: { email: string } | null;
}
interface Meta {
  worksites: { id: string; name: string }[];
  categories: string[];
}

const TYPE_LABEL: Record<string, string> = { in: 'Entrée', out: 'Sortie', adjustment: 'Inventaire' };
const TYPE_TONE: Record<string, string> = { in: 'ok', out: 'warn', adjustment: 'plain' };

export default function StockPage() {
  const [section, setSection] = useState<'articles' | 'scan'>('articles');
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'ok'>('all');
  const [creating, setCreating] = useState(false);
  const [moveItem, setMoveItem] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const [mode, setMode] = useViewMode('stock');
  const ctxItems = useApi<{ items: StockItem[] }>(`/api/stock/items?${q ? `q=${encodeURIComponent(q)}` : ''}`);
  const { data, loading, reload } = ctxItems;
  const { data: meta } = useApi<Meta>('/api/stock/meta');

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
      {moveItem && meta && (
        <MovementModal item={moveItem} meta={meta} onClose={() => setMoveItem(null)} onDone={() => { setMoveItem(null); reload(); }} />
      )}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} />}

      <PageHead
        eyebrow="Ressources"
        title="Stock de matériaux"
        sub={data ? `${allItems.length} article${allItems.length > 1 ? 's' : ''} · clic sur une ligne pour l’historique` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvel article</button>}
      />

      <div className="seg" style={{ marginBottom: '1.1rem' }}>
        <button type="button" className={section === 'articles' ? 'on' : ''} onClick={() => setSection('articles')}>Articles</button>
        <button type="button" className={section === 'scan' ? 'on' : ''} onClick={() => setSection('scan')}>Scan &amp; mouvements</button>
      </div>

      {section === 'scan' && meta && <ScanPanel items={allItems} meta={meta} onDone={reload} />}

      {section === 'articles' && (
      <>
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

      {loading && <div className="empty">Chargement…</div>}
      {data && filteredItems.length === 0 && <div className="empty">Aucun article pour ce filtre.</div>}
      {data && filteredItems.length > 0 && mode === 'gallery' && (
        <div className="gallery-grid">
          {sort.rows.map((it) => (
            <div
              key={it.id}
              className="card gallery-card"
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onClick={() => setHistory(it)}
              onKeyDown={(e) => { if (e.key === 'Enter') setHistory(it); }}
            >
              <div className="gallery-thumb">▥</div>
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
                <button type="button" className="btn" style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }} onClick={(e) => { e.stopPropagation(); setMoveItem(it); }}>Mouvement</button>
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((it) => (
                <tr key={it.id} className="row-link" onClick={rowNav('', () => setHistory(it))}>
                  <td>
                    {it.name}
                    {it.low && <span className="badge warn" style={{ marginLeft: 6, fontSize: '0.7rem' }}>sous le seuil ({it.minQty})</span>}
                  </td>
                  <td>{it.category ?? '—'}</td>
                  <td className="tnum">{it.qty} {it.unit}</td>
                  <td style={{ textAlign: 'right' }}><Money value={it.value} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ gap: '0.3rem', justifyContent: 'flex-end' }}>
                      <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => setMoveItem(it)}>Mouvement</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- scan groupé (catalogue cliquable + panier) */

const ACTION_LABEL: Record<'in' | 'out' | 'return', string> = { in: 'l’entrée', out: 'la sortie', return: 'le retour' };
const ACTION_BADGE: Record<'in' | 'out' | 'return', string> = { in: 'Entrée', out: 'Sortie', return: 'Retour' };

function ScanPanel({
  items, meta, onDone,
}: {
  items: StockItem[]; meta: Meta; onDone: () => void;
}) {
  const [action, setAction] = useState<'in' | 'out' | 'return'>('out');
  const [worksiteId, setWorksiteId] = useState('');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<{ id: string; name: string; unit: string; qty: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const catalog = (() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => !q || `${it.name} ${it.category ?? ''}`.toLowerCase().includes(q));
  })();

  // Un clic sur une carte ajoute 1 exemplaire — un 2e clic sur la même carte augmente la
  // quantité, comme un 2e scan (cf. panier de la maquette).
  function addToCart(it: StockItem) {
    setCart((cur) => {
      const existing = cur.find((l) => l.id === it.id);
      if (existing) return cur.map((l) => (l.id === it.id ? { ...l, qty: l.qty + 1 } : l));
      return [{ id: it.id, name: it.name, unit: it.unit, qty: 1 }, ...cur];
    });
    setToast(null);
    setErr(null);
  }
  function setQty(id: string, qty: number) {
    if (!Number.isFinite(qty) || qty < 1) return;
    setCart((cur) => cur.map((l) => (l.id === id ? { ...l, qty } : l)));
  }
  function removeLine(id: string) {
    setCart((cur) => cur.filter((l) => l.id !== id));
  }

  async function submit() {
    if (cart.length === 0) return;
    if (action !== 'in' && !worksiteId) { setErr('Chantier requis.'); return; }
    setBusy(true);
    setErr(null);
    setToast(null);
    let done = 0;
    try {
      for (const line of cart) {
        await api('/api/stock/movements', {
          method: 'POST',
          body: {
            stockItemId: line.id,
            type: action === 'return' ? 'in' : action,
            qty: line.qty,
            worksiteId: action !== 'in' ? worksiteId : null,
            note: action === 'return' ? 'Retour dépôt' : null,
          },
        });
        done++;
      }
      setCart([]);
      setToast(`${done} mouvement${done > 1 ? 's' : ''} enregistré${done > 1 ? 's' : ''}.`);
      onDone();
    } catch (e) {
      setErr((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div className="seg" style={{ marginBottom: '0.9rem' }}>
        <button type="button" className={action === 'in' ? 'on' : ''} onClick={() => setAction('in')}>
          <ArrowDownToLine size={15} strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Réceptionner
        </button>
        <button type="button" className={action === 'out' ? 'on' : ''} onClick={() => setAction('out')}>
          <ArrowUpFromLine size={15} strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Sortir / affecter
        </button>
        <button type="button" className={action === 'return' ? 'on' : ''} onClick={() => setAction('return')}>
          <Undo2 size={15} strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Retourner
        </button>
      </div>

      {action !== 'in' && (
        <div className="field" style={{ maxWidth: 360, marginBottom: '0.9rem' }}>
          <label>Chantier *</label>
          <ComboBox placeholder="chercher un chantier" value={worksiteId} onChange={setWorksiteId} options={meta.worksites.map((w) => ({ value: w.id, label: w.name }))} />
        </div>
      )}

      <div className="stock-scan-layout">
        <div className="stock-catalog">
          <input className="input" placeholder="Nom, catégorie…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="stock-catalog-grid">
            {catalog.length === 0 && <p className="muted" style={{ fontSize: '0.85rem' }}>Aucun article.</p>}
            {catalog.map((it) => (
              <button key={it.id} type="button" className="stock-catalog-card" onClick={() => addToCart(it)}>
                <span className="icon">▥</span>
                <span className="info">
                  <span className="name">{it.name}</span>
                  <span className="sub">{it.qty} {it.unit} en stock{it.category ? ` · ${it.category}` : ''}</span>
                </span>
                <b className="plus">＋</b>
              </button>
            ))}
          </div>
        </div>

        <div className="stock-basket">
          <div className="stock-basket-head">
            <div>
              <div className="eyebrow">À valider</div>
              <strong>{cart.length} article{cart.length > 1 ? 's' : ''}</strong>
            </div>
            <span className="badge plain">{ACTION_BADGE[action]}</span>
          </div>
          <div className="stock-basket-lines">
            {cart.length === 0 ? (
              <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>Cliquez un article dans le catalogue pour l’ajouter.</p>
            ) : cart.map((line) => (
              <div key={line.id} className="stock-basket-line">
                <span className="icon">▥</span>
                <span className="info">
                  <span className="name">{line.name}</span>
                  <span className="sub">{line.unit}</span>
                </span>
                <span className="stock-qty-stepper">
                  <button type="button" onClick={() => setQty(line.id, line.qty - 1)} aria-label={`Diminuer la quantité de ${line.name}`}>−</button>
                  <input
                    type="number" min={1} step="any"
                    value={line.qty}
                    onChange={(e) => setQty(line.id, Number(e.target.value))}
                    aria-label={`Quantité de ${line.name}`}
                  />
                  <button type="button" onClick={() => setQty(line.id, line.qty + 1)} aria-label={`Augmenter la quantité de ${line.name}`}>＋</button>
                </span>
                <button type="button" className="btn ghost" style={{ padding: '0.15rem 0.4rem', fontSize: '0.72rem' }} onClick={() => removeLine(line.id)}>Retirer</button>
              </div>
            ))}
          </div>

          {err && <div className="badge crit" style={{ padding: '0.4rem 0.7rem' }}>{err}</div>}
          {toast && <div className="badge ok" style={{ padding: '0.4rem 0.7rem' }}>{toast}</div>}

          <button type="button" className="btn primary" disabled={busy || cart.length === 0 || (action !== 'in' && !worksiteId)} onClick={submit}>
            {busy ? 'Enregistrement…' : `Confirmer ${ACTION_LABEL[action]} · ${cart.length} article${cart.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- modale mouvement */

function MovementModal({
  item, meta, onClose, onDone,
}: {
  item: StockItem; meta: Meta; onClose: () => void; onDone: () => void;
}) {
  const [type, setType] = useState<'in' | 'out' | 'adjustment'>('in');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [requestedByName, setRequestedByName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/stock/movements', {
        method: 'POST',
        body: {
          stockItemId: item.id,
          type,
          qty: Number(qty || 0),
          unitCost: type === 'in' && unitCost !== '' ? Number(unitCost) : null,
          worksiteId: type === 'out' ? worksiteId || null : null,
          requestedByName: type === 'out' ? requestedByName || null : null,
          note: note || null,
        },
      });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>{item.name}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="muted" style={{ marginBottom: '0.8rem' }}>Stock actuel : <strong>{item.qty} {item.unit}</strong></div>
          <div className="seg" style={{ marginBottom: '0.9rem' }}>
            <button type="button" className={type === 'in' ? 'on' : ''} onClick={() => setType('in')}>Entrée</button>
            <button type="button" className={type === 'out' ? 'on' : ''} onClick={() => setType('out')}>Sortie</button>
            <button type="button" className={type === 'adjustment' ? 'on' : ''} onClick={() => setType('adjustment')}>Inventaire</button>
          </div>

          <div className="field">
            <label>{type === 'adjustment' ? `Quantité réelle comptée (${item.unit})` : `Quantité (${item.unit}) *`}</label>
            <input className="input" type="number" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>

          {type === 'in' && (
            <div className="field">
              <label>Coût unitaire (€, facultatif)</label>
              <input className="input" type="number" step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
          )}

          {type === 'out' && (
            <>
              <div className="field">
                <label>Chantier *</label>
                <ComboBox placeholder="chercher un chantier" value={worksiteId} onChange={setWorksiteId} options={meta.worksites.map((w) => ({ value: w.id, label: w.name }))} />
              </div>
              <div className="field">
                <label>Demandeur</label>
                <input className="input" value={requestedByName} onChange={(e) => setRequestedByName(e.target.value)} placeholder="qui prend la sortie" />
              </div>
            </>
          )}

          <div className="field">
            <label>Note</label>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || !qty || (type === 'out' && !worksiteId)}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- modale historique */

function HistoryModal({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const { data } = useApi<{ items: Movement[]; page: number; totalPages: number }>(
    `/api/stock/movements?stockItemId=${item.id}&page=${page}&pageSize=${pageSize}`,
  );

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{item.name} — historique</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          {!data && <div className="empty">Chargement…</div>}
          {data && data.items.length === 0 && <div className="muted">Aucun mouvement.</div>}
          {data && data.items.length > 0 && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Qté</th><th>Chantier</th><th>Note</th></tr></thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td className="tnum">{formatDateBE(m.createdAt)}</td>
                      <td><span className={`badge ${TYPE_TONE[m.type] ?? ''}`}>{TYPE_LABEL[m.type] ?? m.type}</span></td>
                      <td style={{ textAlign: 'right' }} className="tnum">{m.qty > 0 && m.type !== 'adjustment' ? '+' : ''}{m.qty} {item.unit}</td>
                      <td>{m.worksite ? `${m.worksite.ref} · ${m.worksite.title}` : '—'}</td>
                      <td className="muted" style={{ fontSize: '0.82rem' }}>{[m.requestedByName, m.note].filter(Boolean).join(' — ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && <PaginationBar page={data.page} totalPages={data.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} sizes={[30, 100, 200, PAGE_SIZE_ALL]} />}
        </div>
      </div>
    </div>
  );
}
