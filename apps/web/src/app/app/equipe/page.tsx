'use client';
import { SkeletonRows, ErrorState } from '@/components/States';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, Avatar, Kpi } from '@/lib/ui';
import { FormModal } from '@/components/FormModal';
import { ContextMenu, useContextMenu, openActions, type MenuItem } from '@/components/ContextMenu';
import { ViewToggle, useViewMode } from '@/components/ViewToggle';
import { PlanningAssignmentModal } from '@/components/PlanningAssignmentModal';
import { PlanningAbsenceModal } from '@/components/PlanningAbsenceModal';
import { useSort, useColumnFilter, SortTh } from '@/lib/sort';
import { rowNav } from '@/lib/rowNav';
import { PERSON_FIELDS } from '@/lib/forms';
import { downloadCsv, pickAndImportCsv, summarizeImport } from '@/lib/csvIO';
import {
  PERSON_ROLE_LABEL, PERSON_ROLES, WORKER_CONTRACT_LABEL, WORKSITE_STATUS_OPEN, ABSENCE_KIND_LABEL,
} from '@jjd/shared';
import { Users, CircleCheck, Building2, CalendarOff, CalendarPlus, UserX, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PlanningEv, PlanAbsence, PlanVehicleRef } from '@/components/planningTypes';

interface Person {
  id: string; firstName: string; lastName: string | null; displayName: string | null;
  role: string; contractType: string; hourlyRate: number | null; phone: string | null;
  active: boolean; languages: string[] | null; specialties: string[] | null; photoThumbUrl: string | null;
  _count: { legalDocs: number; timeEntries: number };
}
interface WsRow { id: string; ref: string; title: string; city: string | null }
interface EquipRow { id: string; name: string }
interface VehicleRow extends PlanVehicleRef { status: string; excludedFromPlanning: boolean }

