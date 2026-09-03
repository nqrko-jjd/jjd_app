'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money } from '@/lib/ui';
import { formatHours, WORKER_CONTRACT_LABEL } from '@jjd/shared';

interface Team {
  year: number; month: number; totalAmount: number;
  rows: { personId: string; name: string; contractType: string; hourlyRate: number | null; hours: number; amount: number; pending: number }[];
}
interface Detail {
  totalHours: number; totalAmount: number;
  byWorksite: { ref: string; title: string; hours: number; amount: number; days: number }[];
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function DecomptesPage() {
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const { data, loading } = useApi<Team>(`/api/statements?year=${y}&month=${m}`);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1);
    setY(d.getFullYear()); setM(d.getMonth() + 1);
    setOpen(null); setDetail({});
  }
  async function toggle(personId: string) {
    if (open === personId) { setOpen(null); return; }
    setOpen(personId);
    if (!detail[personId]) {
      const d = await api<Detail>(`/api/statements/${personId}?year=${y}&month=${m}`);
      setDetail((x) => ({ ...x, [personId]: d }));
    }
  }

  const rows = data?.rows ?? [];
  const totalHours = rows.reduce((a, r) => a + r.hours, 0);
  const pending = rows.reduce((a, r) => a + r.pending, 0);

  return (
    <>
      <PageHead
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
          <div className="kpi"><span className="ic">€</span><div className="label">Total à payer</div><div className="value"><Money value={data.totalAmount} /></div></div>
          <div className="kpi"><span className="ic">☺</span><div className="label">Personnes</div><div className="value">{rows.length}</div></div>
          <div className="kpi"><span className="ic">◷</span><div className="label">Heures</div><div className="value">{formatHours(totalHours)}</div></div>
          <div className={`kpi${pending ? ' warn' : ''}`}><span className="ic">!</span><div className="label">À valider</div><div className="value">{pending}</div></div>
        </div>
      )}

      {loading && <div className="empty">Chargement…</div>}
      {data && rows.length === 0 && <div className="card card-pad muted">Aucune heure pour ce mois.</div>}
      {data && rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th></th><th>Personne</th><th>Contrat</th><th style={{ textAlign: 'right' }}>Taux</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FragmentRow key={r.personId} r={r} open={open === r.personId} onToggle={() => toggle(r.personId)} detail={detail[r.personId]} />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4}>Total</td>
                <td style={{ textAlign: 'right' }}>{formatHours(totalHours)}</td>
                <td style={{ textAlign: 'right' }}><Money value={data.totalAmount} /></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function FragmentRow({
  r, open, onToggle, detail,
}: {
  r: Team['rows'][number]; open: boolean; onToggle: () => void; detail?: Detail;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ width: 24, color: 'var(--ink-3)' }}>{open ? '▾' : '▸'}</td>
        <td><Link href={`/app/equipe/${r.personId}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link></td>
        <td>{WORKER_CONTRACT_LABEL[r.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? r.contractType}</td>
        <td style={{ textAlign: 'right' }}>{r.hourlyRate != null ? <Money value={r.hourlyRate} /> : '—'}</td>
        <td style={{ textAlign: 'right' }} className="tnum">{formatHours(r.hours)}</td>
        <td style={{ textAlign: 'right' }}><Money value={r.amount} /></td>
        <td>{r.pending > 0 && <span className="badge warn">{r.pending} à valider</span>}</td>
      </tr>
      {open && detail && detail.byWorksite.map((w) => (
        <tr key={w.ref} style={{ background: 'var(--surface-2)' }}>
          <td></td>
          <td colSpan={2} style={{ fontSize: '0.85rem' }}><span className="mono">{w.ref}</span> {w.title}</td>
          <td className="muted" style={{ textAlign: 'right', fontSize: '0.82rem' }}>{w.days} j</td>
          <td style={{ textAlign: 'right', fontSize: '0.85rem' }} className="tnum">{formatHours(w.hours)}</td>
          <td style={{ textAlign: 'right', fontSize: '0.85rem' }}><Money value={w.amount} /></td>
          <td></td>
        </tr>
      ))}
    </>
  );
}
