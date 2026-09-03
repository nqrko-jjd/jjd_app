'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead, Money, formatDateBE, Thumb } from '@/lib/ui';

interface Vehicle {
  id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
  type: string | null; fuel: string | null; status: string; driver: string | null; photoThumbUrl: string | null;
  nextInspection: string | null; monthlyPayment: number | null; acquisitionMode: string | null;
  insurances: { provider: string | null; monthlyAmount: number | null; annualAmount: number | null }[];
  _count: { fines: number; payments: number };
}

export default function FlottePage() {
  const { data, loading } = useApi<{ items: Vehicle[] }>('/api/vehicles');
  const soon = Date.now() + 30 * 86400000;

  return (
    <>
      <PageHead
        title="Flotte"
        sub={data ? `${data.items.filter((v) => v.status === 'active').length} véhicules actifs` : undefined}
        action={<Link href="/app/flotte/pv" className="btn">PV / amendes →</Link>}
      />
      {loading && <div className="empty">Chargement…</div>}
      {data && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Véhicule</th><th>Plaque</th><th>Type</th><th>Conducteur</th>
                <th>Assurance</th><th style={{ textAlign: 'right' }}>Mensualité</th><th>Contrôle technique</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => {
                const ins = v.insurances[0];
                const ct = v.nextInspection ? new Date(v.nextInspection).getTime() : null;
                return (
                  <tr key={v.id} style={v.status === 'active' ? undefined : { opacity: 0.5 }}>
                    <td>
                      <Thumb src={v.photoThumbUrl} />
                      <Link href={`/app/flotte/${v.id}`}>{[v.brand, v.model].filter(Boolean).join(' ')}</Link>
                      {v.code && <span className="muted mono" style={{ fontSize: '0.75rem' }}> · {v.code}</span>}
                    </td>
                    <td className="mono">{v.plate ?? '—'}</td>
                    <td>{v.type ?? '—'}</td>
                    <td>{v.driver ?? '—'}</td>
                    <td>{ins?.provider ?? '—'} {ins?.monthlyAmount ? <span className="muted">· <Money value={ins.monthlyAmount} />/m</span> : null}</td>
                    <td style={{ textAlign: 'right' }}>{v.monthlyPayment ? <Money value={v.monthlyPayment} /> : '—'}</td>
                    <td className="tnum">
                      {v.nextInspection
                        ? <span className={ct && ct < soon ? 'badge crit' : ''}>{formatDateBE(v.nextInspection)}</span>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
