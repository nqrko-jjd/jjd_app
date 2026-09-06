'use client';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useSort, SortTh } from '@/lib/sort';
import { PageHead, Money, formatDateBE, Thumb, VehicleStatusBadge } from '@/lib/ui';
import { VEHICLE_STATUS_LABEL } from '@jjd/shared';

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
  const sort = useSort<Vehicle>(data?.items ?? [], {
    vehicle: (v) => [v.brand, v.model].filter(Boolean).join(' ') || v.code,
    plate: (v) => v.plate,
    type: (v) => v.type,
    status: (v) => VEHICLE_STATUS_LABEL[v.status as keyof typeof VEHICLE_STATUS_LABEL] ?? v.status,
    driver: (v) => v.driver,
    insurance: (v) => v.insurances[0]?.provider,
    monthlyPayment: (v) => v.monthlyPayment,
    nextInspection: (v) => (v.nextInspection ? new Date(v.nextInspection) : null),
  });

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
                <SortTh k="vehicle" sort={sort}>Véhicule</SortTh>
                <SortTh k="plate" sort={sort}>Plaque</SortTh>
                <SortTh k="type" sort={sort}>Type</SortTh>
                <SortTh k="status" sort={sort}>Statut</SortTh>
                <SortTh k="driver" sort={sort}>Conducteur</SortTh>
                <SortTh k="insurance" sort={sort}>Assurance</SortTh>
                <SortTh k="monthlyPayment" sort={sort} align="right">Mensualité</SortTh>
                <SortTh k="nextInspection" sort={sort}>Contrôle technique</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((v) => {
                const ins = v.insurances[0];
                const ct = v.nextInspection ? new Date(v.nextInspection).getTime() : null;
                return (
                  <tr key={v.id} style={v.status === 'sold' || v.status === 'retired' ? { opacity: 0.5 } : undefined}>
                    <td>
                      <Thumb src={v.photoThumbUrl} />
                      <Link href={`/app/flotte/${v.id}`}>{[v.brand, v.model].filter(Boolean).join(' ')}</Link>
                      {v.code && <span className="muted mono" style={{ fontSize: '0.75rem' }}> · {v.code}</span>}
                    </td>
                    <td className="mono">{v.plate ?? '—'}</td>
                    <td>{v.type ?? '—'}</td>
                    <td><VehicleStatusBadge status={v.status} /></td>
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
