'use client';
import { SkeletonRows } from '@/components/States';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { PageHead } from '@/lib/ui';
import { PlanningAssignmentModal } from '@/components/PlanningAssignmentModal';
import { PlanningEventDetail } from '@/components/PlanningEventDetail';
import { PlanningAbsenceModal } from '@/components/PlanningAbsenceModal';
import { WORKSITE_STATUS_OPEN, ABSENCE_KIND_LABEL, PERSON_ROLE_LABEL } from '@jjd/shared';
import { Search, Truck, Wrench } from 'lucide-react';
import type { PlanningEv, PlanAbsence, PlanVehicleRef } from '@/components/planningTypes';

interface PersonRow { id: string; displayName: string | null; firstName: string; role: string; specialties?: unknown; active: boolean; phone?: string | null }
interface WsRow { id: string; ref: string; title: string; city: string | null }
interface EquipRow { id: string; name: string }
interface VehicleRow extends PlanVehicleRef { status: string; excludedFromPlanning: boolean }

const TONE_COUNT = 6;

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
/** Grille façon Google Agenda : semaines complètes (lundi-dimanche) couvrant le mois, avec les
 *  jours des mois voisins pour compléter la 1ère/dernière semaine — jamais une semaine coupée
 *  en plein milieu. La dernière rangée est retirée si elle ne contient que des jours hors mois
 *  (mois qui tient dans 5 semaines, cas le plus fréquent). */
function monthGridDays(monthAnchor: Date): Date[] {
  const gridStart = mondayOf(startOfMonth(monthAnchor));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const lastWeek = days.slice(35);
  if (lastWeek.every((d) => d.getMonth() !== monthAnchor.getMonth())) return days.slice(0, 35);
  return days;
}
/** Clé "YYYY-MM-DD" en heure LOCALE — jamais toISOString() ici : la Belgique est
 *  toujours en avance sur UTC (UTC+1/+2), donc un minuit local convertirait sur le
 *  jour précédent et décalerait toute la grille d'une colonne. */
