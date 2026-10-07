'use client';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, Kpi, formatEur, formatDateBE, Avatar } from '@/lib/ui';
import { EntryEditModal } from '@/components/EntryEditModal';
import { formatHours, WORKER_CONTRACT_LABEL } from '@jjd/shared';
import { Wallet, Users, Clock, AlertTriangle } from 'lucide-react';

interface Team {
  year: number; month: number; totalAmount: number; totalPayoutAmount: number; totalNetAmount: number;
  rows: {
    personId: string; name: string; photoThumbUrl: string | null; contractType: string;
    actualHours: number; guaranteeHours: number; guaranteeAmount: number; hourlyRate: number | null; payoutPerDay: number | null; hours: number; days: number;
    amount: number; payoutAmount: number; toWithhold: number; netAmount: number; pending: number;
    plannedHours?: number; plannedDays?: number;
  }[];
}
interface DetailEntry {
  id: string; date: string | null; worksiteId: string | null; worksiteRef: string | null; worksiteTitle: string | null;
  hours: number | null; amount: number | null; task: string | null; status: string;
}
interface Detail {
  totalHours: number; totalAmount: number; actualHours: number; guaranteeHours: number; guaranteeAmount: number;
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
  const [actionError, setActionError] = useState('');

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1);
    setY(d.getFullYear()); setM(d.getMonth() + 1);
    setOpen(null); setDetail({});
  }
  async function loadDetail(personId: string) {
    setActionError('');
    try {
    const d = await api<Detail>(`/api/statements/${personId}?year=${y}&month=${m}`);
    setDetail((x) => ({ ...x, [personId]: d }));
    } catch(e){setOpen(null);setActionError(e instanceof Error?e.message:'Impossible de charger ce décompte.');}
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
    try {
    await api(`/api/timesheet/entries/${entryId}`, { method: 'DELETE' });
    await refreshAfterChange(personId);
    } catch(e){setActionError(e instanceof Error?e.message:'Suppression impossible.');}
  }

  const rows = data?.rows ?? [];
  const totalHours = rows.reduce((a, r) => a + r.hours, 0);
  const totalDays = rows.reduce((a, r) => a + r.days, 0);
  const pending = rows.reduce((a, r) => a + r.pending, 0);
  const plannedHours = rows.reduce((a, r) => a + (r.plannedHours ?? 0), 0);
  const hasWithholding = rows.some((r) => r.toWithhold > 0);
  const hasPayoutDiff = rows.some((r) => r.payoutPerDay != null);

  return (
    <>
      {editing && (
        <EntryEditModal
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onDone={async () => { const p = editing.personId; setEditing(null); await refreshAfterChange(p); }}
        />
      )}
      <PageHead
        eyebrow="Suivi du temps"
        title="Décomptes du mois"
        sub="Temps réellement pointé et base rémunérée, présentés séparément"
        action={(
          <>
            <Link href={`/imprimer/decomptes?year=${y}&month=${m}`} target="_blank" className="btn">Imprimer</Link>
            <Link href="/app/pointage" className="btn">← Validation</Link>
          </>
        )}
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
            sub={hasWithholding ? `dont ${formatEur(data.totalPayoutAmount - data.totalNetAmount)} de retenues` : 'Aucune retenue'}
            hero
          />
          <Kpi ic={Users} label="Personnes" value={rows.length} sub="Ont pointé ce mois-ci" />
          <Kpi ic={Clock} label="Heures rémunérées" value={formatHours(totalHours)} sub={`${formatHours(rows.reduce((sum,r)=>sum+(r.actualHours??r.hours),0))} réellement pointées et validées`} />
          <Kpi ic={AlertTriangle} label="À valider" value={pending} sub={pending > 0 ? 'Pointages en attente' : 'Tout est validé'} warn={pending > 0} />
          <Kpi ic={Clock} label="Prévu au planning" value={formatHours(plannedHours)} sub={plannedHours > 0 ? 'Pas encore validé : pas compté dans le payé' : 'Rien en attente de validation'} warn={plannedHours > 0} href="/app/pointage" />
        </div>
      )}

      <div className="card card-pad" style={{marginBottom:20}}><strong>Deux compteurs, une seule saisie</strong><p className="muted" style={{marginBottom:0}}>Les pointages gardent le temps réel sur chantier. La base rémunérée applique la garantie journalière de la fiche ouvrier (10 h par défaut), une seule fois par jour, tous chantiers confondus. Les pointages en attente sont exclus des sommes à payer. Les montants historiques importés sont conservés.</p></div>
      {loading && <SkeletonRows />}
      {actionError && <p className="state error" role="alert">{actionError}</p>}

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
                <th style={{ textAlign: 'right' }}>Pointées</th><th style={{ textAlign: 'right' }}>Rémunérées</th><th style={{ textAlign: 'right' }}>Montant</th>
                {hasPayoutDiff && <th style={{ textAlign: 'right' }}>À verser</th>}
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
                  showPayout={hasPayoutDiff}
                  onEdit={(entry) => setEditing({ personId: r.personId, entry })}
                  onDelete={(entryId) => deleteEntry(r.personId, entryId)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4}>Total</td>
                <td style={{ textAlign: 'right' }}>{totalDays} j</td>
                <td style={{ textAlign: 'right' }}>{formatHours(rows.reduce((sum,r)=>sum+(r.actualHours??r.hours),0))}</td>
                <td style={{ textAlign: 'right' }}>{formatHours(totalHours)}</td>
                <td style={{ textAlign: 'right' }}><Money value={data.totalAmount} /></td>
                {hasPayoutDiff && <td style={{ textAlign: 'right' }}><Money value={data.totalPayoutAmount} /></td>}
                {hasWithholding && <td style={{ textAlign: 'right' }}><Money value={data.totalPayoutAmount - data.totalNetAmount} /></td>}
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
  r, open, onToggle, detail, showWithholding, showPayout, onEdit, onDelete,
}: {
  r: Team['rows'][number]; open: boolean; onToggle: () => void; detail?: Detail; showWithholding: boolean; showPayout: boolean;
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
        <td style={{ textAlign: 'right' }} className="tnum">{formatHours(r.actualHours??r.hours)}</td>
        <td style={{ textAlign: 'right' }} className="tnum">{formatHours(r.hours)}</td>
        <td style={{ textAlign: 'right' }}><Money value={r.amount} /></td>
        {showPayout && <td style={{ textAlign: 'right' }}>{r.payoutPerDay != null ? <Money value={r.payoutAmount} /> : '—'}</td>}
        {showWithholding && <td style={{ textAlign: 'right' }}>{r.toWithhold > 0 ? <Money value={r.toWithhold} /> : '—'}</td>}
        {showWithholding && <td style={{ textAlign: 'right', fontWeight: r.toWithhold > 0 ? 700 : 400 }}><Money value={r.netAmount} /></td>}
        <td>
          {r.pending > 0 && <span className="badge warn">{r.pending} à valider</span>}
          {(r.plannedHours ?? 0) > 0 && <span className="badge" style={{ marginLeft: '0.3rem' }} title="Heures prévues au planning, pas encore validées dans Pointage">{formatHours(r.plannedHours ?? 0)} prévues</span>}
        </td>
      </tr>
      {open && detail && detail.guaranteeHours > 0 && <tr><td colSpan={9 + Number(showWithholding)*2 + Number(showPayout)} style={{background:'#f2f5ed',padding:16}}>Complément de garantie : <strong>{formatHours(detail.guaranteeHours)}</strong> · <Money value={detail.guaranteeAmount} />. Ce complément ne modifie pas les pointages et n’est pas encore réparti automatiquement entre les chantiers.</td></tr>}
      {open && detail && detail.entries.map((e) => (
        <tr key={e.id} style={{ background: 'var(--surface-2)' }}>
          <td></td>
          <td colSpan={2} style={{ fontSize: '0.85rem' }}>
            {e.worksiteRef ? <><span className="mono">{e.worksiteRef}</span> {e.worksiteTitle}</> : <span className="muted">Sans chantier</span>}
            {e.task && <span className="muted"> · {e.task}</span>}
          </td>
          <td className="muted" style={{ textAlign: 'right', fontSize: '0.82rem' }}>{formatDateBE(e.date)}</td>
          <td></td>
          <td style={{ textAlign: 'right', fontSize: '0.85rem' }} className="tnum">{formatHours(e.hours)}</td>
          <td></td>
          <td style={{ textAlign: 'right', fontSize: '0.85rem' }}><Money value={e.amount} /></td>
          {showPayout && <td></td>}
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
