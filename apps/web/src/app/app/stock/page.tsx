'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { useSort, SortTh } from '@/lib/sort';
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
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [moveItem, setMoveItem] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const [mode, setMode] = useViewMode('stock');
  const ctxItems = useApi<{ items: StockItem[] }>(`/api/stock/items?${q ? `q=${encodeURIComponent(q)}` : ''}`);
  const { data, loading, reload } = ctxItems;
  const { data: meta } = useApi<Meta>('/api/stock/meta');

  const sort = useSort<StockItem>(data?.items ?? [], {
    name: (i) => i.name,
    category: (i) => i.category,
    qty: (i) => i.qty,
    value: (i) => i.value,
  });

  const totalValue = (data?.items ?? []).reduce((s, i) => s + i.value, 0);
  const lowCount = (data?.items ?? []).filter((i) => i.low).length;

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
        title="Stock de matériaux"
        sub={data ? `${data.items.length} article${data.items.length > 1 ? 's' : ''} · clic sur une ligne pour l’historique` : undefined}
        action={<button className="btn primary" onClick={() => setCreating(true)}>+ Nouvel article</button>}
      />

      <div className="kpis" style={{ marginBottom: '1.2rem' }}>
        <div className="kpi"><span className="ic">Σ</span><div className="label">Valeur du stock</div><div className="value"><Money value={totalValue} /></div></div>
        <div className={`kpi${lowCount ? ' warn' : ''}`}><span className="ic">⚑</span><div className="label">Sous le seuil</div><div className="value">{lowCount}</div></div>
      </div>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Nom, catégorie…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && data.items.length === 0 && <div className="empty">Aucun article. Ajoute le premier matériau du dépôt.</div>}
      {data && data.items.length > 0 && mode === 'gallery' && (
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
      {data && data.items.length > 0 && mode === 'list' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh k="name" sort={sort}>Article</SortTh>
                <SortTh k="category" sort={sort}>Catégorie</SortTh>
                <SortTh k="qty" sort={sort} align="right">Quantité</SortTh>
                <SortTh k="value" sort={sort} align="right">Valeur</SortTh>
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
