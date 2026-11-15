'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { Money } from '@/lib/ui';
import { WorksitePicker, type WsPickerOption } from '@/components/WorksitePicker';
import { WORKSITE_STATUS_OPEN } from '@jjd/shared';

interface FleetHit { kind: 'financing' | 'insurance' | 'fine'; vehicleId: string | null; fineId: string | null; worksiteId: string | null; supplierName: string; label: string }
interface WsRef { id: string; ref: string; title: string; city?: string | null }

/**
 * Sortie bancaire SANS facture (mensualité de crédit, domiciliation, frais bancaires, parking…) : crée la dépense
 * directement depuis la ligne du relevé, rangée sous un poste de frais (E-xx) ou un chantier, et la rapproche.
 * En option, une règle fait la même chose pour les prochains prélèvements identiques.
 */
export function BankExpenseCreate({ txId, onDone }: { txId: string; onDone: (message: string) => void }) {
  const { data: draft } = useApi<{ supplierName: string; pattern: string; remaining: number; fleet: FleetHit | null }>(`/api/finance/bank/${txId}/expense-draft`);
  const { data: overhead } = useApi<{ items: WsRef[] }>('/api/worksites?kind=overhead');
  const { data: projects } = useApi<{ items: WsRef[] }>(`/api/worksites?status=${WORKSITE_STATUS_OPEN.join(',')}`);
  const [worksiteId, setWorksiteId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [withRule, setWithRule] = useState(true);
  const [pattern, setPattern] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!draft) return;
    setSupplierName(draft.supplierName);
    setPattern(draft.pattern);
    // reconnu via la flotte : poste pré-choisi, et pas besoin de règle (la fiche véhicule suffit pour les mois suivants)
    if (draft.fleet) { if (draft.fleet.worksiteId) setWorksiteId(draft.fleet.worksiteId); setNotes(draft.fleet.label); setWithRule(false); }
  }, [draft]);

  // postes de frais d'abord (cas le plus courant pour un crédit ou une domiciliation), puis les chantiers
  const options = useMemo((): WsPickerOption[] => [
    ...(overhead?.items ?? []).filter((w) => w.ref !== 'E-RDV').map((w) => ({ id: w.id, ref: w.ref, title: `${w.title} (poste de frais)`, city: null })),
    ...(projects?.items ?? []).map((w) => ({ id: w.id, ref: w.ref, title: w.title, city: w.city ?? null })),
  ], [overhead, projects]);

  async function submit() {
    if (!worksiteId) { setError('Choisissez le poste ou le chantier.'); return; }
    if (!supplierName.trim()) { setError('Indiquez le fournisseur (banque, assureur…).'); return; }
    if (withRule && pattern.trim().length < 3) { setError('Le texte de la règle doit faire au moins 3 caractères.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api<{ ruleApplied: number }>(`/api/finance/bank/${txId}/expense`, {
        method: 'POST',
        body: { worksiteId, supplierName: supplierName.trim(), notes: notes.trim() || null, rulePattern: withRule ? pattern.trim() : null, vehicleId: draft?.fleet?.vehicleId ?? null, fineId: draft?.fleet?.fineId ?? null },
      });
      onDone(
        'Dépense créée et rapprochée.'
        + (withRule ? ` Règle enregistrée${r.ruleApplied ? ` : ${r.ruleApplied} autre(s) prélèvement(s) identique(s) classé(s) aussi.` : ' pour les prochains prélèvements identiques.'}` : ''),
      );
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (draft && draft.remaining <= 0) return null;
  return (
    <div className="grid" style={{ gap: '0.7rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Pour un paiement qui n’a pas de facture (mensualité de crédit, domiciliation, frais bancaires, parking…) : la dépense est créée
        à partir de cette ligne{draft ? <> pour <strong><Money value={draft.remaining} /></strong></> : null}, le relevé faisant office de justificatif.
      </p>
      {draft?.fleet && (
        <div className="badge ok" style={{ whiteSpace: 'normal', padding: '0.45rem 0.6rem', justifySelf: 'start' }}>
          Reconnu grâce à la flotte : {draft.fleet.label}{draft.fleet.fineId ? ' — le PV passera « Payé »' : ''}
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.7rem' }}>
        <div className="field">
          <label htmlFor="bank-exp-ws">Poste ou chantier</label>
          <WorksitePicker value={worksiteId} onChange={setWorksiteId} options={options} placeholder="ex. E-12 Crédit Auto, E-15 Assurances auto…" />
        </div>
        <div className="field">
          <label htmlFor="bank-exp-supplier">Fournisseur</label>
          <input id="bank-exp-supplier" className="input" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Belfius, AXA, Interparking…" />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="bank-exp-notes">Note (facultatif)</label>
          <input id="bank-exp-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex. Crédit Transit, mensualité" />
        </div>
      </div>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={withRule} onChange={(e) => setWithRule(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          Faire pareil automatiquement pour les prochains prélèvements qui contiennent
          {withRule && <input className="input" style={{ display: 'block', marginTop: '0.35rem', maxWidth: 360 }} value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Texte reconnu par la règle" />}
          <span className="muted" style={{ display: 'block', fontSize: '0.78rem', marginTop: '0.2rem' }}>
            Un n° de crédit ou de contrat, un IBAN ou le nom de la contrepartie : ce qui revient tel quel chaque mois.
          </span>
        </span>
      </label>
      {error && <p role="alert" className="badge crit" style={{ margin: 0 }}>{error}</p>}
      <div><button type="button" className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Création…' : 'Créer la dépense et rapprocher'}</button></div>
    </div>
  );
}
