'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, formatDateBE } from '@/lib/ui';
import { SkeletonRows, EmptyState } from '@/components/States';
import { ComboBox } from '@/components/ComboBox';
import type { StockItemFull } from '@/components/StockItemModal';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/stock-orders-ui';

interface OrderRow {
  id: string; ref: string; status: string; neededOn: string | null; note: string | null; createdAt: string;
  worksite: { id: string; ref: string; title: string };
  lineCount: number; doneLines: number;
}
interface Meta { worksites: { id: string; name: string }[] }

export default function PreparationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const [tab, setTab] = useState<'open' | 'prepared'>('open');
  const { data, loading, reload } = useApi<{ items: OrderRow[] }>(`/api/stock-orders?status=${tab}`);
  const [creating, setCreating] = useState(false);

  // le magasinier laisse l'écran ouvert : la liste se rafraîchit toute seule quand le bureau crée une préparation
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  const items = data?.items ?? [];
  return (
    <>
      {creating && <NewOrderModal onClose={() => setCreating(false)} onCreated={(id) => router.push(`/app/stock/preparations/${id}`)} />}
      <PageHead
        eyebrow="Magasin"
        title="Préparations de commande"
        sub="Le bureau crée la liste pour un chantier, le magasinier la prépare en scannant chaque article"
        action={canManage ? <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle préparation</button> : undefined}
      />
      <div className="msg-filter-chips" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>À préparer</button>
        <button className={tab === 'prepared' ? 'on' : ''} onClick={() => setTab('prepared')}>Préparées</button>
      </div>
      {loading && !data && <SkeletonRows />}
      {data && items.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title={tab === 'open' ? 'Rien à préparer' : 'Aucune préparation terminée'}
          text={tab === 'open' ? 'Les préparations créées pour un chantier apparaissent ici.' : 'Les préparations validées apparaissent ici.'}
          action={canManage && tab === 'open' ? <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle préparation</button> : undefined}
        />
      )}
      <div style={{ display: 'grid', gap: '0.7rem' }}>
        {items.map((o) => (
          <Link key={o.id} href={`/app/stock/preparations/${o.id}`} className="card card-pad" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '1rem' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                  <strong className="mono">{o.ref}</strong>
                  <span className={`badge ${ORDER_STATUS_TONE[o.status] ?? ''}`}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
                  {o.neededOn && <span className="muted" style={{ fontSize: '0.82rem' }}>pour le {formatDateBE(o.neededOn)}</span>}
                </div>
                <div style={{ fontWeight: 650, marginTop: 4 }}>{o.worksite.ref} · {o.worksite.title}</div>
                {o.note && <div className="muted" style={{ fontSize: '0.82rem' }}>{o.note}</div>}
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{o.doneLines}/{o.lineCount}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>articles prêts</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- création */

interface DraftLine { stockItemId: string; unitName: string; qty: string }

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: meta } = useApi<Meta>('/api/stock/meta');
  const { data: itemsData } = useApi<{ items: StockItemFull[] }>('/api/stock/items');
  const items = itemsData?.items ?? [];
  const [worksiteId, setWorksiteId] = useState('');
  const [neededOn, setNeededOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ stockItemId: '', unitName: '', qty: '1' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const itemOptions = items.map((it) => ({ value: it.id, label: `${it.ref ?? ''} · ${it.name}${it.brand || it.model ? ` (${[it.brand, it.model].filter(Boolean).join(' ')})` : ''}` }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = lines.filter((l) => l.stockItemId);
    if (!worksiteId) { setErr('Choisissez un chantier'); return; }
    if (!valid.length) { setErr('Ajoutez au moins un article'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ order: { id: string } }>('/api/stock-orders', {
        method: 'POST',
        body: {
          worksiteId, neededOn: neededOn || null, note: note || null,
          lines: valid.map((l) => ({ stockItemId: l.stockItemId, unitName: l.unitName || null, qty: Number(String(l.qty).replace(',', '.')) })),
        },
      });
      onCreated(r.order.id);
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Nouvelle préparation de commande</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Chantier *</label>
            <ComboBox placeholder="chercher un chantier" value={worksiteId} onChange={setWorksiteId} options={(meta?.worksites ?? []).map((w) => ({ value: w.id, label: w.name }))} />
          </div>
          <div className="field">
            <label htmlFor="po-date">Pour le</label>
            <input id="po-date" className="input" type="date" value={neededOn} onChange={(e) => setNeededOn(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="po-note">Note pour le magasinier</label>
            <input id="po-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Livraison chantier lundi 7h…" />
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Articles à préparer</label>
            {lines.map((l, i) => {
              const it = items.find((x) => x.id === l.stockItemId);
              return (
                <div key={i} className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ComboBox placeholder="chercher un article (nom, réf.)" value={l.stockItemId} onChange={(v) => setLine(i, { stockItemId: v, unitName: '' })} options={itemOptions} />
                  </div>
                  <input className="input" style={{ width: 90 }} type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label="Quantité" />
                  <select className="select" style={{ width: 130 }} value={l.unitName} onChange={(e) => setLine(i, { unitName: e.target.value })} aria-label="Unité" disabled={!it}>
                    <option value="">{it?.unit ?? 'unité'}</option>
                    {(it?.units ?? []).map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                  </select>
                  <button type="button" className="btn ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Retirer">✕</button>
                </div>
              );
            })}
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setLines((ls) => [...ls, { stockItemId: '', unitName: '', qty: '1' }])}>+ Ajouter un article</button>
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Création…' : 'Créer la préparation'}</button>
        </div>
      </form>
    </div>
  );
}
