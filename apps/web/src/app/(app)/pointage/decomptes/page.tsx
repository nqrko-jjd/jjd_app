'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Money } from '@/lib/ui';
import { formatHours, WORKER_CONTRACT_LABEL } from '@jjd/shared';

interface Team {
  year: number; month: number; totalAmount: number;
  rows: { personId: string; name: string; contractType: string; hourlyRate: number | null; hours: number; amount: number; pending: number }[];
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function DecomptesPage() {
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth() + 1);
  const { data, loading } = useApi<Team>(`/api/statements?year=${y}&month=${m}`);

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1);
    setY(d.getFullYear());
    setM(d.getMonth() + 1);
  }

  return (
    <>
      <PageHead
        title="Décomptes du mois"
        sub="Heures validées par personne — base des paiements"
        action={<Link href="/pointage" className="btn">← Validation</Link>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="btn" onClick={() => shift(-1)}>←</button>
        <strong style={{ minWidth: 160, textAlign: 'center' }}>{MONTHS[m - 1]} {y}</strong>
        <button className="btn" onClick={() => shift(1)}>→</button>
        {data && <span className="muted" style={{ marginLeft: 'auto' }}>Total : <Money value={data.totalAmount} /></span>}
      </div>

      {loading && <div className="empty">Chargement…</div>}
      {data && data.rows.length === 0 && <div className="card card-pad muted">Aucune heure pour ce mois.</div>}
      {data && data.rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Personne</th><th>Contrat</th><th style={{ textAlign: 'right' }}>Taux</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.personId}>
                  <td><Link href={`/equipe/${r.personId}`}>{r.name}</Link></td>
                  <td>{WORKER_CONTRACT_LABEL[r.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? r.contractType}</td>
                  <td style={{ textAlign: 'right' }}>{r.hourlyRate != null ? <Money value={r.hourlyRate} /> : '—'}</td>
                  <td style={{ textAlign: 'right' }} className="tnum">{formatHours(r.hours)}</td>
                  <td style={{ textAlign: 'right' }}><Money value={r.amount} /></td>
                  <td>{r.pending > 0 && <span className="badge warn">{r.pending} à valider</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={4}>Total</td>
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
