'use client';
import Link from 'next/link';
import { DEPOSIT_TRIGGERS } from '@jjd/shared';
import { formatEur } from '@/lib/ui';

export interface PlanItem { id?: string; kind: 'pct' | 'amount'; value: number; trigger: keyof typeof DEPOSIT_TRIGGERS; label?: string | null; invoiceId?: string | null }
export interface PlanStatus { id: string; amountHt: number; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null }

/**
 * Acomptes prévus sur le devis : une ligne par acompte (pourcentage du devis ou montant HT) avec son déclencheur
 * (à la signature, au début des travaux…). Chaque ligne se facture ensuite en un clic depuis « Facturer » ;
 * une ligne déjà facturée est verrouillée.
 */
export function DepositPlanEditor({ plan, status, totalHt, vatRatio, onChange, disabled }: {
  plan: PlanItem[]; status: PlanStatus[]; totalHt: number; vatRatio: number; onChange: (p: PlanItem[]) => void; disabled?: boolean;
}) {
  const pctSum = plan.filter((p) => p.kind === 'pct').reduce((t, p) => t + (p.value || 0), 0);
  const set = (i: number, patch: Partial<PlanItem>) => onChange(plan.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const st = (p: PlanItem) => status.find((s) => s.id === p.id);
  return (
    <div className="doc-card" style={{ marginTop: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span className="eyebrow" style={{ margin: 0 }}>Acomptes prévus</span>
        {!disabled && plan.length < 8 && <button type="button" className="btn ghost" onClick={() => onChange([...plan, { kind: 'pct', value: plan.length ? 20 : 30, trigger: plan.length ? 'start' : 'signature' }])}>+ Ajouter un acompte</button>}
      </div>
      {plan.length === 0 && <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>Aucun acompte prévu. Ajoutez par exemple « 30 % à la signature » et « 40 % au début des travaux » : chaque ligne se facture ensuite en un clic, et figure sur le devis envoyé au client.</p>}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {plan.map((p, i) => {
          const s = st(p);
          const locked = !!s?.invoiceId;
          const ht = p.kind === 'pct' ? (totalHt * (p.value || 0)) / 100 : p.value || 0;
          return (
            <div key={p.id ?? i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input aria-label={`Valeur de l’acompte ${i + 1}`} className="input" type="number" step="any" min="0" style={{ width: 90, textAlign: 'right' }} value={p.value} disabled={disabled || locked} onChange={(e) => set(i, { value: Number(e.target.value) })} />
              <select aria-label="Unité" className="select" style={{ width: 80 }} value={p.kind} disabled={disabled || locked} onChange={(e) => set(i, { kind: e.target.value as PlanItem['kind'] })}>
                <option value="pct">%</option><option value="amount">€ HT</option>
              </select>
              <select aria-label="Déclencheur" className="select" style={{ minWidth: 190 }} value={p.trigger} disabled={disabled || locked} onChange={(e) => set(i, { trigger: e.target.value as PlanItem['trigger'] })}>
                {Object.entries(DEPOSIT_TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {p.trigger === 'custom' && <input aria-label="Libellé" className="input" style={{ minWidth: 160 }} placeholder="ex. à la livraison du carrelage" value={p.label ?? ''} disabled={disabled || locked} onChange={(e) => set(i, { label: e.target.value })} />}
              <span className="muted" style={{ fontSize: '0.84rem' }}>{formatEur(ht * vatRatio)} TTC</span>
              {locked
                ? <Link className="chip" href={`/app/documents/${s!.invoiceId}`}>Facturé · {s!.invoiceNumber} →</Link>
                : !disabled && <button type="button" className="btn ghost" aria-label="Retirer cet acompte" onClick={() => onChange(plan.filter((_, j) => j !== i))}>✕</button>}
            </div>
          );
        })}
      </div>
      {pctSum > 100.0001 && <div className="badge crit" style={{ marginTop: '0.5rem', padding: '0.3rem 0.6rem' }}>Les acomptes dépassent 100 % du devis.</div>}
    </div>
  );
}
