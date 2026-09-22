'use client';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { FormModal, type FieldDef } from '@/components/FormModal';
import { PlanningAssignmentModal } from '@/components/PlanningAssignmentModal';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { PageHead, Money, formatDateBE, Thumb, PlateBE, VehicleStatusBadge, Kpi } from '@/lib/ui';
import { VEHICLE_STATUSES, VEHICLE_STATUS_LABEL, WORKSITE_STATUS_OPEN } from '@jjd/shared';
import { Truck, CircleCheck, Building2, TriangleAlert, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PlanningEv, PlanPerson } from '@/components/planningTypes';

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
  { name: 'excludedFromPlanning', label: 'Hors planning (véhicule personnel, chariot élévateur… pas affecté aux chantiers)', type: 'checkbox' },
];

interface Vehicle {
  id: string; code: string | null; brand: string | null; model: string | null; plate: string | null;
  type: string | null; fuel: string | null; status: string; driver: string | null; photoThumbUrl: string | null;
  excludedFromPlanning: boolean;
  seats: number | null;
  nextInspection: string | null; monthlyPayment: number | null; acquisitionMode: string | null;
  insurances: { provider: string | null; monthlyAmount: number | null; annualAmount: number | null }[];
  _count: { fines: number; payments: number };
}
interface WsRow { id: string; ref: string; title: string; city: string | null }
interface EquipRow { id: string; name: string }
interface RosterPerson extends PlanPerson { role: string; specialties?: unknown; active: boolean }

