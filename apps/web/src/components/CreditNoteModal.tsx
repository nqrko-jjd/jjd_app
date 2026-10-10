'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatEur } from '@/lib/ui';

/**
 * Note de crédit sur une facture : totale (ce qui reste à créditer) ou partielle (montant TTC au choix), avec un motif, en brouillon
 * ou émise tout de suite. L'API refuse tout montant supérieur au reste à créditer ; une facture intégralement créditée passe « créditée ».
 */
export function CreditNoteModal({ invoice, creditedTtc, onClose, onCreated }: {
  invoice: { id: string; number: string | null; totalTtc: number };
  creditedTtc: number;
  onClose: () => void;
  onCreated: (documentId: string) => void;
}) {
  const remaining = Math.round((Math.abs(invoice.totalTtc) - creditedTtc) * 100) / 100;
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [issue, setIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // « 10 000,50 » : espaces (y compris insécables) et virgule décimale acceptés
  const amountNum = Number(amount.replace(/[\s  ]/g, '').replace(',', '.'));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'partial' && !(amountNum > 0)) { setErr('Indiquez le montant TTC à créditer'); return; }
    if (mode === 'partial' && amountNum > remaining + 0.005) { setErr(`Il ne reste que ${formatEur(remaining)} à créditer`); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ document: { id: string } }>(`/api/documents/${invoice.id}/credit-note`, {
        method: 'POST',
        body: { ...(mode === 'partial' ? { amountTtc: amountNum } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}), issue },
      });
      onCreated(r.document.id);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
      <form className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Note de crédit sur la facture {invoice.number}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
              Facture de {formatEur(Math.abs(invoice.totalTtc))} TTC{creditedTtc > 0 ? <> · déjà créditée de {formatEur(creditedTtc)}</> : null} · <strong>reste à créditer : {formatEur(remaining)}</strong>
            </p>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 500 }}>
              <input type="radio" name="cn-mode" checked={mode === 'full'} onChange={() => setMode('full')} />
              Crédit total — {formatEur(remaining)} TTC {creditedTtc === 0 ? '(mêmes lignes que la facture)' : '(le reste)'}
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 500 }}>
              <input type="radio" name="cn-mode" checked={mode === 'partial'} onChange={() => setMode('partial')} />
              Crédit partiel
            </label>
          </div>
          {mode === 'partial' && (
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="cn-amount">Montant TTC à créditer (€)</label>
              <input id="cn-amount" className="input" inputMode="decimal" autoFocus placeholder="ex. 1 250,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cn-reason">Motif (facultatif)</label>
            <input id="cn-reason" className="input" placeholder="ex. travaux non réalisés, remise, erreur de facturation…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 500 }}>
              <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
              Émettre tout de suite (attribue le n° de note de crédit)
            </label>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Sinon la note reste en brouillon, à relire puis à émettre. Une facture entièrement créditée passe automatiquement « créditée ».
            </span>
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Création…' : issue ? 'Créer et émettre' : 'Créer la note de crédit'}</button>
        </div>
      </form>
    </div>
  );
}
