'use client';
import { Warehouse, Layers, AlertTriangle, Package } from 'lucide-react';
import { SkeletonRows, EmptyState } from '@/components/States';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Money, formatDateBE, Kpi } from '@/lib/ui';
import { ComboBox } from '@/components/ComboBox';
import { PaginationBar, PAGE_SIZE_ALL } from '@/components/PaginationBar';

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

export default function StockDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = user?.role !== 'worker';
  const { data, loading } = useApi<{ items: StockItem[] }>('/api/stock/items');
  const { data: meta } = useApi<Meta>('/api/stock/meta');
  const item = data?.items.find((i) => i.id === id) ?? null;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const { data: moves, reload: reloadMoves } = useApi<{ items: Movement[]; page: number; totalPages: number }>(
    `/api/stock/movements?stockItemId=${id}&page=${page}&pageSize=${pageSize}`,
  );
  const [moving, setMoving] = useState(false);

  if (loading && !data) return <SkeletonRows />;
  if (!item) {
    return (
      <EmptyState
        icon={Warehouse}
        title="Article introuvable"
        text="Cet article n’existe plus ou a été désactivé. Retournez au stock."
        action={<Link href="/app/stock" className="btn primary">Retour au stock</Link>}
      />
    );
  }

  return (
    <>
      {moving && meta && (
        <MovementModal item={item} meta={meta} onClose={() => setMoving(false)} onDone={() => { setMoving(false); reloadMoves(); }} />
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/stock" className="btn ghost">← Stock</Link>
      </div>

      <div className="detail-hero">
        <div className="eyebrow">{item.category ?? 'Stock de matériaux'}</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap', gap: '1rem' }}>
          <h1>{item.name}</h1>
          <span className={`badge ${item.low ? 'crit' : 'ok'}`}>{item.low ? 'À réapprovisionner' : 'Disponible'}</span>
        </div>
        <div className="sub">{item.qty} {item.unit} en stock</div>
      </div>

      <div className="kpis" style={{ margin: '1.4rem 0' }}>
        <Kpi ic={Package} label="Quantité en stock" value={`${item.qty} ${item.unit}`} sub={item.category ?? 'Article suivi'} hero />
        <Kpi ic={Layers} label="Valeur" value={<Money value={item.value} />} sub={item.avgCost != null ? `Coût moyen ${item.avgCost.toFixed(2)} €` : 'Coût moyen non défini'} />
        <Kpi
          ic={AlertTriangle}
          label="Seuil d’alerte"
          value={item.minQty ?? '—'}
          sub={item.low ? 'Sous le seuil' : 'Au-dessus du seuil'}
          warn={item.low}
        />
      </div>

      {canManage && (
        <div className="row" style={{ marginBottom: '1.4rem' }}>
          <button className="btn primary" onClick={() => setMoving(true)}>+ Mouvement</button>
        </div>
      )}

      <div className="section-title">Historique des mouvements</div>
      {!moves && <SkeletonRows />}
      {moves && moves.items.length === 0 && <div className="empty">Aucun mouvement.</div>}
      {moves && moves.items.length > 0 && (
        <div className="tbl-wrap" style={{ marginBottom: '1rem' }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Qté</th><th>Chantier</th><th>Note</th></tr></thead>
            <tbody>
              {moves.items.map((m) => (
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
      {moves && <PaginationBar page={moves.page} totalPages={moves.totalPages} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} sizes={[30, 100, 200, PAGE_SIZE_ALL]} />}
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
