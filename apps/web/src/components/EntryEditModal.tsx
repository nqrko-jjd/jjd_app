'use client';
import { tr } from '@/lib/ui-language';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { ComboBox } from '@/components/ComboBox';

export interface EditableEntry { id: string; date: string | null; worksiteId: string | null; hours: number | null; amount: number | null; task: string | null }

/** Corriger un pointage (date, chantier, heures, montant, tâche) — utilisé depuis la file de validation et depuis les décomptes. */
export function EntryEditModal({ entry, onClose, onDone }: { entry: EditableEntry; onClose: () => void; onDone: () => void }) {
  const { data: meta } = useApi<{ worksites: { id: string; name: string }[] }>('/api/meta/pickers');
  const [date, setDate] = useState(entry.date ? entry.date.slice(0, 10) : '');
  const [worksiteId, setWorksiteId] = useState(entry.worksiteId ?? '');
  const [hours, setHours] = useState(entry.hours != null ? String(entry.hours) : '');
  const [amount, setAmount] = useState(entry.amount != null ? String(entry.amount) : '');
  const [task, setTask] = useState(entry.task ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/timesheet/entries/${entry.id}`, {
        method: 'PATCH',
        body: {
          date: date || undefined,
          worksiteId: worksiteId || null,
          hours: hours ? Number(hours) : null,
          amount: amount ? Number(amount) : null,
          task: task.trim() || null,
        },
      });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2>Modifier le pointage</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div className="wiz-body">
          {err && <div className="plan-form-error">{err}</div>}
          <div className="wiz-grid">
            <div className="field">
              <label>{tr("Date")}</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>{tr("Heures")}</label>
              <input className="input" type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
          </div>
          <div className="field full" style={{ marginTop: '0.7rem' }}>
            <label>{tr("Chantier")}</label>
            <ComboBox placeholder="— (frais général)" value={worksiteId} onChange={setWorksiteId} options={meta?.worksites.map((w) => ({ value: w.id, label: w.name })) ?? []} />
          </div>
          <div className="field" style={{ marginTop: '0.7rem' }}>
            <label>Montant</label>
            <input className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field full" style={{ marginTop: '0.7rem' }}>
            <label>Tâche</label>
            <input className="input" value={task} onChange={(e) => setTask(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? tr("Enregistrement…") : tr("Enregistrer")}</button>
        </div>
      </form>
    </div>
  );
}