const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDate = (a: string, b: string) => a === b;
function businessDays(anchor: Date, count: number): Date[] {
  const out: Date[] = [];
  const cur = new Date(anchor);
  while (out.length < count) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
function personLabel(p: { displayName: string | null; firstName: string }) { return p.displayName || p.firstName; }
function initials(p: { displayName: string | null; firstName: string }) { return personLabel(p).slice(0, 2).toUpperCase(); }
function specialtyLabel(p: PersonRow) {
  const specs = Array.isArray(p.specialties) ? (p.specialties as string[]) : [];
  return specs[0] || PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] || p.role;
}
function hhmm(iso: string) { return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }); }
function vehicleLabel(v: PlanVehicleRef) {
  return [v.code, [v.brand, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || v.plate || '—';
}

type ViewMode = 'workers' | 'worksites' | 'resources' | 'month';
type Resource = { kind: 'vehicle' | 'equipment'; id: string; label: string; sub: string };

export default function PlanningPage() {
  const [view, setView] = useState<ViewMode>('workers');
  const [periodWeeks, setPeriodWeeks] = useState<1 | 2>(2);
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [trackedDay, setTrackedDay] = useState(() => toDateInput(new Date()));
  const [dayAgenda, setDayAgenda] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [worksiteFilter, setWorksiteFilter] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [wide, setWide] = useState(false);

  const [assignmentModal, setAssignmentModal] = useState<{
    existing?: PlanningEv | null;
    prefill?: { worksiteId?: string; date?: string; personId?: string; vehicleId?: string; equipmentId?: string };
  } | null>(null);
  const [detailEv, setDetailEv] = useState<PlanningEv | null>(null);
  const [absenceModal, setAbsenceModal] = useState<{ existing?: PlanAbsence | null; prefill?: { personId?: string; date?: string } } | null>(null);

  useEffect(() => {
    document.body.classList.toggle('plan-wide', wide);
    return () => { document.body.classList.remove('plan-wide'); };
  }, [wide]);

  const weekDays = useMemo(() => businessDays(anchor, periodWeeks * 5), [anchor, periodWeeks]);
  const monthDays = useMemo(() => monthGridDays(monthAnchor), [monthAnchor]);
  const days = view === 'month' ? monthDays : weekDays;
  const dayStrs = useMemo(() => days.map(toDateInput), [days]);
  const from = days[0]!.toISOString();
  const to = addDays(days[days.length - 1]!, 1).toISOString();

  const { data: evData, loading, reload } = useApi<{ items: PlanningEv[] }>(`/api/planning?from=${from}&to=${to}`);
  const events = evData?.items ?? [];
  const { data: peopleData, reload: reloadPeople } = useApi<{ items: PersonRow[] }>('/api/people?active=1');
  const people = useMemo(() => (peopleData?.items ?? []).filter((p) => p.active), [peopleData]);
  const { data: wsData } = useApi<{ items: WsRow[] }>(`/api/worksites?status=${WORKSITE_STATUS_OPEN.join(',')}`);
  const worksitesActive = useMemo(() => [...(wsData?.items ?? [])].sort((a, b) => a.ref.localeCompare(b.ref)), [wsData]);
  const { data: vehData } = useApi<{ items: VehicleRow[] }>('/api/vehicles');
  const vehicles = useMemo(() => (vehData?.items ?? []).filter((v) => v.status !== 'sold' && v.status !== 'retired' && !v.excludedFromPlanning), [vehData]);
  const { data: equipData } = useApi<{ items: EquipRow[] }>('/api/equipment');
  const equipmentList = equipData?.items ?? [];
  const { data: absData, reload: reloadAbsences } = useApi<{ items: PlanAbsence[] }>(`/api/absences?from=${from}&to=${to}`);
  const absences = absData?.items ?? [];

  function reloadAll() { reload(); reloadPeople(); reloadAbsences(); }

  const toneByWorksite = useMemo(() => {
    const map = new Map<string, number>();
    worksitesActive.forEach((w, i) => map.set(w.id, i % TONE_COUNT));
    return map;
  }, [worksitesActive]);
  const toneFor = (worksiteId: string) => toneByWorksite.get(worksiteId) ?? 0;

  const peopleIdsByDay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of dayStrs) map.set(d, new Set());
    for (const e of events) {
      const key = toDateInput(new Date(e.startAt));
      const set = map.get(key);
      if (set) for (const a of e.assignments) set.add(a.person.id);
    }
    return map;
  }, [events, dayStrs]);

  const absentIdsByDay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of dayStrs) {
      const set = new Set<string>();
      for (const a of absences) {
        const s = toDateInput(new Date(a.startsOn));
        const e = toDateInput(new Date(a.endsOn));
        if (d >= s && d <= e) set.add(a.personId);
      }
      map.set(d, set);
    }
    return map;
  }, [absences, dayStrs]);

  const vehicleIdsByDay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of dayStrs) map.set(d, new Set());
    for (const e of events) {
      const key = toDateInput(new Date(e.startAt));
      const set = map.get(key);
      if (set) for (const v of e.vehicles) set.add(v.vehicle.id);
    }
    return map;
  }, [events, dayStrs]);

  function selectTrackedDay(dateStr: string) {
    setTrackedDay(dateStr);
    if (dayStrs.includes(dateStr)) return;
    const d = new Date(`${dateStr}T00:00:00`);
    if (view === 'month') setMonthAnchor(startOfMonth(d));
    else setAnchor(mondayOf(d));
  }
  function shiftWeek(n: number) {
    const na = addDays(anchor, n * 7);
    setAnchor(na);
    setTrackedDay(toDateInput(na));
  }
  function goToday() {
    const na = mondayOf(new Date());
    setAnchor(na);
    setTrackedDay(toDateInput(new Date()));
  }
  function shiftMonth(n: number) {
    setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  }
  function goTodayMonth() {
    setMonthAnchor(startOfMonth(new Date()));
    setTrackedDay(toDateInput(new Date()));
  }

  const totalActive = people.length;
  const affectedToday = peopleIdsByDay.get(trackedDay)?.size ?? 0;
  const absentToday = absentIdsByDay.get(trackedDay)?.size ?? 0;
  const freeToday = Math.max(0, totalActive - affectedToday - absentToday);
  const vehiclesReservedToday = vehicleIdsByDay.get(trackedDay)?.size ?? 0;

  const specialtyOptions = useMemo(() => Array.from(new Set(people.map(specialtyLabel))).sort(), [people]);

  function eventsFor(day: string, matcher: (e: PlanningEv) => boolean) {
    return events.filter((e) => toDateInput(new Date(e.startAt)) === day && matcher(e));
  }

  const resources: Resource[] = useMemo(() => [
    ...vehicles.map((v) => ({ kind: 'vehicle' as const, id: v.id, label: vehicleLabel(v), sub: v.seats ? `${v.seats} places` : 'Véhicule' })),
    ...equipmentList.map((e) => ({ kind: 'equipment' as const, id: e.id, label: e.name, sub: 'Matériel' })),
  ], [vehicles, equipmentList]);

  const q = search.trim().toLowerCase();

  const workerRows = useMemo(() => people.filter((p) => {
    if (q && !personLabel(p).toLowerCase().includes(q) && !specialtyLabel(p).toLowerCase().includes(q)) return false;
    if (specialtyFilter && specialtyLabel(p) !== specialtyFilter) return false;
    if (worksiteFilter && !events.some((e) => e.worksite.id === worksiteFilter && e.assignments.some((a) => a.person.id === p.id))) return false;
    if (onlyFree) {
      const affected = peopleIdsByDay.get(trackedDay)?.has(p.id);
      const absent = absentIdsByDay.get(trackedDay)?.has(p.id);
      if (affected || absent) return false;
    }
    return true;
  }), [people, q, specialtyFilter, worksiteFilter, events, onlyFree, peopleIdsByDay, absentIdsByDay, trackedDay]);

  const worksiteRows = useMemo(() => worksitesActive.filter((w) => {
    if (q && !w.ref.toLowerCase().includes(q) && !w.title.toLowerCase().includes(q) && !(w.city ?? '').toLowerCase().includes(q)) return false;
    if (worksiteFilter && w.id !== worksiteFilter) return false;
    return true;
  }), [worksitesActive, q, worksiteFilter]);

  const resourceRows = useMemo(() => resources.filter((r) => {
    if (q && !r.label.toLowerCase().includes(q)) return false;
    if (worksiteFilter && !events.some((e) => e.worksite.id === worksiteFilter && (r.kind === 'vehicle' ? e.vehicles.some((v) => v.vehicle.id === r.id) : e.equipment.some((x) => x.equipment.id === r.id)))) return false;
    return true;
  }), [resources, q, worksiteFilter, events]);

  function openNew(prefill?: { worksiteId?: string; date?: string; personId?: string; vehicleId?: string; equipmentId?: string }) {
    setAssignmentModal({ existing: null, prefill });
  }
  function openEdit(ev: PlanningEv) {
    setDetailEv(null);
    setAssignmentModal({ existing: ev });
  }
  function openDuplicate(ev: PlanningEv) {
    setDetailEv(null);
    setAssignmentModal({
      existing: null,
      prefill: { worksiteId: ev.worksite.id, date: toDateInput(new Date(ev.startAt)) },
    });
  }

  function renderChips(dayStr: string, list: PlanningEv[]) {
    return list.map((e) => (
      <button
        key={e.id}
        type="button"
        className={`plan-chip tone-${toneFor(e.worksite.id)}${e.status === 'tentative' ? ' tentative' : ''}`}
        onClick={() => setDetailEv(e)}
      >
        <span className="t">{hhmm(e.startAt)}–{hhmm(e.endAt)}{e.status === 'tentative' ? ' · ?' : ''}</span>
        <span className="r">{e.worksite.ref} · {e.worksite.city ?? e.worksite.title}</span>
        <span className="n">{e.assignments.length} pers.{e.vehicles[0] ? ` · ${e.vehicles[0].vehicle.code ?? e.vehicles[0].vehicle.plate ?? ''}` : ''}</span>
      </button>
    ));
  }

  const monthLabel = monthAnchor.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });
  const rangeLabel = view === 'month'
    ? monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)
    : `${days[0]!.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })} — ${days[days.length - 1]!.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  const trackedShort = new Date(`${trackedDay}T00:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit' });

  return (
    <>
      <PageHead
        eyebrow="Coordination du terrain"
        title="Planning & affectations"
        sub="Des équipes composées pour chaque chantier, chaque jour."
        action={
          <div className="row">
            <button className="btn" onClick={() => setAbsenceModal({})}>+ Congé / formation</button>
            <button className="btn primary" onClick={() => openNew({ date: trackedDay })}>+ Nouvelle affectation</button>
          </div>
        }
      />

      <div className="plan-kpis">
        <div><strong>{totalActive}</strong><span>Ouvriers au planning</span></div>
        <div><strong>{affectedToday}</strong><span>Affectés le {trackedShort}</span></div>
        <div><strong>{freeToday}</strong><span>Libres toute la journée</span></div>
        <div><strong>{absentToday}</strong><span>Absences / formations</span></div>
        <div><strong>{vehiclesReservedToday}<small>/{vehicles.length}</small></strong><span>Véhicules réservés</span></div>
      </div>

      <div className="plan-topbar">
        <div className="plan-switch">
          <button className={view === 'workers' ? 'active' : ''} onClick={() => setView('workers')}>Ouvriers</button>
          <button className={view === 'worksites' ? 'active' : ''} onClick={() => setView('worksites')}>Chantiers</button>
          <button className={view === 'resources' ? 'active' : ''} onClick={() => setView('resources')}>Véhicules & matériel</button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Vue mensuelle</button>
        </div>
        <div className="plan-period">
          {view !== 'month' && <button type="button" className="btn plan-expand-toggle" onClick={() => setWide((w) => !w)}>{wide ? 'Réduire' : 'Agrandir le planning'}</button>}
          <button type="button" className="btn" onClick={() => (view === 'month' ? shiftMonth(-1) : shiftWeek(-1))}>←</button>
          <button type="button" className="btn" onClick={() => (view === 'month' ? goTodayMonth() : goToday())}>{view === 'month' ? "Aujourd'hui" : 'Cette semaine'}</button>
          <button type="button" className="btn" onClick={() => (view === 'month' ? shiftMonth(1) : shiftWeek(1))}>→</button>
          {view !== 'month' && (
            <select className="select" value={periodWeeks} onChange={(e) => setPeriodWeeks(Number(e.target.value) as 1 | 2)}>
              <option value={1}>1 semaine</option>
              <option value={2}>2 semaines</option>
            </select>
          )}
        </div>
      </div>

      <div className="plan-filters">
        {view !== 'month' && (
          <label className="plan-search">
            <Search size={16} strokeWidth={2} />
            <input placeholder="Rechercher une personne ou une ressource" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        )}
        {view === 'workers' && (
          <select className="select" value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)}>
            <option value="">Tous</option>
            {specialtyOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select className="select" value={worksiteFilter} onChange={(e) => setWorksiteFilter(e.target.value)}>
          <option value="">Tous les chantiers</option>
          {worksitesActive.map((w) => <option key={w.id} value={w.id}>{w.ref} · {w.city}</option>)}
        </select>
        {view === 'workers' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
            Libres le {trackedShort}
          </label>
        )}
      </div>

      <div className="plan-datebar">
        <strong>{rangeLabel}</strong>
        <label>
          Journée suivie{' '}
          <input className="input" type="date" value={trackedDay} onChange={(e) => selectTrackedDay(e.target.value)} />
        </label>
      </div>

      {loading && !evData ? <SkeletonRows /> : view === 'month' ? (
        <section className="plan-board plan-month-board">
          <div className="plan-month-weekdays">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="plan-month-grid">
            {monthDays.map((d) => {
              const ds = toDateInput(d);
              const outside = d.getMonth() !== monthAnchor.getMonth();
              const isToday = sameDate(ds, toDateInput(new Date()));
              const dayEvents = eventsFor(ds, (e) => !worksiteFilter || e.worksite.id === worksiteFilter)
                .sort((a, b) => a.startAt.localeCompare(b.startAt));
              const shown = dayEvents.slice(0, 3);
              const extra = dayEvents.length - shown.length;
              return (
                <div
                  key={ds}
                  className={`plan-month-day${outside ? ' outside' : ''}${sameDate(ds, trackedDay) ? ' selected-day' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => selectTrackedDay(ds)}
                >
                  <div className="plan-month-daynum">{isToday ? <span className="plan-month-today-dot">{d.getDate()}</span> : d.getDate()}</div>
                  <div className="plan-month-events">
                    {shown.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className={`plan-month-chip tone-${toneFor(e.worksite.id)}${e.status === 'tentative' ? ' tentative' : ''}`}
                        onClick={(ev) => { ev.stopPropagation(); setDetailEv(e); }}
                      >
                        <span className="tm">{hhmm(e.startAt)}</span> {e.worksite.ref}
                      </button>
                    ))}
                    {extra > 0 && (
                      <button type="button" className="plan-month-more" onClick={(ev) => { ev.stopPropagation(); setDayAgenda(ds); }}>
                        +{extra} de plus
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="plan-board">
          <div className="plan-grid-scroll">
            <table className="plan-grid">
              <thead>
                <tr>
                  <th>
                    {view === 'workers' ? 'Ouvriers' : view === 'worksites' ? 'Chantiers' : 'Véhicules & matériel'}{' '}
                    {view === 'workers' ? workerRows.length : view === 'worksites' ? worksiteRows.length : resourceRows.length}
                  </th>
                  {days.map((d) => {
                    const ds = toDateInput(d);
                    const affected = peopleIdsByDay.get(ds)?.size ?? 0;
                    return (
                      <th key={ds} className={sameDate(ds, trackedDay) ? 'selected-day' : ''}>
                        <button type="button" onClick={() => selectTrackedDay(ds)}>
                          {d.toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: 'short' })}
                          <span>{affected}/{totalActive} affectés</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {view === 'workers' && workerRows.map((p) => (
                  <tr key={p.id}>
                    <th>
                      <span className="plan-avatar">{initials(p)}</span>
                      <div>
                        <strong>{personLabel(p)}</strong>
                        <div className="plan-row-sub">{specialtyLabel(p)}</div>
                      </div>
                    </th>
                    {dayStrs.map((ds) => {
                      const absentKind = absences.find((a) => a.personId === p.id && ds >= toDateInput(new Date(a.startsOn)) && ds <= toDateInput(new Date(a.endsOn)));
                      const dayEvents = eventsFor(ds, (e) => e.assignments.some((a) => a.person.id === p.id));
                      return (
                        <td key={ds} className={sameDate(ds, trackedDay) ? 'selected-day' : ''}>
                          {absentKind ? (
                            <span className="plan-absence" onClick={() => setAbsenceModal({ existing: absentKind })} style={{ cursor: 'pointer' }}>
                              {ABSENCE_KIND_LABEL[absentKind.kind as keyof typeof ABSENCE_KIND_LABEL] ?? absentKind.kind}
                            </span>
                          ) : dayEvents.length > 0 ? (
                            renderChips(ds, dayEvents)
                          ) : (
                            <button type="button" className="plan-vacancy" onClick={() => openNew({ personId: p.id, date: ds, worksiteId: worksiteFilter || undefined })}>
                              ＋ Affecter
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {view === 'worksites' && worksiteRows.map((w) => (
                  <tr key={w.id}>
                    <th>
                      <span className={`plan-avatar tone-${toneFor(w.id)}`}>{w.ref.slice(0, 2)}</span>
                      <div>
                        <strong><Link href={`/app/chantiers/${w.id}`}>{w.ref}</Link></strong>
                        <div className="plan-row-sub">{w.title}{w.city ? ` · ${w.city}` : ''}</div>
                      </div>
                    </th>
                    {dayStrs.map((ds) => {
                      const dayEvents = eventsFor(ds, (e) => e.worksite.id === w.id);
                      return (
                        <td key={ds} className={sameDate(ds, trackedDay) ? 'selected-day' : ''}>
                          {dayEvents.length > 0 ? renderChips(ds, dayEvents) : (
                            <button type="button" className="plan-vacancy" onClick={() => openNew({ worksiteId: w.id, date: ds })}>＋ Affecter</button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {view === 'resources' && resourceRows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <th>
                      <span className="plan-avatar">{r.kind === 'vehicle' ? <Truck size={15} strokeWidth={2} /> : <Wrench size={15} strokeWidth={2} />}</span>
                      <div>
                        <strong>{r.label}</strong>
                        <div className="plan-row-sub">{r.sub}</div>
                      </div>
                    </th>
                    {dayStrs.map((ds) => {
                      const dayEvents = eventsFor(ds, (e) => (r.kind === 'vehicle' ? e.vehicles.some((v) => v.vehicle.id === r.id) : e.equipment.some((x) => x.equipment.id === r.id)));
                      return (
                        <td key={ds} className={sameDate(ds, trackedDay) ? 'selected-day' : ''}>
                          {dayEvents.length > 0 ? renderChips(ds, dayEvents) : (
                            <button
                              type="button"
                              className="plan-vacancy"
                              onClick={() => openNew({ date: ds, worksiteId: worksiteFilter || undefined, vehicleId: r.kind === 'vehicle' ? r.id : undefined, equipmentId: r.kind === 'equipment' ? r.id : undefined })}
                            >
                              ＋ Affecter
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="plan-legend">
        <span>Chaque couleur correspond à un chantier.</span>
        <span className="plan-dashed-key">À confirmer</span>
        <span>Congés et formations bloquent l’affectation.</span>
      </div>

      {assignmentModal && (
        <PlanningAssignmentModal
          worksites={worksitesActive}
          people={people}
          vehicles={vehicles}
          equipmentList={equipmentList}
          events={events}
          existing={assignmentModal.existing}
          prefill={assignmentModal.prefill}
          onClose={() => setAssignmentModal(null)}
          onSaved={() => { setAssignmentModal(null); reloadAll(); }}
        />
      )}
      {detailEv && (
        <PlanningEventDetail
          ev={detailEv}
          onClose={() => setDetailEv(null)}
          onEdit={() => openEdit(detailEv)}
          onDuplicate={() => openDuplicate(detailEv)}
          onDeleted={() => { setDetailEv(null); reloadAll(); }}
        />
      )}
      {absenceModal && (
        <PlanningAbsenceModal
          people={people}
          existing={absenceModal.existing}
          prefill={absenceModal.prefill}
          onClose={() => setAbsenceModal(null)}
          onSaved={() => { setAbsenceModal(null); reloadAll(); }}
        />
      )}
      {dayAgenda && (
        <div className="modal-scrim" onClick={() => setDayAgenda(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{new Date(`${dayAgenda}T00:00:00`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
              <button className="btn ghost" onClick={() => setDayAgenda(null)} aria-label="Fermer">✕</button>
            </div>
            <div className="modal-body" style={{ display: 'block', maxHeight: '72vh', overflowY: 'auto' }}>
              {renderChips(dayAgenda, eventsFor(dayAgenda, (e) => !worksiteFilter || e.worksite.id === worksiteFilter).sort((a, b) => a.startAt.localeCompare(b.startAt)))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
