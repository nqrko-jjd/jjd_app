'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';

interface Fine {
  id: string; date: string | null; time: string | null; reference: string | null;
  payTo: string | null; type: string | null; amount: number | null; status: string | null;
  plateRaw: string | null;
  vehicle: { id: string; brand: string | null; model: string | null } | null;
}

export default function PvPage() {
  const [unpaid, setUnpaid] = useState(true);
  const { data, loading } = useApi<{ items: Fine[] }>(`/api/vehicles/fines${unpaid ? '?unpaid=1' : ''}`);
  const total = (data?.items ?? []).reduce((s, f) => s + (f.amount ?? 0), 0);

  return (
    <>
      <PageHead
        title="PV / amendes"
        sub={data ? `${data.items.length} · ${total.toLocaleString('fr-BE')} €` : undefined}
        action={<Link href="/app/flotte" className="btn">← Flotte</Link>}
      />
      <div className="row" style={{ marginBottom: '1rem' }}>
        <label className="row" style={{ gap: '0.4rem' }}>
          <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />
          Impayés uniquement
        </label>
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Véhicule</th><th>Type</th><th>À payer à</th><th>Réf</th><th style={{ textAlign: 'right' }}>Montant</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {data.items.map((f) => (
                <tr key={f.id}>
                  <td className="tnum">{formatDateBE(f.date)}{f.time ? ` ${f.time}` : ''}</td>
                  <td>{f.vehicle ? <Link href={`/app/flotte/${f.vehicle.id}`}>{[f.vehicle.brand, f.vehicle.model].filter(Boolean).join(' ')}</Link> : (f.plateRaw ?? '—')}</td>
                  <td>{f.type ?? '—'}</td>
                  <td>{f.payTo ?? '—'}</td>
                  <td className="mono" style={{ fontSize: '0.78rem' }}>{f.reference ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}><Money value={f.amount} /></td>
                  <td>{f.status === 'Payé' ? <span className="badge ok">Payé</span> : <span className="badge crit">Impayé</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