// Heure LOCALE — jamais toISOString() ici : la Belgique est en avance sur UTC (UTC+1/+2),
// ça décalerait le jour affiché juste après minuit.
function toDateInput(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDaysStr(dateStr: string, n: number) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return toDateInput(d); }
function dayShort(dateStr: string) { return new Date(`${dateStr}T00:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: 'short' }); }
function vehicleLabel(v: Vehicle) { return [v.brand, v.model].filter(Boolean).join(' ') || v.code || v.plate || '—'; }

type DayStatus = 'available' | 'assigned' | 'unavailable';

export default function FlottePage() {
  const router = useRouter();
  const { data, loading, error, reload } = useApi<{ items: Vehicle[] }>('/api/vehicles');
  const vehiclesAll = data?.items ?? [];
  const fleet = useMemo(() => vehiclesAll.filter((v) => v.status !== 'sold' && v.status !== 'retired'), [vehiclesAll]);
  const soon = Date.now() + 30 * 86400000;
  const ctx = useContextMenu<Vehicle>();
  const [mode, setMode] = useViewMode('flotte');
  const [creating, setCreating] = useState(false);

  // ── Disponibilités — quel véhicule est libre / affecté / indisponible à une date donnée.
  const [day, setDay] = useState(() => toDateInput(new Date()));
  const [statusFilter, setStatusFilter] = useState<'all' | DayStatus>('all');
  const [assignmentModal, setAssignmentModal] = useState<{ prefill?: { vehicleId?: string; date?: string } } | null>(null);
  const windowTo = useMemo(() => addDaysStr(day, 21), [day]);
  const { data: evData, reload: reloadEvents } = useApi<{ items: PlanningEv[] }>(`/api/planning?from=${day}&to=${windowTo}`);
  const { data: wsData } = useApi<{ items: WsRow[] }>(`/api/worksites?status=${WORKSITE_STATUS_OPEN.join(',')}`);
  const { data: peopleData } = useApi<{ items: RosterPerson[] }>('/api/people?active=1');
  const { data: equipData } = useApi<{ items: EquipRow[] }>('/api/equipment');
  const worksitesActive = useMemo(() => [...(wsData?.items ?? [])].sort((a, b) => a.ref.localeCompare(b.ref)), [wsData]);
  const rosterPeople = peopleData?.items ?? [];
  const equipmentList = equipData?.items ?? [];
  const events = evData?.items ?? [];

  const assignableFleet = useMemo(() => fleet.filter((v) => !v.excludedFromPlanning), [fleet]);

  const availInfo = useMemo(() => {
    const map = new Map<string, { status: DayStatus; nextEvent?: PlanningEv }>();
    for (const v of assignableFleet) {
      if (v.status === 'repair' || v.status === 'breakdown') {
        map.set(v.id, { status: 'unavailable' });
        continue;
      }
      const vehicleEvents = events
        .filter((e) => e.vehicles.some((x) => x.vehicle.id === v.id))
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      const todayEvent = vehicleEvents.find((e) => toDateInput(new Date(e.startAt)) === day);
      const nextEvent = vehicleEvents.find((e) => toDateInput(new Date(e.startAt)) >= day);
      map.set(v.id, { status: todayEvent ? 'assigned' : 'available', nextEvent });
    }
    return map;
  }, [assignableFleet, events, day]);
  const availCounts = useMemo(() => {
    const c = { available: 0, assigned: 0, unavailable: 0 };
    for (const info of availInfo.values()) c[info.status]++;
    return c;
  }, [availInfo]);
  const filteredFleet = useMemo(
    () => fleet.filter((v) => statusFilter === 'all' || availInfo.get(v.id)?.status === statusFilter),
    [fleet, availInfo, statusFilter],
  );

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

  const vehicleAccessors = {
    vehicle: (v: Vehicle) => [v.brand, v.model].filter(Boolean).join(' ') || v.code,
    plate: (v: Vehicle) => v.plate,
    type: (v: Vehicle) => v.type,
    status: (v: Vehicle) => VEHICLE_STATUS_LABEL[v.status as keyof typeof VEHICLE_STATUS_LABEL] ?? v.status,
    driver: (v: Vehicle) => v.driver,
    insurance: (v: Vehicle) => v.insurances[0]?.provider,
    monthlyPayment: (v: Vehicle) => v.monthlyPayment,
    nextInspection: (v: Vehicle) => (v.nextInspection ? new Date(v.nextInspection) : null),
  };
  const colFilter = useColumnFilter<Vehicle>(mode === 'list' ? vehiclesAll : filteredFleet, vehicleAccessors);
  const sort = useSort<Vehicle>(colFilter.rows, vehicleAccessors);

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {creating && (
        <FormModal
          title="Nouveau véhicule"
          fields={NEW_VEHICLE_FIELDS}
          initial={{ status: 'active', excludedFromPlanning: false }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const { vehicle } = await api<{ vehicle: { id: string } }>('/api/vehicles', { method: 'POST', body: v });
            router.push(`/app/flotte/${vehicle.id}`);
          }}
        />
      )}
      {assignmentModal && (
        <PlanningAssignmentModal
          worksites={worksitesActive}
          people={rosterPeople}
          vehicles={assignableFleet}
          equipmentList={equipmentList}
          events={events}
          prefill={assignmentModal.prefill}
          onClose={() => setAssignmentModal(null)}
          onSaved={() => { setAssignmentModal(null); reloadEvents(); }}
        />
      )}
      <PageHead
        eyebrow="Ressources"
        title="Flotte"
        sub={data ? `${vehiclesAll.filter((v) => v.status === 'active').length} véhicules actifs · clic droit pour les actions rapides` : undefined}
        action={
          <div className="row">
            <button className="btn" onClick={() => setAssignmentModal({ prefill: { date: day } })}><CalendarPlus size={15} strokeWidth={2} /> Nouvelle affectation</button>
            <Link href="/app/flotte/pv" className="btn">PV / amendes →</Link>
            <button className="btn primary" onClick={() => setCreating(true)}>+ Nouveau véhicule</button>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ gap: '0.3rem' }}>
          <button type="button" className="btn ghost" onClick={() => setDay((d) => addDaysStr(d, -1))} aria-label="Jour précédent"><ChevronLeft size={16} strokeWidth={2} /></button>
          <strong style={{ minWidth: 130, textAlign: 'center', textTransform: 'capitalize' }}>{dayShort(day)}</strong>
          <button type="button" className="btn ghost" onClick={() => setDay((d) => addDaysStr(d, 1))} aria-label="Jour suivant"><ChevronRight size={16} strokeWidth={2} /></button>
        </div>
        <button type="button" className="btn" onClick={() => setDay(toDateInput(new Date()))}>Aujourd’hui</button>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <div className="kpis" style={{ marginBottom: '1.4rem' }}>
        <Kpi ic={Truck} label="Véhicules" value={fleet.length} sub="Flotte active" hero />
        <Kpi ic={CircleCheck} label="Libres toute la journée" value={availCounts.available} sub="Disponibles ce jour-là" />
        <Kpi ic={Building2} label="Avec affectation" value={availCounts.assigned} sub="Déjà réservés" />
        <Kpi ic={TriangleAlert} label="Indisponibles" value={availCounts.unavailable} sub={availCounts.unavailable > 0 ? 'En réparation ou en panne' : 'Aucun souci déclaré'} warn={availCounts.unavailable > 0} />
      </div>

      <div className="msg-filter-chips" style={{ marginBottom: '1.1rem' }}>
        <button className={statusFilter === 'all' ? 'on' : ''} onClick={() => setStatusFilter('all')}>Tous</button>
        <button className={statusFilter === 'available' ? 'on' : ''} onClick={() => setStatusFilter('available')}>Disponible</button>
        <button className={statusFilter === 'assigned' ? 'on' : ''} onClick={() => setStatusFilter('assigned')}>Affecté</button>
        <button className={statusFilter === 'unavailable' ? 'on' : ''} onClick={() => setStatusFilter('unavailable')}>Indisponible</button>
      </div>

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && mode === 'gallery' && filteredFleet.length === 0 && (
        <EmptyState icon={Truck} title={fleet.length === 0 ? 'Aucun véhicule dans la flotte' : 'Aucun véhicule pour ce filtre'} text={fleet.length === 0 ? 'Ajoutez vos véhicules pour suivre leurs assurances, contrôles techniques et affectations.' : 'Aucun véhicule n’a ce statut à la date choisie. Affichez tous les véhicules pour les retrouver.'} action={fleet.length === 0 ? <button type="button" className="btn primary" onClick={() => setCreating(true)}>Ajouter un véhicule</button> : <button type="button" className="btn primary" onClick={() => setStatusFilter('all')}>Afficher tous les véhicules</button>} />
      )}

      {data && mode === 'gallery' && filteredFleet.length > 0 && (
        <div className="avail-grid">
          {filteredFleet.map((v) => {
            const info = availInfo.get(v.id);
            const status = info?.status ?? 'available';
            const badgeLabel = v.excludedFromPlanning ? 'Hors planning' : status === 'assigned' ? 'Affecté' : status === 'unavailable' ? VEHICLE_STATUS_LABEL[v.status as keyof typeof VEHICLE_STATUS_LABEL] : 'Disponible';
            const badgeTone = v.excludedFromPlanning ? 'plain' : status === 'assigned' ? 'primary' : status === 'unavailable' ? 'crit' : 'ok';
            return (
              <div key={v.id} className="avail-card plate-card">
                <div className="avail-card-top">
                  {v.plate ? <PlateBE plate={v.plate} size={28} /> : <Thumb src={v.photoThumbUrl} size={40} icon={Truck} />}
                  <span className={`badge ${badgeTone}`}>{badgeLabel}</span>
                </div>
                <div className="avail-card-name">{vehicleLabel(v)}</div>
                <div className="avail-card-actions">
                  <Link href={`/app/flotte/${v.id}`} className="btn primary" style={{ flex: 1, justifyContent: 'center' }}>Ouvrir →</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && mode === 'list' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh k="vehicle" sort={sort} filter={colFilter}>Véhicule</SortTh>
                <SortTh k="plate" sort={sort} filter={colFilter}>Plaque</SortTh>
                <SortTh k="type" sort={sort} filter={colFilter}>Type</SortTh>
                <SortTh k="status" sort={sort} filter={colFilter}>Statut</SortTh>
                <SortTh k="driver" sort={sort} filter={colFilter}>Conducteur</SortTh>
                <SortTh k="insurance" sort={sort} filter={colFilter}>Assurance</SortTh>
                <SortTh k="monthlyPayment" sort={sort} align="right" filter={colFilter}>Mensualité</SortTh>
                <SortTh k="nextInspection" sort={sort} filter={colFilter}>Contrôle technique</SortTh>
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
                      <Thumb src={v.photoThumbUrl} icon={Truck} />
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
