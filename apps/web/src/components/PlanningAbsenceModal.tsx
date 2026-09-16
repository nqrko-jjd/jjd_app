'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ABSENCE_KINDS, ABSENCE_KIND_LABEL } from '@jjd/shared';
import type { PlanAbsence, PlanPerson } from './planningTypes';

// Heure locale — jamais toISOString() : décalerait la date d'un jour pour un fuseau en
// avance sur UTC (Belgique, UTC+1/+2).
function toDateInput(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayLocal() { return toDateInput(new Date().toISOString()); }

function personLabel(p: PlanPerson) { return p.displayName || p.firstName; }

export function PlanningAbsenceModal({
  people, existing, prefill, onClose, onSaved,
}: {
  people: PlanPerson[];
  existing?: PlanAbsence | null;
  prefill?: { personId?: string; date?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(() => ({
    personId: existing?.personId ?? prefill?.personId ?? '',
    kind: existing?.kind ?? 'leave',
    startsOn: existing ? toDateInput(existing.startsOn) : prefill?.date ?? todayLocal(),
    endsOn: existing ? toDateInput(existing.endsOn) : prefill?.date ?? todayLocal(),
    note: existing?.note ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!f.personId || !f.startsOn || !f.endsOn) { setError('Personne et période requises.'); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { personId: f.personId, kind: f.kind, startsOn: f.startsOn, endsOn: f.endsOn, note: f.note.trim() || null };
      if (existing) await api(`/api/absences/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/absences', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="modal-head"><h2>{existing ? 'Modifier l’absence' : 'Congé / formation'}</h2><button type="button" className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="plan-form-error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
          <div className="field full">
            <label>Personne</label>
            <select className="select" value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
              <option value="">—</option>
              {people.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Type</label>
            <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {ABSENCE_KINDS.map((k) => <option key={k} value={k}>{ABSENCE_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="field"><label>Du</label><input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></div>
          <div className="field"><label>Au</label><input className="input" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></div>
          <div className="field full"><label>Note (facultatif)</label><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        </div>
        <div className="modal-foot">
          {existing && (
            <button type="button" className="btn" style={{ color: 'var(--crit)', marginRight: 'auto' }} onClick={async () => {
              if (!confirm('Supprimer cette absence ?')) return;
              await api(`/api/absences/${existing.id}`, { method: 'DELETE' });
              onSaved();
            }}>Supprimer</button>
          )}
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={busy} type="submit">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}
