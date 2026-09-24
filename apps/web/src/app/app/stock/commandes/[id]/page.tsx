'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateBE, formatEur } from '@/lib/ui';
import { SkeletonRows, EmptyState } from '@/components/States';
import { ScanInput } from '@/components/ScanInput';
import { scanFeedback } from '@/lib/scanFeedback';
import { PO_STATUS_LABEL, PO_STATUS_TONE } from '@/lib/stock-orders-ui';

interface Line {
  id: string; stockItemId: string; unitName: string | null; qty: number; price: number | null; receivedQty: number;
  stockItem: { id: string; ref: string | null; name: string; brand: string | null; model: string | null; unit: string; units: { name: string; factor: number }[] };
}
interface Order {
  id: string; ref: string; status: string; expectedOn: string | null; orderedOn: string | null; supplierRef: string | null; note: string | null;
  contact: { id: string; name: string; customerNumber: string | null; onAccount: boolean; phone: string | null; email: string | null };
  worksite: { id: string; ref: string; title: string } | null;
  lines: Line[];
}

const fmt = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);
const EPS = 0.0001;
const factor = (item: Line['stockItem'], unit: string | null) =>
  !unit || unit.toLowerCase() === item.unit.toLowerCase() ? 1 : item.units.find((u) => u.name.toLowerCase() === unit.toLowerCase())?.factor ?? 1;

