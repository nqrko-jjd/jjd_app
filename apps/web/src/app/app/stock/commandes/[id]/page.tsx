'use client';
import { use, useRef, useState } from 'react';
import Link from 'next/link';
import '../../warehouse-workflow.css';
import { Truck, MapPin } from 'lucide-react';
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
  stockItem: { id: string; ref: string | null; name: string; brand: string | null; model: string | null; unit: string; photoThumbUrl: string | null; units: { name: string; factor: number }[] };
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

/** Pré-remplit un e-mail de commande dans le client mail de l'utilisateur — jamais envoyé par
 *  l'appli elle-même (pas de SMTP configuré), juste préparé pour relecture avant envoi. */
function orderEmailHref(order: Order): string {
  const lines = order.lines.map((l) => {
    const unit = l.unitName ?? l.stockItem.unit;
    return `- ${l.stockItem.ref ? `${l.stockItem.ref} · ` : ''}${l.stockItem.name} : ${fmt(l.qty)} ${unit}`;
  }).join('\n');
  const subject = `Commande ${order.ref}${order.worksite ? ` — chantier ${order.worksite.ref}` : ''}`;
  const body = [
    'Bonjour,',
    '',
    'Merci de bien vouloir nous confirmer la commande suivante :',
    '',
    lines,
    '',
    order.note ? `Note : ${order.note}` : null,
    order.expectedOn ? `Livraison souhaitée pour le ${formatDateBE(order.expectedOn)}.` : null,
    '',
    'Cordialement,',
  ].filter((l) => l !== null).join('\n');
  return `mailto:${encodeURIComponent(order.contact.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function CommandeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const canOrder = user?.role === 'admin' || user?.role === 'office';
  const { data, loading, error, reload } = useApi<{ order: Order }>(`/api/purchasing/orders/${id}`);
  const [pending, setPending] = useState<Record<string, number>>({}); // quantité reçue à valider, par ligne (dans l'unité de la ligne)
  const [deliveryNote, setDeliveryNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rack, setRack] = useState<string | null>(null); // rack où la marchandise est rangée (étiquette scannée)
  const [editing, setEditing] = useState<string | null>(null);
  const [showReceived, setShowReceived] = useState(false);
  const [scanning, setScanning] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const operation = useRef(false);
  const order = data?.order ?? null;

  if (loading && !data) return <SkeletonRows />;
  if (error && !order) return <div role="alert" className="card card-pad"><p>{error}</p><button className="btn" onClick={reload}>Réessayer</button></div>;
  if (!order) return <EmptyState icon={Truck} title="Commande introuvable" text="Elle a peut-être été supprimée." action={<Link href="/app/stock/commandes" className="btn primary">Retour aux commandes</Link>} />;

  const open = order.status === 'ordered' || order.status === 'partial';
  const total = order.lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0);
  const pendingCount = Object.values(pending).filter((q) => q > 0).length;

  function enqueueScan(code: string) {
    if (operation.current) return;
    setScanning((n) => n + 1);
    queue.current = queue.current.then(() => scan(code)).finally(() => setScanning((n) => n - 1));
  }

  async function scan(code: string) {
    setMsg(null);
    if (/^(BRZ|RACK)-.+/i.test(code.trim())) {
      const r = code.trim().toUpperCase().replace(/^(BRZ|RACK)-/, '');
      setRack(r);
      setMsg({ ok: true, text: `✓ ${r}` });
      scanFeedback(true);
      return;
    }
    try {
      const r = await api<{ kind: 'rack'; code: string } | { kind: 'stock'; item: { id: string; name: string }; unitName: string | null }>(`/api/stock/scan/${encodeURIComponent(code)}`);
      if (r.kind === 'rack') { setRack(r.code); setMsg({ ok: true, text: `✓ Zone ${r.code}` }); scanFeedback(true); return; }
      const lines = order!.lines.filter((l) => l.stockItemId === r.item.id);
      if (!lines.length) { setMsg({ ok: false, text: `« ${r.item.name} » n’est pas dans cette commande` }); scanFeedback(false); return; }
      // ligne dont il reste le plus à recevoir, avec ce qui est déjà scanné en attente
      setPending((p) => {
        const line = lines.find((l) => (p[l.id] ?? 0) + l.receivedQty + EPS < l.qty) ?? lines[0]!;
        const inLineUnit = factor(line.stockItem, r.unitName) / factor(line.stockItem, line.unitName);
        return { ...p, [line.id]: Math.round(((p[line.id] ?? 0) + inLineUnit) * 100) / 100 };
      });
      setMsg({ ok: true, text: `✓ ${r.item.name}` });
      scanFeedback(true);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError && e.status === 404 ? `Code « ${code} » inconnu` : (e as Error).message });
      scanFeedback(false);
    }
  }

  async function receive() {
    if (operation.current || scanning > 0 || loading) return;
    const lines = order!.lines.filter((l) => (pending[l.id] ?? 0) > 0).map((l) => ({ lineId: l.id, qty: pending[l.id]! }));
    if (!lines.length) return;
    const over = order!.lines.filter((l) => (pending[l.id] ?? 0) > 0 && l.receivedQty + pending[l.id]! > l.qty + EPS);
    if (over.length && !confirm(`Quantité reçue supérieure à la commande pour : ${over.map((l) => l.stockItem.name).join(', ')}. Valider quand même ?`)) return;
    operation.current = true;
    setBusy(true);
    try {
      await api(`/api/purchasing/orders/${id}/receive`, { method: 'POST', body: { lines, deliveryNote: deliveryNote || null, location: rack } });
      setPending({});
      setEditing(null);
      setDeliveryNote('');
      setMsg({ ok: true, text: 'Réception enregistrée : le stock est à jour.' });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function act(path: string, confirmText?: string) {
    if (operation.current || scanning > 0) return;
    if (confirmText && !confirm(confirmText)) return;
    operation.current = true; setBusy(true);
    try {
      await api(`/api/purchasing/orders/${id}/${path}`, { method: 'POST', body: {} });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { operation.current = false; setBusy(false); }
  }

  return (
    <div className="warehouse-workflow">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/stock/commandes" className="btn ghost">← Commandes</Link>
        <div className="row">
          {canOrder && (
            <a
              className="btn"
              href={orderEmailHref(order)}
              title={order.contact.email ? undefined : 'Aucun e-mail enregistré pour ce fournisseur — à compléter sur sa fiche contact'}
            >
              ✉️ Générer l’e-mail
            </a>
          )}
          <a className="btn" href={`/imprimer/commande/${order.id}`} target="_blank" rel="noreferrer">🖨️ Imprimer</a>
          {canOrder && order.status === 'draft' && <button className="btn primary" disabled={busy || scanning > 0} onClick={() => act('place')}>Marquer comme commandée</button>}
          {canOrder && order.status === 'partial' && <button className="btn" disabled={busy || scanning > 0} onClick={() => act('close', 'Clôturer cette commande ? Le reste ne sera plus attendu.')}>Clôturer (reste non livré)</button>}
          {canOrder && (order.status === 'draft' || order.status === 'ordered') && <button className="btn" disabled={busy || scanning > 0} onClick={() => act('cancel', 'Annuler cette commande ?')}>Annuler</button>}
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
          <ScanInput disabled={busy} showReceivedCode={false} onScan={enqueueScan} placeholder="Scannez chaque article livré…" hint="Scannez à la suite. Le stock est mis à jour à la validation du lot." />
          <div className={`rack-bar${rack ? ' on' : ''}`}>
            <MapPin size={20} strokeWidth={2} />
            <div className="rack-bar-txt">
              {rack ? <><strong>{rack}</strong><span> — la marchandise reçue y est rangée</span></> : <span>Scannez l’étiquette du <strong>rack</strong> où vous rangez <span className="muted">(facultatif)</span></span>}
            </div>
            {rack && <button type="button" className="btn ghost" disabled={busy || scanning > 0} onClick={() => setRack(null)} aria-label="Retirer le rack">✕</button>}
          </div>
          <details className="warehouse-zone-edit"><summary>{rack ? `Zone active : ${rack} · modifier` : 'Choisir une zone sans scanner'}</summary><input className="input" aria-label="Zone de réception" placeholder="Ex. R-01-A" disabled={busy || scanning > 0} defaultValue={rack ?? ''} key={rack ?? 'none'} onBlur={(e) => { const value = e.target.value.trim().toUpperCase().replace(/^(BRZ|RACK)-/, ''); if (value) setRack(value); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} /></details>
          {msg && <div className={msg.ok ? 'scan-last' : 'badge crit'} style={msg.ok ? undefined : { padding: '0.5rem 0.8rem', marginBottom: '0.9rem', display: 'block' }}>{msg.text}</div>}
        </div>
      )}
      {!open && msg && <div className={msg.ok ? 'scan-last' : 'badge crit'}>{msg.text}</div>}

      <div className="warehouse-list-heading"><strong>{open ? 'Articles attendus' : 'Articles commandés'}</strong>{open && order.lines.some((l) => l.receivedQty + EPS >= l.qty) && <button type="button" className="btn ghost" onClick={() => setShowReceived((v) => !v)}>{showReceived ? 'Masquer' : 'Voir'} les déjà reçus</button>}{scanning > 0 && <span role="status">{scanning} lecture{scanning > 1 ? 's' : ''}…</span>}</div>
      <div style={{ display: 'grid', gap: '0.6rem', margin: '1rem 0 1.4rem' }}>
        {order.lines.filter((l) => !open || showReceived || (pending[l.id] ?? 0) > 0 || l.receivedQty + EPS < l.qty).map((l) => {
          const unit = l.unitName ?? l.stockItem.unit;
          const p = pending[l.id] ?? 0;
          const done = l.receivedQty + EPS >= l.qty;
          return (
            <div key={l.id} className="card card-pad warehouse-line" style={{ borderLeft: `4px solid ${done ? 'var(--ok)' : l.receivedQty + p > 0 ? 'var(--gold)' : 'var(--line)'}` }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '1rem' }}>
                {l.stockItem.photoThumbUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  && <img src={l.stockItem.photoThumbUrl} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
                <div style={{ minWidth: 0, flex: 1 }}>
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
              {open && canManage && <div className="warehouse-line-actions">{!done && <button className="btn" disabled={busy || scanning > 0} onClick={() => setPending((m) => ({ ...m, [l.id]: Math.max(0, l.qty - l.receivedQty) }))}>Tout reçu</button>}<button className="btn ghost" disabled={busy || scanning > 0} onClick={() => setEditing(editing === l.id ? null : l.id)}>{editing === l.id ? 'Fermer' : 'Ajuster'}</button>{p > 0 && <span className="badge ok">{fmt(p)} {unit} à valider</span>}</div>}
              {open && canManage && editing === l.id && (
                <fieldset className="warehouse-edit-lock" disabled={busy || scanning > 0}><div className="row" style={{ gap: '0.4rem', marginTop: '0.6rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>Reçu maintenant :</span>
                  <input className="input" style={{ width: 100 }} type="number" step="any" min="0" value={p || ''} placeholder="0"
                    onChange={(e) => setPending((m) => ({ ...m, [l.id]: Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0) }))}
                    aria-label={`Quantité reçue de ${l.stockItem.name}`} />
                  <span className="muted" style={{ fontSize: '0.8rem' }}>{unit}</span>

                  {p > 0 && <button className="btn ghost" onClick={() => setPending((m) => ({ ...m, [l.id]: 0 }))}>Effacer</button>}
                </div></fieldset>
              )}
            </div>
          );
        })}
        {canOrder && total > 0 && <div className="muted" style={{ textAlign: 'right' }}>Total commandé : <strong>{formatEur(total)} HT</strong></div>}
      </div>

      {open && canManage && (
        <div className="warehouse-actionbar" style={{ position: 'sticky', bottom: '0.8rem', background: 'var(--paper)', padding: '0.6rem 0' }}>
          <div className="row" style={{ gap: '0.6rem', alignItems: 'center' }}>
            <input className="input" style={{ maxWidth: 260 }} placeholder="N° du bon de livraison (facultatif)" value={deliveryNote} disabled={busy} onChange={(e) => setDeliveryNote(e.target.value)} />
            <button className="btn primary" style={{ flex: 1, padding: '0.9rem', fontSize: '1.05rem' }} disabled={busy || scanning > 0 || loading || pendingCount === 0} onClick={receive}>
              {busy ? 'Enregistrement…' : pendingCount ? `Valider la réception (${pendingCount} ligne${pendingCount > 1 ? 's' : ''})` : 'Scannez ou saisissez ce qui est arrivé'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
