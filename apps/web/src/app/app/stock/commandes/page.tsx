'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Truck } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, formatDateBE, formatEur } from '@/lib/ui';
import { SkeletonRows, EmptyState } from '@/components/States';
import { ComboBox } from '@/components/ComboBox';
import { ContactPicker } from '@/components/ContactPicker';
import type { StockItemFull } from '@/components/StockItemModal';
import { PO_STATUS_LABEL, PO_STATUS_TONE } from '@/lib/stock-orders-ui';

interface OrderRow {
  id: string; ref: string; status: string; expectedOn: string | null; orderedOn: string | null; supplierRef: string | null; note: string | null;
  contact: { id: string; name: string }; worksite: { id: string; ref: string } | null;
  lineCount: number; receivedLines: number; totalHt: number;
}
interface Meta { worksites: { id: string; name: string }[] }

export default function CommandesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canOrder = user?.role === 'admin' || user?.role === 'office';
  const [tab, setTab] = useState<'open' | 'draft' | 'received'>('open');
  const { data, loading, reload } = useApi<{ items: OrderRow[] }>(`/api/purchasing/orders?status=${tab}`);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  const items = data?.items ?? [];
  return (
    <>
      {creating && <NewOrderModal onClose={() => setCreating(false)} onCreated={(id) => router.push(`/app/stock/commandes/${id}`)} />}
      <PageHead
        eyebrow="Magasin"
        title="Commandes fournisseurs"
        sub="Le bureau commande, le magasinier réceptionne en scannant ce qui arrive"
        action={
          <div className="row">
            {canOrder && <Link href="/app/stock/tarifs" className="btn">Tarifs fournisseurs</Link>}
            {canOrder && <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle commande</button>}
          </div>
        }
      />
      <div className="msg-filter-chips" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>À réceptionner</button>
        {canOrder && <button className={tab === 'draft' ? 'on' : ''} onClick={() => setTab('draft')}>Brouillons</button>}
        <button className={tab === 'received' ? 'on' : ''} onClick={() => setTab('received')}>Reçues</button>
      </div>
      {loading && !data && <SkeletonRows />}
      {data && items.length === 0 && (
        <EmptyState
          icon={Truck}
          title={tab === 'open' ? 'Aucune livraison attendue' : tab === 'draft' ? 'Aucun brouillon' : 'Aucune commande reçue'}
          text="Les commandes fournisseurs apparaissent ici."
          action={canOrder && tab === 'open' ? <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle commande</button> : undefined}
        />
      )}
      <div style={{ display: 'grid', gap: '0.7rem' }}>
        {items.map((o) => (
          <Link key={o.id} href={`/app/stock/commandes/${o.id}`} className="card card-pad" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '1rem' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                  <strong className="mono">{o.ref}</strong>
                  <span className={`badge ${PO_STATUS_TONE[o.status] ?? ''}`}>{PO_STATUS_LABEL[o.status] ?? o.status}</span>
                  {o.expectedOn && <span className="muted" style={{ fontSize: '0.82rem' }}>attendue le {formatDateBE(o.expectedOn)}</span>}
                </div>
                <div style={{ fontWeight: 650, marginTop: 4 }}>{o.contact.name}</div>
                <div className="muted" style={{ fontSize: '0.82rem' }}>
                  {[o.worksite ? `Chantier ${o.worksite.ref}` : null, o.supplierRef ? `Réf. ${o.supplierRef}` : null, o.note].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{o.receivedLines}/{o.lineCount}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>lignes reçues</div>
                {canOrder && o.totalHt > 0 && <div className="muted" style={{ fontSize: '0.8rem' }}>{formatEur(o.totalHt)} HT</div>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- création */

interface DraftLine { stockItemId: string; unitName: string; qty: string; price: string; priceAuto: boolean }

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: meta } = useApi<Meta>('/api/stock/meta');
  const { data: itemsData } = useApi<{ items: StockItemFull[] }>('/api/stock/items');
  const items = itemsData?.items ?? [];
  const [contactId, setContactId] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ stockItemId: '', unitName: '', qty: '1', price: '', priceAuto: true }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const itemOptions = items.map((it) => ({ value: it.id, label: `${it.ref ?? ''} · ${it.name}${it.brand || it.model ? ` (${[it.brand, it.model].filter(Boolean).join(' ')})` : ''}` }));

  /** Prix connu de ce fournisseur pour cet article/conditionnement. */
  function knownPrice(itemId: string, unitName: string, supplier: string): string {
    const it = items.find((x) => x.id === itemId);
    const link = it?.suppliers.find((s) => s.contactId === supplier && (s.unitName ?? '') === unitName);
    return link?.price != null ? String(link.price) : '';
  }
  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const next = { ...l, ...patch };
      if ((patch.stockItemId !== undefined || patch.unitName !== undefined) && next.priceAuto) next.price = knownPrice(next.stockItemId, next.unitName, contactId);
      return next;
    }));
  }
  // changer de fournisseur remet à jour les prix qui n'ont pas été saisis à la main
  useEffect(() => {
    setLines((ls) => ls.map((l) => (l.priceAuto ? { ...l, price: knownPrice(l.stockItemId, l.unitName, contactId) } : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function submit(e: React.FormEvent, status: 'ordered' | 'draft') {
    e.preventDefault();
    const valid = lines.filter((l) => l.stockItemId);
    if (!contactId) { setErr('Choisissez un fournisseur'); return; }
    if (!valid.length) { setErr('Ajoutez au moins un article'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ order: { id: string } }>('/api/purchasing/orders', {
        method: 'POST',
        body: {
          contactId, worksiteId: worksiteId || null, expectedOn: expectedOn || null, supplierRef: supplierRef || null, note: note || null, status,
          lines: valid.map((l) => ({
            stockItemId: l.stockItemId, unitName: l.unitName || null, qty: Number(String(l.qty).replace(',', '.')),
            price: l.price === '' ? null : Number(String(l.price).replace(',', '.')),
          })),
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
      <form className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => submit(e, 'ordered')}>
        <div className="modal-head">
          <h2>Nouvelle commande fournisseur</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Fournisseur *</label>
            <ContactPicker typeFilter="supplier" value={contactId} onChange={(id) => setContactId(id)} />
          </div>
          <div className="field">
            <label htmlFor="cf-date">Livraison attendue le</label>
            <input id="cf-date" className="input" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </div>
          <div className="field">
            <label>Pour le chantier (facultatif)</label>
            <ComboBox placeholder="chercher un chantier" value={worksiteId} onChange={setWorksiteId} options={(meta?.worksites ?? []).map((w) => ({ value: w.id, label: w.name }))} />
          </div>
          <div className="field">
            <label htmlFor="cf-ref">N° de commande / devis chez le fournisseur</label>
            <input id="cf-ref" className="input" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cf-note">Note</label>
            <input id="cf-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Articles commandés</label>
            {lines.map((l, i) => {
              const it = items.find((x) => x.id === l.stockItemId);
              return (
                <div key={i} className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ComboBox placeholder="chercher un article" value={l.stockItemId} onChange={(v) => setLine(i, { stockItemId: v, unitName: '' })} options={itemOptions} />
                  </div>
                  <input className="input" style={{ width: 80 }} type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label="Quantité" />
                  <select className="select" style={{ width: 110 }} value={l.unitName} onChange={(e) => setLine(i, { unitName: e.target.value })} aria-label="Unité" disabled={!it}>
                    <option value="">{it?.unit ?? 'unité'}</option>
                    {(it?.units ?? []).map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                  </select>
                  <input className="input" style={{ width: 100 }} type="number" step="any" min="0" placeholder="Prix HT" value={l.price} onChange={(e) => setLine(i, { price: e.target.value, priceAuto: false })} aria-label="Prix HT par unité" />
                  <button type="button" className="btn ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Retirer">✕</button>
                </div>
              );
            })}
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setLines((ls) => [...ls, { stockItemId: '', unitName: '', qty: '1', price: '', priceAuto: true }])}>+ Ajouter un article</button>
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn" disabled={busy} onClick={(e) => submit(e, 'draft')}>Enregistrer en brouillon</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Création…' : 'Commander'}</button>
        </div>
      </form>
    </div>
  );
}