export default function CommandeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const canOrder = user?.role === 'admin' || user?.role === 'office';
  const { data, loading, reload } = useApi<{ order: Order }>(`/api/purchasing/orders/${id}`);
  const [pending, setPending] = useState<Record<string, number>>({}); // quantité reçue à valider, par ligne (dans l'unité de la ligne)
  const [deliveryNote, setDeliveryNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const order = data?.order ?? null;

  if (loading && !data) return <SkeletonRows />;
  if (!order) return <EmptyState icon={Truck} title="Commande introuvable" text="Elle a peut-être été supprimée." action={<Link href="/app/stock/commandes" className="btn primary">Retour aux commandes</Link>} />;

  const open = order.status === 'ordered' || order.status === 'partial';
  const total = order.lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0);
  const pendingCount = Object.values(pending).filter((q) => q > 0).length;

  async function scan(code: string) {
    setMsg(null);
    try {
      const r = await api<{ item: { id: string; name: string }; unitName: string | null }>(`/api/stock/scan/${encodeURIComponent(code)}`);
      const lines = order!.lines.filter((l) => l.stockItemId === r.item.id);
      if (!lines.length) { setMsg({ ok: false, text: `« ${r.item.name} » n’est pas dans cette commande` }); scanFeedback(false); return; }
      // ligne dont il reste le plus à recevoir, avec ce qui est déjà scanné en attente
      const line = lines.find((l) => (pending[l.id] ?? 0) + l.receivedQty + EPS < l.qty) ?? lines[0]!;
      const inLineUnit = factor(line.stockItem, r.unitName) / factor(line.stockItem, line.unitName);
      setPending((p) => ({ ...p, [line.id]: Math.round(((p[line.id] ?? 0) + inLineUnit) * 100) / 100 }));
      setMsg({ ok: true, text: `✓ ${r.item.name}` });
      scanFeedback(true);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError && e.status === 404 ? `Code « ${code} » inconnu` : (e as Error).message });
      scanFeedback(false);
    }
  }

  async function receive() {
    const lines = order!.lines.filter((l) => (pending[l.id] ?? 0) > 0).map((l) => ({ lineId: l.id, qty: pending[l.id]! }));
    if (!lines.length) return;
    const over = order!.lines.filter((l) => (pending[l.id] ?? 0) > 0 && l.receivedQty + pending[l.id]! > l.qty + EPS);
    if (over.length && !confirm(`Quantité reçue supérieure à la commande pour : ${over.map((l) => l.stockItem.name).join(', ')}. Valider quand même ?`)) return;
    setBusy(true);
    try {
      await api(`/api/purchasing/orders/${id}/receive`, { method: 'POST', body: { lines, deliveryNote: deliveryNote || null } });
      setPending({});
      setDeliveryNote('');
      setMsg({ ok: true, text: 'Réception enregistrée : le stock est à jour.' });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function act(path: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await api(`/api/purchasing/orders/${id}/${path}`, { method: 'POST', body: {} });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/stock/commandes" className="btn ghost">← Commandes</Link>
        <div className="row">
          {canOrder && order.status === 'draft' && <button className="btn primary" onClick={() => act('place')}>Marquer comme commandée</button>}
          {canOrder && order.status === 'partial' && <button className="btn" onClick={() => act('close', 'Clôturer cette commande ? Le reste ne sera plus attendu.')}>Clôturer (reste non livré)</button>}
          {canOrder && (order.status === 'draft' || order.status === 'ordered') && <button className="btn" onClick={() => act('cancel', 'Annuler cette commande ?')}>Annuler</button>}
        </div>
      </div>

      <div className="detail-hero">
        <div className="eyebrow">{order.ref}{order.expectedOn ? ` · attendue le ${formatDateBE(order.expectedOn)}` : ''}</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap', gap: '1rem' }}>
          <h1>{order.contact.name}</h1>
          <span className={`badge ${PO_STATUS_TONE[order.status] ?? ''}`}>{PO_STATUS_LABEL[order.status] ?? order.status}</span>
        </div>
        <div className="sub">
          {[order.contact.customerNumber ? `N° client ${order.contact.customerNumber}` : null, order.contact.onAccount ? 'en compte' : null, order.worksite ? `Chantier ${order.worksite.ref}` : null, order.supplierRef ? `Réf. ${order.supplierRef}` : null, order.note].filter(Boolean).join(' · ')}
        </div>
      </div>

      {open && canManage && (
        <div style={{ marginTop: '1.1rem' }}>
          <ScanInput onScan={scan} placeholder="Scannez chaque article livré…" hint="Chaque scan ajoute 1 à la quantité reçue. Rien n’entre en stock avant « Valider la réception »." />
          {msg && <div className={msg.ok ? 'scan-last' : 'badge crit'} style={msg.ok ? undefined : { padding: '0.5rem 0.8rem', marginBottom: '0.9rem', display: 'block' }}>{msg.text}</div>}
        </div>
      )}
      {!open && msg && <div className={msg.ok ? 'scan-last' : 'badge crit'}>{msg.text}</div>}

      <div style={{ display: 'grid', gap: '0.6rem', margin: '1rem 0 1.4rem' }}>
        {order.lines.map((l) => {
          const unit = l.unitName ?? l.stockItem.unit;
          const p = pending[l.id] ?? 0;
          const done = l.receivedQty + EPS >= l.qty;
          return (
            <div key={l.id} className="card card-pad" style={{ borderLeft: `4px solid ${done ? 'var(--ok)' : l.receivedQty + p > 0 ? 'var(--gold)' : 'var(--line)'}` }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '1rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '1.02rem' }}>{l.stockItem.name}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    <span className="mono">{l.stockItem.ref}</span>{l.stockItem.brand || l.stockItem.model ? ` · ${[l.stockItem.brand, l.stockItem.model].filter(Boolean).join(' ')}` : ''}
                    {canOrder && l.price != null ? ` · ${formatEur(l.price)} HT / ${unit}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: done ? 'var(--ok)' : 'var(--ink)' }}>
                    {fmt(l.receivedQty)}{p > 0 && <span style={{ color: 'var(--gold)' }}> +{fmt(p)}</span>} <span className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>/ {fmt(l.qty)} {unit}</span>
                  </div>
                  {done && <span className="badge ok">✓ complet</span>}
                </div>
              </div>
              {open && canManage && (
                <div className="row" style={{ gap: '0.4rem', marginTop: '0.6rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>Reçu maintenant :</span>
                  <input className="input" style={{ width: 100 }} type="number" step="any" min="0" value={p || ''} placeholder="0"
                    onChange={(e) => setPending((m) => ({ ...m, [l.id]: Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0) }))}
                    aria-label={`Quantité reçue de ${l.stockItem.name}`} />
                  <span className="muted" style={{ fontSize: '0.8rem' }}>{unit}</span>
                  {!done && <button className="btn ghost" onClick={() => setPending((m) => ({ ...m, [l.id]: Math.max(0, l.qty - l.receivedQty) }))}>Tout reçu</button>}
                  {p > 0 && <button className="btn ghost" onClick={() => setPending((m) => ({ ...m, [l.id]: 0 }))}>Effacer</button>}
                </div>
              )}
            </div>
          );
        })}
        {canOrder && total > 0 && <div className="muted" style={{ textAlign: 'right' }}>Total commandé : <strong>{formatEur(total)} HT</strong></div>}
      </div>

      {open && canManage && (
        <div style={{ position: 'sticky', bottom: '0.8rem', background: 'var(--paper)', padding: '0.6rem 0' }}>
          <div className="row" style={{ gap: '0.6rem', alignItems: 'center' }}>
            <input className="input" style={{ maxWidth: 260 }} placeholder="N° du bon de livraison (facultatif)" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
            <button className="btn primary" style={{ flex: 1, padding: '0.9rem', fontSize: '1.05rem' }} disabled={busy || pendingCount === 0} onClick={receive}>
              {busy ? 'Enregistrement…' : pendingCount ? `Valider la réception (${pendingCount} ligne${pendingCount > 1 ? 's' : ''})` : 'Scannez ou saisissez ce qui est arrivé'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
