'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatEur } from '@/lib/ui';

export interface QuoteBilling {
  totalHt: number; billedHt: number; remainingHt: number; billedPct: number;
  invoices: { id: string; number: string | null; draftRef: string | null; kind: string; status: string; netHt: number }[];
}

const PRESETS = [10, 20, 30, 40, 50, 70];
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Facture d'acompte depuis un devis : on choisit le pourcentage, calculé sur ce qu'il RESTE à facturer
 * (1er acompte : % du devis ; suivants : % du solde). Ou on facture directement le solde, acomptes déjà facturés déduits.
 */
export function DepositModal({ quote, onClose, onCreated }: {
  quote: { id: string; number: string | null; draftRef: string | null; vatRate: number | null; totalHt: number; billing?: QuoteBilling };
  onClose: () => void;
  onCreated: (documentId: string) => void;
}) {
  const billing: QuoteBilling = quote.billing ?? { totalHt: quote.totalHt, billedHt: 0, remainingHt: quote.totalHt, billedPct: 0, invoices: [] };
  const vat = quote.vatRate ?? 0.21;
  const [pct, setPct] = useState('30');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const pctNum = Number(pct.replace(',', '.'));
  const valid = pctNum > 0 && pctNum <= 100;
  const amountHt = valid ? round2(billing.remainingHt * (pctNum / 100)) : 0;
  const done = billing.invoices.length > 0 && billing.remainingHt <= 0.01;

  async function create(body: object) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ document: { id: string } }>(`/api/documents/${quote.id}/convert`, { method: 'POST', body });
      onCreated(r.document.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (!valid) { setErr('Choisissez un pourcentage entre 1 et 100.'); return; } create({ depositPct: pctNum }); }}>
        <div className="modal-head">
          <h2>Facture d’acompte · devis {quote.number ?? quote.draftRef}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--paper-2, #e9efe9)', overflow: 'hidden' }} aria-hidden>
              <div style={{ width: `${billing.billedPct}%`, height: '100%', background: 'var(--ok, #2f8f5b)' }} />
            </div>
            <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.86rem' }}>
              Devis {formatEur(billing.totalHt)} HT · déjà facturé {formatEur(billing.billedHt)} ({billing.billedPct} %) · <strong>reste {formatEur(billing.remainingHt)} HT</strong>
            </p>
            {billing.invoices.length > 0 && (
              <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>
                {billing.invoices.map((i) => `${i.number ?? i.draftRef} (${formatEur(i.netHt)})`).join(' · ')}
              </p>
            )}
          </div>
          {done ? (
            <div className="field" style={{ gridColumn: '1 / -1' }}><span className="badge ok">Ce devis est déjà entièrement facturé.</span></div>
          ) : (
            <>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>{billing.billedHt > 0.01 ? 'Pourcentage du solde restant' : 'Pourcentage du devis'}</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {PRESETS.map((p) => (
                    <button type="button" key={p} className={`btn${pctNum === p ? ' primary' : ''}`} onClick={() => setPct(String(p))}>{p} %</button>
                  ))}
                </div>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="dep-pct">Autre pourcentage</label>
                <input id="dep-pct" className="input" inputMode="decimal" style={{ maxWidth: 140 }} value={pct} onChange={(e) => setPct(e.target.value)} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <p style={{ margin: 0 }}>
                  Cette facture : <strong>{formatEur(amountHt)} HT</strong> · {formatEur(round2(amountHt * (1 + vat)))} TTC
                  {valid && billing.remainingHt > 0 && <span className="muted"> · il restera {formatEur(round2(billing.remainingHt - amountHt))} HT à facturer</span>}
                </p>
              </div>
            </>
          )}
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          {!done && billing.billedHt > 0.01 && <button type="button" className="btn" disabled={busy} onClick={() => create({})} title="Lignes du devis, acomptes déjà facturés déduits">Facturer le solde ({formatEur(billing.remainingHt)} HT)</button>}
          {!done && <button type="submit" className="btn primary" disabled={busy || !valid}>{busy ? 'Création…' : `Créer l’acompte de ${valid ? pctNum : '…'} %`}</button>}
        </div>
      </form>
    </div>
  );
}