// Heure LOCALE — jamais toISOString() ici : la Belgique est en avance sur UTC (UTC+1/+2),
// ça décalerait le jour affiché juste après minuit.
function toDateInput(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDaysStr(dateStr: string, n: number) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return toDateInput(d); }
function dayShort(dateStr: string) { return new Date(`${dateStr}T00:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: 'short' }); }
function specialtyLabel(p: Person) {
  const specs = Array.isArray(p.specialties) ? p.specialties : [];
  return specs[0] || PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] || p.role;
}

type DayStatus = 'available' | 'assigned' | 'unavailable';

export default function EquipePage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <EquipeInner />
    </Suspense>
  );
}

function EquipeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('1');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useViewMode('equipe');
  const ctx = useContextMenu<Person>();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  if (active) params.set('active', active);
  const { data, loading, error, reload } = useApi<{ items: Person[] }>(`/api/people?${params}`);
  const name = (p: Person) => p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim();
  const people = data?.items ?? [];

  // ── Disponibilités — qui est libre / affecté / absent à une date donnée, avec accès rapide
  // à « Nouvelle affectation » et « Absence » (réutilise l'infrastructure du Planning).
  const [day, setDay] = useState(() => toDateInput(new Date()));
  const [statusFilter, setStatusFilter] = useState<'all' | DayStatus>('all');
  const [assignmentModal, setAssignmentModal] = useState<{ prefill?: { personId?: string; date?: string } } | null>(null);
  const [absenceModal, setAbsenceModal] = useState<{ prefill?: { personId?: string; date?: string } } | null>(null);
  const windowTo = useMemo(() => addDaysStr(day, 21), [day]);
  const { data: evData, reload: reloadEvents } = useApi<{ items: PlanningEv[] }>(`/api/planning?from=${day}&to=${windowTo}`);
  const { data: absData, reload: reloadAbsences } = useApi<{ items: PlanAbsence[] }>(`/api/absences?from=${day}&to=${windowTo}`);
  const { data: wsData } = useApi<{ items: WsRow[] }>(`/api/worksites?status=${WORKSITE_STATUS_OPEN.join(',')}`);
  const { data: vehData } = useApi<{ items: VehicleRow[] }>('/api/vehicles');
  const { data: equipData } = useApi<{ items: EquipRow[] }>('/api/equipment');
  const worksitesActive = useMemo(() => [...(wsData?.items ?? [])].sort((a, b) => a.ref.localeCompare(b.ref)), [wsData]);
  const vehicles = useMemo(() => (vehData?.items ?? []).filter((v) => v.status !== 'sold' && v.status !== 'retired' && !v.excludedFromPlanning), [vehData]);
  const equipmentList = equipData?.items ?? [];
  const events = evData?.items ?? [];
  const absences = absData?.items ?? [];
  function reloadAvail() { reloadEvents(); reloadAbsences(); }

  const availInfo = useMemo(() => {
    const map = new Map<string, { status: DayStatus; absenceKind?: string; nextEvent?: PlanningEv }>();
    for (const p of people) {
      const personEvents = events
        .filter((e) => e.assignments.some((a) => a.person.id === p.id))
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      const todayEvent = personEvents.find((e) => toDateInput(new Date(e.startAt)) === day);
      const absence = absences.find((a) => a.personId === p.id && a.startsOn.slice(0, 10) <= day && day <= a.endsOn.slice(0, 10));
      const nextEvent = personEvents.find((e) => toDateInput(new Date(e.startAt)) >= day);
      map.set(p.id, { status: absence ? 'unavailable' : todayEvent ? 'assigned' : 'available', absenceKind: absence?.kind, nextEvent });
    }
    return map;
  }, [people, events, absences, day]);
  const availCounts = useMemo(() => {
    const c = { available: 0, assigned: 0, unavailable: 0 };
    for (const info of availInfo.values()) c[info.status]++;
    return c;
  }, [availInfo]);
  const filteredRows = useMemo(
    () => people.filter((p) => statusFilter === 'all' || availInfo.get(p.id)?.status === statusFilter),
    [people, availInfo, statusFilter],
  );

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/people/${id}`, { method: 'PATCH', body });
    reload();
  }

  function rowMenu(p: Person): MenuItem[] {
    return [
      ...openActions(`/app/equipe/${p.id}`, (h) => router.push(h)),
      ...(p.phone ? ['separator' as const, { label: `Appeler ${p.phone}`, onClick: () => { window.location.href = `tel:${p.phone}`; } }] : []),
      'separator',
      {
        label: 'Rôle',
        items: PERSON_ROLES.map((r) => ({
          label: PERSON_ROLE_LABEL[r],
          check: p.role === r,
          disabled: p.role === r,
          onClick: () => patch(p.id, { role: r }),
        })),
      },
      p.active
        ? { label: 'Marquer comme ancien', onClick: () => patch(p.id, { active: false }) }
        : { label: 'Réactiver', onClick: () => patch(p.id, { active: true }) },
    ];
  }
  function exportCsv() {
    downloadCsv(`/api/people/export.csv?${params}`, `equipe-${toDateInput(new Date())}.csv`);
  }
  function importCsv() {
    pickAndImportCsv(
      '/api/people/import',
      (r) => { alert(summarizeImport(r)); reload(); },
      (msg) => alert(`Échec de l’import : ${msg}`),
    );
  }
  const personAccessors = {
    name,
    role: (p: Person) => PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role,
    contract: (p: Person) => WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? p.contractType,
    rate: (p: Person) => p.hourlyRate,
    languages: (p: Person) => (p.languages ?? []).join(' '),
    specialties: (p: Person) => (p.specialties ?? []).join(' '),
    docs: (p: Person) => p._count.legalDocs,
    entries: (p: Person) => p._count.timeEntries,
  };
  const colFilter = useColumnFilter<Person>(filteredRows, personAccessors);
  const sort = useSort<Person>(colFilter.rows, personAccessors);

  return (
    <>
      {ctx.menu && <ContextMenu x={ctx.menu.x} y={ctx.menu.y} items={rowMenu(ctx.menu.row)} onClose={ctx.close} />}
      {creating && (
        <FormModal
          title="Nouvelle personne"
          fields={PERSON_FIELDS}
          initial={{ role: 'worker', contractType: 'employee', active: true }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => { await api('/api/people', { method: 'POST', body: v }); reload(); }}
        />
      )}
      {assignmentModal && (
        <PlanningAssignmentModal
          worksites={worksitesActive}
          people={people}
          vehicles={vehicles}
          equipmentList={equipmentList}
          events={events}
          prefill={assignmentModal.prefill}
          onClose={() => setAssignmentModal(null)}
          onSaved={() => { setAssignmentModal(null); reloadAvail(); }}
        />
      )}
      {absenceModal && (
        <PlanningAbsenceModal
          people={people}
          prefill={absenceModal.prefill}
          onClose={() => setAbsenceModal(null)}
          onSaved={() => { setAbsenceModal(null); reloadAvail(); }}
        />
      )}
      <PageHead
        eyebrow="Les personnes"
        title="Équipe"
        sub={data ? `${people.filter((p) => p.active).length} actifs · clic droit pour les actions rapides` : undefined}
        action={
          <div className="row">
            <button className="btn" onClick={exportCsv} title="Exporter la liste filtrée en CSV (éditable dans Excel)">⇩ Exporter CSV</button>
            <button className="btn" onClick={importCsv} title="Réimporter un CSV/Excel corrigé (met à jour par id, crée les nouvelles fiches)">⇧ Importer</button>
            <button className="btn" onClick={() => setAbsenceModal({ prefill: { date: day } })}><UserX size={15} strokeWidth={2} /> Congé / formation</button>
            <button className="btn" onClick={() => setAssignmentModal({ prefill: { date: day } })}><CalendarPlus size={15} strokeWidth={2} /> Nouvelle affectation</button>
            <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvelle personne</button>
          </div>
        }
      />

      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 220 }} placeholder="Nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 190 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous rôles</option>
          {PERSON_ROLES.map((r) => <option key={r} value={r}>{PERSON_ROLE_LABEL[r]}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="1">Actifs</option>
          <option value="0">Anciens</option>
          <option value="">Tous</option>
        </select>
        <div className="row" style={{ gap: '0.3rem' }}>
          <button type="button" className="btn ghost" onClick={() => setDay((d) => addDaysStr(d, -1))} aria-label="Jour précédent"><ChevronLeft size={16} strokeWidth={2} /></button>
          <strong style={{ minWidth: 130, textAlign: 'center', textTransform: 'capitalize' }}>{dayShort(day)}</strong>
          <button type="button" className="btn ghost" onClick={() => setDay((d) => addDaysStr(d, 1))} aria-label="Jour suivant"><ChevronRight size={16} strokeWidth={2} /></button>
        </div>
        <button type="button" className="btn" onClick={() => setDay(toDateInput(new Date()))}>Aujourd’hui</button>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <div className="kpis" style={{ marginBottom: '1.4rem' }}>
        <Kpi ic={Users} label="Collaborateurs" value={people.length} sub="Selon les filtres" hero />
        <Kpi ic={CircleCheck} label="Libres toute la journée" value={availCounts.available} sub="Disponibles ce jour-là" />
        <Kpi ic={Building2} label="Avec affectation" value={availCounts.assigned} sub="Déjà sur un chantier" />
        <Kpi ic={CalendarOff} label="Indisponibles" value={availCounts.unavailable} sub={availCounts.unavailable > 0 ? 'Congé ou formation' : 'Personne d’absent'} warn={availCounts.unavailable > 0} />
      </div>

      <div className="msg-filter-chips" style={{ marginBottom: '1.1rem' }}>
        <button className={statusFilter === 'all' ? 'on' : ''} onClick={() => setStatusFilter('all')}>Tous</button>
        <button className={statusFilter === 'available' ? 'on' : ''} onClick={() => setStatusFilter('available')}>Disponible</button>
        <button className={statusFilter === 'assigned' ? 'on' : ''} onClick={() => setStatusFilter('assigned')}>Affecté</button>
        <button className={statusFilter === 'unavailable' ? 'on' : ''} onClick={() => setStatusFilter('unavailable')}>Indisponible</button>
      </div>

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && filteredRows.length === 0 && <div className="card card-pad muted">Aucune personne pour ce filtre.</div>}

      {data && filteredRows.length > 0 && mode === 'gallery' && (
        <div className="avail-grid">
          {sort.rows.map((p) => {
            const info = availInfo.get(p.id);
            const status = info?.status ?? 'available';
            const badgeLabel = status === 'assigned' ? 'Affecté' : status === 'unavailable' ? (ABSENCE_KIND_LABEL[info?.absenceKind as keyof typeof ABSENCE_KIND_LABEL] ?? 'Indisponible') : 'Disponible';
            const badgeTone = status === 'assigned' ? 'primary' : status === 'unavailable' ? 'warn' : 'ok';
            return (
              <div key={p.id} className="avail-card" style={p.active ? undefined : { opacity: 0.6 }}>
                {p.photoThumbUrl && (
                  <div className="avail-card-photo">
                    <img src={p.photoThumbUrl} alt="" />
                  </div>
                )}
                <div className="avail-card-top">
                  <Avatar label={name(p)} size={56} />
                  <span className={`badge ${badgeTone}`}>{badgeLabel}</span>
                </div>
                <div className="avail-card-name">{name(p)}{!p.active && <span className="badge plain" style={{ marginLeft: 6 }}>Ancien</span>}</div>
                <div className="avail-card-role">{specialtyLabel(p)}</div>
                <div className="avail-card-actions">
                  <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setAbsenceModal({ prefill: { personId: p.id, date: day } })}>Absence</button>
                  <Link href={`/app/equipe/${p.id}`} className="btn ghost">Ouvrir →</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && filteredRows.length > 0 && mode === 'list' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} filter={colFilter}>Nom</SortTh>
                <th>Statut</th>
                <SortTh k="role" sort={sort} filter={colFilter}>Rôle</SortTh>
                <SortTh k="specialties" sort={sort} filter={colFilter}>Spécialités</SortTh>
                <SortTh k="contract" sort={sort} filter={colFilter}>Contrat</SortTh>
                <SortTh k="rate" sort={sort} align="right" filter={colFilter}>Taux</SortTh>
                <SortTh k="languages" sort={sort} filter={colFilter}>Langues</SortTh>
                <SortTh k="docs" sort={sort} filter={colFilter}>Docs</SortTh>
                <SortTh k="entries" sort={sort} filter={colFilter}>Pointages</SortTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((p) => {
                const info = availInfo.get(p.id);
                const status = info?.status ?? 'available';
                const badgeLabel = status === 'assigned' ? 'Affecté' : status === 'unavailable' ? (ABSENCE_KIND_LABEL[info?.absenceKind as keyof typeof ABSENCE_KIND_LABEL] ?? 'Indisponible') : 'Disponible';
                const badgeTone = status === 'assigned' ? 'primary' : status === 'unavailable' ? 'warn' : 'ok';
                return (
                  <tr
                    key={p.id}
                    style={p.active ? undefined : { opacity: 0.5 }}
                    className={`row-link${ctx.menu?.row.id === p.id ? ' ctx-target' : ''}`}
                    onClick={rowNav(`/app/equipe/${p.id}`, (h) => router.push(h))}
                    onContextMenu={(e) => ctx.open(e, p)}
                  >
                    <td>
                      <Avatar src={p.photoThumbUrl} label={p.displayName || `${p.firstName} ${p.lastName ?? ''}`} />
                      <Link href={`/app/equipe/${p.id}`}>{p.displayName || `${p.firstName} ${p.lastName ?? ''}`.trim()}</Link>
                      {!p.active && <span className="badge plain" style={{ marginLeft: 6 }}>Ancien</span>}
                    </td>
                    <td><span className={`badge ${badgeTone}`}>{badgeLabel}</span></td>
                    <td>{PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] ?? p.role}</td>
                    <td style={{ fontSize: '0.82rem' }}>{(p.specialties ?? []).join(', ') || '—'}</td>
                    <td>{WORKER_CONTRACT_LABEL[p.contractType as keyof typeof WORKER_CONTRACT_LABEL] ?? p.contractType}</td>
                    <td style={{ textAlign: 'right' }}>{p.hourlyRate != null ? <Money value={p.hourlyRate} /> : <span className="badge warn">à définir</span>}</td>
                    <td className="mono" style={{ fontSize: '0.8rem' }}>{(p.languages ?? []).join(' ') || '—'}</td>
                    <td className="tnum">{p._count.legalDocs || ''}</td>
                    <td className="tnum">{p._count.timeEntries || ''}</td>
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
