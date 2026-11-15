'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState } from '@/components/States';
import { WorksitePicker, type WsPickerOption } from '@/components/WorksitePicker';
import { ContactPicker } from '@/components/ContactPicker';
import { WORKSITE_STATUS_OPEN } from '@jjd/shared';

interface Rule { id: string; pattern: string; worksiteId: string; supplierName: string; contactId?: string | null; notes: string | null; worksite: { ref: string; title: string } | null }
interface DirectDebit {
  key: string; mandate: string | null; creditor: string | null; banks: string[]; count: number; unmatched: number;
  byInvoice: number; byRuleOrFleet: number; lastDate: string | null; lastAmount: number | null; total12m: number;
  lastPost: string | null; firstUnmatchedId: string | null; rule: Rule | null;
}
interface WsRef { id: string; ref: string; title: string; city?: string | null }

/**
 * Domiciliations : un créancier (mandat) par ligne. Celles qui envoient une facture se rapprochent seules ; pour
 * les autres (crédit, assurance, abonnement…), on choisit une fois le poste et le fournisseur, et toutes les
 * lignes passées et futures de ce mandat sont classées.
 */
export default function DomiciliationsPage() {
  const { data, loading, error, reload } = useApi<{ items: DirectDebit[]; months: number }>('/api/finance/bank/direct-debits');
  const { data: overhead } = useApi<{ items: WsRef[] }>('/api/worksites?kind=overhead');
  const { data: projects } = useApi<{ items: WsRef[] }>(`/api/worksites?status=${WORKSITE_STATUS_OPEN.join(',')}`);
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const [edit, setEdit] = useState<DirectDebit | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const options = useMemo((): WsPickerOption[] => [
    ...(overhead?.items ?? []).filter((w) => w.ref !== 'E-RDV').map((w) => ({ id: w.id, ref: w.ref, title: `${w.title} (poste de frais)`, city: null })),
    ...(projects?.items ?? []).map((w) => ({ id: w.id, ref: w.ref, title: w.title, city: w.city ?? null })),
  ], [overhead, projects]);

  const items = (data?.items ?? []).filter((d) => filter === 'all' || (d.unmatched > 0 && !d.rule));
  const todo = (data?.items ?? []).filter((d) => d.unmatched > 0 && !d.rule).length;

  async function removeRule(r: Rule) {
    if (!window.confirm(`Supprimer la règle « ${r.pattern} » ? Les dépenses déjà créées restent ; seuls les prochains prélèvements ne seront plus classés.`)) return;
    await api(`/api/finance/bank-expense-rules/${r.id}`, { method: 'DELETE' });
    setFlash('Règle supprimée.');
    reload();
  }

  return (
    <>
      <PageHead
        title="Domiciliations"
        sub={data ? `${data.items.length} créancier(s) sur ${data.months} mois · ${todo} à classer` : undefined}
        action={<Link href="/app/finances/banque" className="btn">← Rapprochement bancaire</Link>}
      />
      <div className="card card-pad" style={{ marginBottom: '1rem', fontSize: '0.86rem' }}>
        Les domiciliations qui envoient une <strong>facture</strong> (Proximus, leasing…) se rapprochent toutes seules de celle-ci.
        Pour celles <strong>sans facture</strong> (crédit, assurance, abonnement…), choisissez une fois le poste et le fournisseur :
        tous les prélèvements de ce mandat, passés et à venir, deviennent une dépense classée.
        {flash && <div style={{ marginTop: '0.5rem', fontWeight: 600 }}>{flash}</div>}
      </div>
      <div className="row" style={{ marginBottom: '0.8rem', gap: '0.5rem' }}>
        <select className="select" style={{ maxWidth: 260 }} value={filter} onChange={(e) => setFilter(e.target.value as 'todo' | 'all')}>
          <option value="todo">À classer ({todo})</option>
          <option value="all">Toutes les domiciliations</option>
        </select>
      </div>

      {loading && <SkeletonRows />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Créancier</th>
                <th>Mandat</th>
                <th>Compte</th>
                <th style={{ textAlign: 'right' }}>Dernier prélèvement</th>
                <th style={{ textAlign: 'right' }}>12 derniers mois</th>
                <th>Rapprochement</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ padding: '1rem' }}>{filter === 'todo' ? 'Rien à classer : toutes les domiciliations ont une facture ou une règle.' : 'Aucune domiciliation trouvée.'}</td></tr>
              )}
              {items.map((d) => (
                <tr key={d.key}>
                  <td><strong>{d.creditor ?? '—'}</strong></td>
                  <td className="muted" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{d.mandate ?? '—'}</td>
                  <td className="muted" style={{ fontSize: '0.8rem' }}>{d.banks.join(', ')}</td>
                  <td style={{ textAlign: 'right' }}><Money value={d.lastAmount} sign /><div className="muted" style={{ fontSize: '0.76rem' }}>{formatDateBE(d.lastDate)}</div></td>
                  <td style={{ textAlign: 'right' }}><Money value={d.total12m} sign /><div className="muted" style={{ fontSize: '0.76rem' }}>{d.count} prélèvement(s)</div></td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {d.rule ? (
                      <span className="badge ok" style={{ whiteSpace: 'normal' }}>Règle : {d.rule.worksite?.ref ?? '?'} · {d.rule.supplierName}</span>
                    ) : d.unmatched === 0 ? (
                      <span className="badge plain">{d.byInvoice ? 'Par facture' : d.lastPost ? `Classé (${d.lastPost})` : 'Rapproché'}</span>
                    ) : (
                      <span className="badge warn">{d.unmatched} à rapprocher</span>
                    )}
                    {d.rule && d.unmatched > 0 && <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>{d.unmatched} encore à rapprocher</div>}
                    {!d.rule && d.unmatched > 0 && d.byInvoice > 0 && <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>{d.byInvoice} déjà par facture : facture peut-être pas encore reçue</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {d.mandate || d.creditor ? (
                      <button className="btn" style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem' }} onClick={() => setEdit(d)}>{d.rule ? 'Modifier' : 'Classer'}</button>
                    ) : null}
                    {d.rule && <button className="btn ghost" style={{ padding: '0.2rem 0.45rem', fontSize: '0.78rem' }} title="Supprimer la règle" onClick={() => removeRule(d.rule!)}>✕</button>}
                    {d.firstUnmatchedId && <Link className="btn ghost" style={{ padding: '0.2rem 0.45rem', fontSize: '0.78rem' }} href={`/app/finances/banque?q=${encodeURIComponent(d.mandate ?? d.creditor ?? '')}`}>Voir</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <ClassifyModal
          dd={edit}
          options={options}
          onClose={() => setEdit(null)}
          onDone={(applied) => {
            setEdit(null);
            setFlash(`Règle enregistrée${applied ? ` : ${applied} prélèvement(s) classé(s)` : ''}.`);
            reload();
          }}
        />
      )}
    </>
  );
}

function ClassifyModal({ dd, options, onClose, onDone }: { dd: DirectDebit; options: WsPickerOption[]; onClose: () => void; onDone: (applied: number) => void }) {
  const { data: guess } = useApi<{ supplier: { id: string; name: string } | null }>(dd.firstUnmatchedId ? `/api/finance/bank/${dd.firstUnmatchedId}/expense-draft` : null);
  const [worksiteId, setWorksiteId] = useState(dd.rule?.worksiteId ?? '');
  const [contactId, setContactId] = useState(dd.rule?.contactId ?? '');
  const [supplierName, setSupplierName] = useState(dd.rule?.supplierName ?? '');
  const [pattern, setPattern] = useState(dd.rule?.pattern ?? dd.mandate ?? dd.creditor ?? '');
  const [notes, setNotes] = useState(dd.rule?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const contact = contactId || guess?.supplier?.id || '';

  async function save() {
    if (!worksiteId) { setErr('Choisissez le poste ou le chantier.'); return; }
    if (!contact) { setErr('Choisissez le fournisseur dans la liste, ou créez-le.'); return; }
    if (pattern.trim().length < 3) { setErr('Le texte reconnu doit faire au moins 3 caractères.'); return; }
    setBusy(true); setErr('');
    try {
      if (dd.rule && dd.rule.pattern.trim().toLowerCase() !== pattern.trim().toLowerCase()) {
        await api(`/api/finance/bank-expense-rules/${dd.rule.id}`, { method: 'DELETE' });
      }
      const r = await api<{ applied: number }>('/api/finance/bank-expense-rules', {
        method: 'POST',
        body: { pattern: pattern.trim(), worksiteId, contactId: contact, supplierName: supplierName || guess?.supplier?.name || dd.creditor || 'Fournisseur', notes: notes.trim() || null },
      });
      onDone(r.applied);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="modal-scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dd-title" style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div className="modal-heading"><span className="modal-eyebrow">Domiciliation</span><h2 id="dd-title">{dd.creditor ?? dd.mandate}</h2></div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div style={{ padding: '1rem 1.15rem', display: 'grid', gap: '0.8rem' }}>
          <div className="muted" style={{ fontSize: '0.84rem' }}>
            {dd.count} prélèvement(s), dernier : <Money value={dd.lastAmount} /> le {formatDateBE(dd.lastDate)}{dd.unmatched ? ` · ${dd.unmatched} à rapprocher` : ''}
          </div>
          <div className="field">
            <label>Poste ou chantier</label>
            <WorksitePicker value={worksiteId} onChange={setWorksiteId} options={options} placeholder="ex. E-09 Assurance Dépôt, E-16 Charges auto…" />
          </div>
          <div className="field">
            <label>Fournisseur</label>
            <ContactPicker browse typeFilter="supplier" value={contact} onChange={(id, label) => { setContactId(id); setSupplierName(label); }} placeholder="Chercher ou créer le fournisseur…" />
          </div>
          <div className="field">
            <label>Texte reconnu sur le relevé</label>
            <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} />
            <span className="muted" style={{ fontSize: '0.76rem' }}>Le n° de mandat ne change pas d’un mois à l’autre : c’est le plus sûr.</span>
          </div>
          <div className="field">
            <label>Note (facultatif)</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex. Assurance incendie dépôt" />
          </div>
          {err && <p role="alert" className="badge crit" style={{ margin: 0 }}>{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer et classer'}</button>
        </div>
      </div>
    </div>
  );
}
