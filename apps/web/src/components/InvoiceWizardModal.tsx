'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DEPOSIT_TRIGGERS } from '@jjd/shared';
import { api } from '@/lib/api';
import { formatEur } from '@/lib/ui';
import { DocStatusBadge } from '@/lib/doc-ui';
import type { QuoteBilling } from '@/components/DepositModal';

interface PlanRow { id: string; kind: 'pct' | 'amount'; value: number; trigger: string; label: string | null; amountHt: number; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null }
type Billing = QuoteBilling & { plan?: PlanRow[] };

/**
 * « Facturer le devis » : une frise qui montre tout ce qui a été prévu et facturé — acomptes prévus (un clic chacun), acompte libre,
 * état d'avancement, facture finale — avec le total facturé sur le total du devis. Le devis est accepté automatiquement à la première facture.
 */
export function InvoiceWizardModal({ quote, onClose, onCreated, onFreeDeposit }: {
  quote: { id: string; number: string | null; draftRef: string | null; status: string; totalHt: number; vatRate: number | null; billing?: Billing };
  onClose: () => void; onCreated: (documentId: string) => void; onFreeDeposit: () => void;
}) {
  const b: Billing = quote.billing ?? { totalHt: quote.totalHt, billedHt: 0, remainingHt: quote.totalHt, billedPct: 0, invoices: [] };
  const ratio = 1 + (quote.vatRate ?? 0.21);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function create(key: string, body: object) {
    setBusy(key); setErr(null);
    try {
      const r = await api<{ document: { id: string } }>(`/api/documents/${quote.id}/convert`, { method: 'POST', body });
      onCreated(r.document.id);
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  }
  const done = b.invoices.length > 0 && b.remainingHt <= 0.01;
  const Dot = ({ on }: { on: boolean }) => <span aria-hidden style={{ width: 14, height: 14, borderRadius: 999, flex: 'none', background: on ? 'var(--ok, #2f8f5b)' : 'var(--paper-2, #e9efe9)', border: '2px solid var(--ok, #2f8f5b)' }} />;
  const Step = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
    <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', padding: '0.55rem 0', borderBottom: '1px solid var(--line)' }}><Dot on={on} />{children}</div>
  );

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Facturer le devis {quote.number ?? quote.draftRef}</h2><button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="modal-body" style={{ display: 'block' }}>
          <Step on><div style={{ flex: 1 }}>Devis de <strong>{formatEur(b.totalHt * ratio)} TTC</strong> <span className="muted">({formatEur(b.totalHt)} HT)</span></div><DocStatusBadge status={quote.status === 'draft' || quote.status === 'sent' ? 'sent' : quote.status} /></Step>
          {(b.plan ?? []).map((p) => {
            const label = `${p.kind === 'pct' ? `Acompte de ${p.value} % ` : 'Acompte '}${p.trigger === 'custom' ? (p.label ?? '') : (DEPOSIT_TRIGGERS as Record<string, string>)[p.trigger] ?? ''}`;
            return (
              <Step key={p.id} on={!!p.invoiceId}>
                <div style={{ flex: 1 }}>{label}<div className="muted" style={{ fontSize: '0.8rem' }}>{formatEur(p.amountHt * ratio)} TTC</div></div>
                {p.invoiceId
                  ? <Link className="chip" href={`/app/documents/${p.invoiceId}`}>{p.invoiceNumber} →</Link>
                  : <button className="btn primary" disabled={!!busy} onClick={() => create(p.id, { planId: p.id })}>{busy === p.id ? '…' : 'Facturer'}</button>}
              </Step>
            );
          })}
          {b.invoices.filter((i) => !(b.plan ?? []).some((p) => p.invoiceId === i.id)).map((i) => (
            <Step key={i.id} on><div style={{ flex: 1 }}>{i.kind === 'deposit_invoice' ? 'Acompte' : 'Facture'} <Link className="mono" href={`/app/documents/${i.id}`}>{i.number ?? i.draftRef}</Link> <span className="muted">{formatEur(i.netHt)} HT</span></div><DocStatusBadge status={i.status} /></Step>
          ))}
          {!done && <Step on={false}><div style={{ flex: 1 }}>Acompte libre <span className="muted">(un pourcentage de ce qu’il reste à facturer)</span></div><button className="btn" disabled={!!busy} onClick={onFreeDeposit}>Créer…</button></Step>}
          {!done && <Step on={false}><div style={{ flex: 1 }}>État d’avancement <span className="muted">(facturation ligne par ligne, acomptes déduits au prorata)</span></div><Link className="btn" href={`/app/documents/${quote.id}/avancement`}>Ouvrir</Link></Step>}
          <div style={{ marginTop: '0.8rem' }}>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--paper-2, #e9efe9)', overflow: 'hidden' }} aria-hidden><div style={{ width: `${b.billedPct}%`, height: '100%', background: 'var(--ok, #2f8f5b)' }} /></div>
            <div className="muted" style={{ fontSize: '0.86rem', marginTop: 4 }}>Facturé : <strong>{formatEur(b.billedHt * ratio)}</strong> / {formatEur(b.totalHt * ratio)} TTC ({b.billedPct} %)</div>
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Fermer</button>
          {!done && <button type="button" className="btn primary" disabled={!!busy} onClick={() => create('final', {})}>{busy === 'final' ? '…' : b.billedHt > 0.01 ? `Facturer le solde (${formatEur(b.remainingHt * ratio)} TTC)` : 'Créer la facture finale'}</button>}
        </div>
      </div>
    </div>
  );
}
