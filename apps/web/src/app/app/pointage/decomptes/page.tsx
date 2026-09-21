'use client';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, Kpi, formatEur, formatDateBE, Avatar } from '@/lib/ui';
import { ComboBox } from '@/components/ComboBox';
import { formatHours, WORKER_CONTRACT_LABEL } from '@jjd/shared';
import { Wallet, Users, Clock, AlertTriangle } from 'lucide-react';

interface Team {
  year: number; month: number; totalAmount: number; totalNetAmount: number;
  rows: { personId: string; name: string; photoThumbUrl: string | null; contractType: string; hourlyRate: number | null; hours: number; days: number; amount: number; toWithhold: number; netAmount: number; pending: number }[];
}
interface DetailEntry {
  id: string; date: string | null; worksiteId: string | null; worksiteRef: string | null; worksiteTitle: string | null;
  hours: number | null; amount: number | null; task: string | null; status: string;
}
interface Detail {
  totalHours: number; totalAmount: number;
  byWorksite: { ref: string; title: string; hours: number; amount: number; days: number }[];
  entries: DetailEntry[];
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function DecomptesPage() {
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const { data, loading, error, reload } = useApi<Team>(`/api/statements?year=${y}&month=${m}`);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});
  const [editing, setEditing] = useState<{ personId: string; entry: DetailEntry } | null>(null);

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1);
    setY(d.getFullYear()); setM(d.getMonth() + 1);
    setOpen(null); setDetail({});
  }
  async function loadDetail(personId: string) {
    const d = await api<Detail>(`/api/statements/${personId}?year=${y}&month=${m}`);
    setDetail((x) => ({ ...x, [personId]: d }));
  }
  async function toggle(personId: string) {
    if (open === personId) { setOpen(null); return; }
    setOpen(personId);
    if (!detail[personId]) await loadDetail(personId);
  }
  async function refreshAfterChange(personId: string) {
    await Promise.all([loadDetail(personId), reload()]);
  }
  async function deleteEntry(personId: string, entryId: string) {
    if (!confirm('Supprimer ce pointage ? Cette action est irréversible.')) return;
    await api(`/api/timesheet/entries/${entryId}`, { method: 'DELETE' });
    await refreshAfterChange(personId);
  }

  const rows = data?.rows ?? [];
  const totalHours = rows.reduce((a, r) => a + r.hours, 0);
  const totalDays = rows.reduce((a, r) => a + r.days, 0);
  const pending = rows.reduce((a, r) => a + r.pending, 0);
  const hasWithholding = rows.some((r) => r.toWithhold > 0);

  return (
    <>
      {editing && (
        <EditEntryModal
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onDone={async () => { const p = editing.personId; setEditing(null); await refreshAfterChange(p); }}
        />
      )}
      <PageHead
        eyebrow="Suivi du temps"
        title="Décomptes du mois"
        sub="Heures validées par personne — base des paiements"
        action={<Link href="/app/pointage" className="btn">← Validation</Link>}
      />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="btn" onClick={() => shift(-1)}>←</button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{MONTHS[m - 1]} {y}</strong>
        <button className="btn" onClick={() => shift(1)}>→</button>
      </div>

      {data && rows.length > 0 && (
        <div className="kpis" style={{ marginBottom: '1.4rem' }}>
          <Kpi
            ic={Wallet}
            label="Total net à payer"
            value={<Money value={data.totalNetAmount} />}
            sub={hasWithholding ? `dont ${formatEur(data.totalAmount - data.totalNetAmount)} de retenues` : 'Aucune retenue'}
            hero
          />
          <Kpi ic={Users} label="Personnes" value={rows.length} sub="Ont pointé ce mois-ci" />
          <Kpi ic={Clock} label="Heures" value={formatHours(totalHours)} sub={`${formatHours(totalHours / rows.length)} / personne`} />
          <Kpi ic={AlertTriangle} label="À valider" value={pending} sub={pending > 0 ? 'Pointages en attente' : 'Tout est validé'} warn={pending > 0} />
        </div>
      )}

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && rows.length === 0 && <EmptyState
          icon={Clock}
          title="Aucune heure ce mois-ci"
          text="Aucun pointage validé ou en attente sur ce mois. Changez de mois avec les flèches ou saisissez des heures depuis la page Pointage."
          action={<Link href="/app/pointage" className="btn primary">Aller au pointage</Link>}
          secondary={<button className="btn" onClick={() => shift(-1)}>← Mois précédent</button>}
        />}
      {data && rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th></th><th>Personne</th><th>Contrat</th><th style={{ textAlign: 'right' }}>Taux</th>
                <th style={{ textAlign: 'right' }}>Jours</th>
                <th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th>
                {hasWithholding && <th style={{ textAlign: 'right' }}>À retenir</th>}
                {hasWithholding && <th style={{ textAlign: 'right' }}>Net</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FragmentRow
                  key={r.personId}
                  r={r}
                  open={open === r.personId}
                  onToggle={() => toggle(r.personId)}
                  detail={detail[r.personId]}
                  showWithholding={hasWithholding}
                  onEdit={(entry) => setEditing({ personId: r.personId, entry })}
                  onDelete={(entryId) => deleteEntry(r.personId, entryId)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4}>Total</td>
                <td style={{ textAlign: 'right' }}>{totalDays} j</td>
                <td style={{ textAlign: 'right' }}>{formatHours(totalHours)}</td>
                <td style={{ textAlign: 'right' }}><Money value={data.totalAmount} /></td>
                {hasWithholding && <td style={{ textAlign: 'right' }}><Money value={data.totalAmount - data.totalNetAmount} /></td>}
                {hasWithholding && <td style={{ textAlign: 'right' }}><Money value={data.totalNetAmount} /></td>}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

const miniBtn: React.CSSProperties = { padding: '0.15rem 0.4rem', fontSize: '0.78rem', lineHeight: 1 };

function FragmentRow({
  r, open, onToggle, detail, showWithholding, onEdit, onDelete,
}: {
  r: Team['rows'][number]; open: boolean; onToggle: () => void; detail?: Detail; showWithholding: boolean;
  onEdit: (entry: DetailEntry) => void; onDelete: (entryId: string) => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ width: 24, color: 'var(--ink-3)' }}>{open ? '▾' : '▸'}</td>
        <td><Avatar src={r.photoThumbUrl} label={r.name} /><Link href={`/app/equipe/${r.personId}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link></td>
        <td>{WORKER_CONTRACT_LABEL[r.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? r.contractType}</td>
        <td style={{ textAlign: 'right' }}>{r.hourlyRate != null ? <Money value={r.hourlyRate} /> : '—'}</td>
        <td style={{ textAlign: 'right' }} className="tnum">{r.days} j</td>
        <td style={{ textAlign: 'right' }} className="tnum">{formatHours(r.hours)}</td>
        <td style={{ textAlign: 'right' }}><Money value={r.amount} /></td>
        {showWithholding && <td style={{ textAlign: 'right' }}>{r.toWithhold > 0 ? <Money value={r.toWithhold} /> : '—'}</td>}
        {showWithholding && <td style={{ textAlign: 'right', fontWeight: r.toWithhold > 0 ? 700 : 400 }}><Money value={r.netAmount} /></td>}
        <td>{r.pending > 0 && <span className="badge warn">{r.pending} à valider</span>}</td>
      </tr>
      {open && detail && detail.entries.map((e) => (
        <tr key={e.id} style={{ background: 'var(--surface-2)' }}>
          <td></td>
          <td colSpan={2} style={{ fontSize: '0.85rem' }}>
            {e.worksiteRef ? <><span className="mono">{e.worksiteRef}</span> {e.worksiteTitle}</> : <span className="muted">Sans chantier</span>}
            {e.task && <span className="muted"> · {e.task}</span>}
          </td>
          <td className="muted" style={{ textAlign: 'right', fontSize: '0.82rem' }}>{formatDateBE(e.date)}</td>
          <td style={{ textAlign: 'right', fontSize: '0.85rem' }} className="tnum">{formatHours(e.hours)}</td>
          <td style={{ textAlign: 'right', fontSize: '0.85rem' }}><Money value={e.amount} /></td>
          {showWithholding && <td></td>}
          {showWithholding && <td></td>}
          <td onClick={(ev) => ev.stopPropagation()}>
            <div className="row" style={{ gap: '0.3rem', justifyContent: 'flex-end' }}>
              {e.status === 'submitted' && <span className="badge warn" style={{ fontSize: '0.7rem' }}>à valider</span>}
              <button className="btn ghost" style={miniBtn} onClick={() => onEdit(e)} title="Modifier ce pointage">✎</button>
              <button className="btn ghost" style={miniBtn} onClick={() => onDelete(e.id)} title="Supprimer ce pointage">✕</button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function EditEntryModal({ entry, onClose, onDone }: { entry: DetailEntry; onClose: () => void; onDone: () => void }) {
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
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2>Modifier le pointage</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="wiz-body">
          {err && <div className="plan-form-error">{err}</div>}
          <div className="wiz-grid">
            <div className="field">
              <label>Date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Heures</label>
              <input className="input" type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
          </div>
          <div className="field full" style={{ marginTop: '0.7rem' }}>
            <label>Chantier</label>
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
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}
