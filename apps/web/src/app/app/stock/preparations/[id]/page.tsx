'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateBE } from '@/lib/ui';
import { SkeletonRows, EmptyState } from '@/components/States';
import { ScanInput } from '@/components/ScanInput';
import { scanFeedback } from '@/lib/scanFeedback';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/lib/stock-orders-ui';

interface Line {
  id: string; stockItemId: string; unitName: string | null; qty: number; pickedQty: number; note: string | null;
  stockItem: { id: string; ref: string | null; name: string; brand: string | null; unit: string; qty: number };
}
interface Order {
  id: string; ref: string; status: string; neededOn: string | null; note: string | null;
  preparedBy: string | null; preparedAt: string | null;
  worksite: { id: string; ref: string; title: string; city: string | null };
  lines: Line[];
}

const fmt = (n: number) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 }).format(n);
const EPS = 0.0001;

export default function PreparationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'office' || user?.role === 'storekeeper';
  const canPick = canManage || user?.role === 'foreman';
  const { data, loading, reload } = useApi<{ order: Order }>(`/api/stock-orders/${id}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({});
  const order = data?.order ?? null;

  if (loading && !data) return <SkeletonRows />;
  if (!order) {
    return <EmptyState icon={ClipboardList} title="Préparation introuvable" text="Elle a peut-être été supprimée." action={<Link href="/app/stock/preparations" className="btn primary">Retour aux préparations</Link>} />;
  }

  const open = order.status === 'to_prepare' || order.status === 'preparing';
  const total = order.lines.length;
  const done = order.lines.filter((l) => l.pickedQty + EPS >= l.qty).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const short = order.lines.filter((l) => l.pickedQty + EPS < l.qty);

  async function scan(code: string) {
    setMsg(null);
    try {
      const r = await api<{ order: Order; itemName: string }>(`/api/stock-orders/${id}/scan`, { method: 'POST', body: { code } });
      setMsg({ ok: true, text: `✓ ${r.itemName}` });
      scanFeedback(true);
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Erreur de scan' });
      scanFeedback(false);
    }
  }
  async function setPicked(l: Line, value: number) {
    setMsg(null);
    try {
      await api(`/api/stock-orders/${id}/lines/${l.id}/picked`, { method: 'POST', body: { pickedQty: value } });
      setManual((m) => { const n = { ...m }; delete n[l.id]; return n; });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  async function complete() {
    let allowShort = false;
    if (short.length) {
      const list = short.map((l) => `• ${fmt(l.qty - l.pickedQty)} ${l.unitName ?? l.stockItem.unit} de ${l.stockItem.name}`).join('\n');
      if (!confirm(`Il manque :\n${list}\n\nValider quand même (livraison partielle) ?`)) return;
      allowShort = true;
    } else if (!confirm('Valider la préparation ? Les sorties de stock vers le chantier seront enregistrées.')) return;
    setBusy(true);
    try {
      await api(`/api/stock-orders/${id}/complete`, { method: 'POST', body: { allowShort } });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm('Annuler cette préparation ?')) return;
    await api(`/api/stock-orders/${id}/cancel`, { method: 'POST', body: {} });
    reload();
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <Link href="/app/stock/preparations" className="btn ghost">← Préparations</Link>
        {canManage && open && <button className="btn" onClick={cancel}>Annuler la préparation</button>}
      </div>

      <div className="detail-hero">
        <div className="eyebrow">{order.ref}{order.neededOn ? ` · pour le ${formatDateBE(order.neededOn)}` : ''}</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap', gap: '1rem' }}>
          <h1>{order.worksite.ref} · {order.worksite.title}</h1>
          <span className={`badge ${ORDER_STATUS_TONE[order.status] ?? ''}`}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</span>
        </div>
        <div className="sub">{order.worksite.city ?? ''}{order.note ? `${order.worksite.city ? ' · ' : ''}${order.note}` : ''}</div>
      </div>

      <div style={{ margin: '1.1rem 0' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <strong>{done} / {total} articles prêts</strong>
          <span className="muted">{pct} %</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--ok)' : 'var(--gold)', transition: 'width 0.25s' }} />
        </div>
      </div>

      {open && canPick && (
        <>
          <ScanInput onScan={scan} placeholder="Scannez chaque article préparé…" hint="Chaque scan ajoute 1 à la ligne correspondante. Article hors liste ou quantité dépassée : refusé." />
          {msg && <div className={msg.ok ? 'scan-last' : 'badge crit'} style={msg.ok ? undefined : { padding: '0.5rem 0.8rem', marginBottom: '0.9rem', display: 'block' }}>{msg.text}</div>}
        </>
      )}

      <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1.4rem' }}>
        {order.lines.map((l) => {
          const complete = l.pickedQty + EPS >= l.qty;
          const unit = l.unitName ?? l.stockItem.unit;
          return (
            <div key={l.id} className="card card-pad" style={{ borderLeft: `4px solid ${complete ? 'var(--ok)' : l.pickedQty > 0 ? 'var(--gold)' : 'var(--line)'}` }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '1rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '1.02rem' }}>{l.stockItem.name}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    <span className="mono">{l.stockItem.ref}</span>{l.stockItem.brand ? ` · ${l.stockItem.brand}` : ''} · en stock : {fmt(l.stockItem.qty)} {l.stockItem.unit}
                  </div>
                  {l.note && <div className="muted" style={{ fontSize: '0.8rem' }}>{l.note}</div>}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: '1.7rem', fontWeight: 800, color: complete ? 'var(--ok)' : 'var(--ink)' }}>
                    {fmt(l.pickedQty)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>/ {fmt(l.qty)} {unit}</span>
                  </div>
                  {complete && <span className="badge ok">✓ complet</span>}
                </div>
              </div>
              {open && canPick && (
                <div className="row" style={{ gap: '0.4rem', marginTop: '0.6rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>Quantité préparée :</span>
                  <input
                    className="input" style={{ width: 100 }} type="number" step="any" min="0" max={l.qty}
                    value={manual[l.id] ?? String(l.pickedQty)}
                    onChange={(e) => setManual((m) => ({ ...m, [l.id]: e.target.value }))}
                    aria-label={`Quantité préparée de ${l.stockItem.name}`}
                  />
                  <button className="btn" onClick={() => setPicked(l, Number(String(manual[l.id] ?? l.pickedQty).replace(',', '.')))} disabled={manual[l.id] === undefined}>OK</button>
                  {!complete && <button className="btn ghost" onClick={() => setPicked(l, l.qty)}>Tout prendre</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {open && canPick && (
        <div className="row" style={{ gap: '0.6rem', position: 'sticky', bottom: '0.8rem', background: 'var(--paper)', padding: '0.6rem 0' }}>
          <button className="btn primary" style={{ flex: 1, padding: '0.9rem', fontSize: '1.05rem' }} disabled={busy || done === 0 && order.lines.every((l) => l.pickedQty === 0)} onClick={complete}>
            {busy ? 'Validation…' : short.length ? `Terminer (manque ${short.length})` : 'Terminer la préparation'}
          </button>
        </div>
      )}
      {order.status === 'prepared' && (
        <div className="card card-pad" style={{ borderLeft: '4px solid var(--ok)' }}>
          Préparation validée{order.preparedBy ? ` par ${order.preparedBy}` : ''}{order.preparedAt ? ` le ${formatDateBE(order.preparedAt)}` : ''} : les sorties de stock vers le chantier sont enregistrées.
        </div>
      )}
    </>
  );
}
