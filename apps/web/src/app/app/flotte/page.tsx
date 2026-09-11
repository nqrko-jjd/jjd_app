'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { useSort, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { PageHead, Money, formatDateBE, Thumb, VehicleStatusBadge } from '@/lib/ui';
import { VEHICLE_STATUSES, VEHICLE_STATUS_LABEL } from '@jjd/shared';

const NEW_VEHICLE_FIELDS: FieldDef[] = [
  { name: 'code', label: 'Code interne', placeholder: 'V004' },
  { name: 'brand', label: 'Marque' },
  { name: 'model', label: 'Modèle' },
  { name: 'plate', label: 'Plaque' },
  { name: 'type', label: 'Type', placeholder: 'Camionette, Moto, Clark, Voiture…' },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: VEHICLE_STATUSES.map((s) => ({ value: s, label: VEHICLE_STATUS_LABEL[s] })) },
  { name: 'fuel', label: 'Carburant' },
  { name: 'driver', label: 'Conducteur' },
  { name: 'depot', label: 'Dépôt' },
];

interface Vehicle {
  id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
  type: string | null; fuel: string | null; status: string; driver: string | null; photoThumbUrl: string | null;
  nextInspection: string | null; monthlyPayment: number | null; acquisitionMode: string | null;
  insurances: { provider: string | null; monthlyAmount: number | null; annualAmount: number | null }[];
  _count: { fines: number; payments: number };
}

export default function FlottePage() {
  const router = useRouter();
  const { data, loading, reload } = useApi<{ items: Vehicle[] }>('/api/vehicles');
  const soon = Date.now() + 30 * 86400000;
  const ctx = useContextMenu<Vehicle>();
  const [mode, setMode] = useViewMode('flotte');
  const [creating, setCreating] = useState(false);

  async function setStatus(id: string, status: string) {
    await api(`/api/vehicles/${id}`, { method: 'PATCH', body: { status } });
    reload();
  }

  function rowMenu(v: Vehicle): MenuItem[] {
    return [
      ...openActions(`/app/flotte/${v.id}`, (h) => router.push(h)),
      'separator',
      {
        label: 'Statut',
        items: VEHICLE_STATUSES.map((s) => ({
          label: VEHICLE_STATUS_LABEL[s],
          check: v.status === s,
          disabled: v.status === s,
          onClick: () => setStatus(v.id, s),
        })),
      },
    ];
  }

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
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {creating && (
        <FormModal
          title="Nouveau véhicule"
          fields={NEW_VEHICLE_FIELDS}
          initial={{ status: 'active' }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const { vehicle } = await api<{ vehicle: { id: string } }>('/api/vehicles', { method: 'POST', body: v });
            router.push(`/app/flotte/${vehicle.id}`);
          }}
        />
      )}
      <PageHead
        title="Flotte"
        sub={data ? `${data.items.filter((v) => v.status === 'active').length} véhicules actifs · clic droit sur une ligne pour les actions rapides` : undefined}
        action={
          <div className="row">
            <button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau véhicule</button>
            <Link href="/app/flotte/pv" className="btn">PV / amendes →</Link>
          </div>
        }
      />
      <div className="row" style={{ marginBottom: '1rem', justifyContent: 'flex-end' }}>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      {loading && <div className="empty">Chargement…</div>}
      {data && mode === 'gallery' && (
        <div className="gallery-grid">
          {sort.rows.map((v) => {
            const ct = v.nextInspection ? new Date(v.nextInspection).getTime() : null;
            return (
              <Link
                key={v.id}
                href={`/app/flotte/${v.id}`}
                className="card gallery-card"
                style={v.status === 'sold' || v.status === 'retired' ? { opacity: 0.6 } : undefined}
              >
                <div className="gallery-thumb">
                  {v.photoThumbUrl ? <img src={v.photoThumbUrl} alt="" /> : '🚐'}
                </div>
                <div className="gallery-body">
                  <div className="gallery-title">{[v.brand, v.model].filter(Boolean).join(' ') || v.code || v.plate}</div>
                  <div className="gallery-sub">
                    {v.plate ?? '—'}{v.driver && ` · ${v.driver}`}
                    {v.nextInspection && (
                      <><br /><span className={ct && ct < soon ? 'badge crit' : ''}>CT {formatDateBE(v.nextInspection)}</span></>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {data && mode === 'list' && (
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
                  <tr
                    key={v.id}
                    style={v.status === 'sold' || v.status === 'retired' ? { opacity: 0.5 } : undefined}
                    className={`row-link${ctx.menu?.row.id === v.id ? ' ctx-target' : ''}`}
                    onClick={rowNav(`/app/flotte/${v.id}`, (h) => router.push(h))}
                    onContextMenu={(e) => ctx.open(e, v)}
                  >
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
