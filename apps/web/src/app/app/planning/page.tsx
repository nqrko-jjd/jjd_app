'use client';
import { PlanningAgenda } from '@/components/PlanningAgenda';
import { PlanningList } from '@/components/PlanningList';
import { SkeletonRows } from '@/components/States';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, StatusBadge } from '@/lib/ui';
import { PlanningAssignmentModal } from '@/components/PlanningAssignmentModal';
import { PlanningEventDetail } from '@/components/PlanningEventDetail';
import { PlanningAbsenceModal } from '@/components/PlanningAbsenceModal';
import { WORKSITE_STATUS_OPEN, WORKSITE_STATUS_LABEL, ABSENCE_KIND_LABEL, PERSON_ROLE_LABEL, WORKFORCE_CATEGORY_LABEL, workforceCategory, isFieldWorker } from '@jjd/shared';
import { Eye, Search, Truck, Wrench } from 'lucide-react';
import type { PlanningEv, PlanAbsence, PlanVehicleRef } from '@/components/planningTypes';

interface PersonRow { id: string; displayName: string | null; firstName: string; role: string; contractType?: string | null; specialties?: unknown; active: boolean; phone?: string | null }
interface WsRow { id: string; ref: string; title: string; city: string | null; status: string }
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
/** `count` jours consécutifs à partir de `anchor` (inclus) — samedi et dimanche compris : les
 *  équipes travaillent aussi le week-end, contrairement à un calendrier de bureau classique. */
function daysFrom(anchor: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(anchor, i));
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

type ViewMode = 'planning' | 'agenda' | 'day' | 'workers' | 'worksites' | 'resources' | 'month';
/** Ordre d'affichage des personnes : ouvriers d'abord ; sous-traitants, gestionnaires et bureau à part. */
const CAT_ORDER = { ouvrier: 0, sous_traitant: 1, gestionnaire: 2, bureau: 3 } as const;
const CAT_NOTE = { ouvrier: '', sous_traitant: ' — appelés à la demande, hors effectif disponible', gestionnaire: ' — supervisent, toujours disponibles, hors effectif terrain', bureau: ' — hors terrain' } as const;
type Resource = { kind: 'vehicle' | 'equipment'; id: string; label: string; sub: string };

export default function PlanningPage() {
  const [view, setView] = useState<ViewMode>('agenda');
  const [periodWeeks, setPeriodWeeks] = useState<1 | 2>(1);
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [trackedDay, setTrackedDay] = useState(() => toDateInput(new Date()));
  const [dayAgenda, setDayAgenda] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [worksiteFilter, setWorksiteFilter] = useState('');
  const [worksiteStatusFilter, setWorksiteStatusFilter] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [wide, setWide] = useState(false);
  // vue « Planning » (liste façon Google Agenda) : début de la fenêtre et nombre de jours chargés (défilement sans fin)
  const [listStart, setListStart] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; });
  const [listSpan, setListSpan] = useState(31);

  const [assignmentModal, setAssignmentModal] = useState<{
    existing?: PlanningEv | null;
    duplicateFrom?: PlanningEv | null;
    prefill?: { worksiteId?: string; date?: string; personId?: string; vehicleId?: string; equipmentId?: string };
  } | null>(null);
  const [detailEv, setDetailEv] = useState<PlanningEv | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [absenceModal, setAbsenceModal] = useState<{ existing?: PlanAbsence | null; prefill?: { personId?: string; date?: string } } | null>(null);

  useEffect(() => {
    document.body.classList.toggle('plan-wide', wide);
    return () => { document.body.classList.remove('plan-wide'); };
  }, [wide]);

  const weekDays = useMemo(() => daysFrom(anchor, periodWeeks * 7), [anchor, periodWeeks]);
  const monthDays = useMemo(() => monthGridDays(monthAnchor), [monthAnchor]);
  const dayView = useMemo(() => [new Date(`${trackedDay}T00:00:00`)], [trackedDay]);
  const listDays = useMemo(() => daysFrom(listStart, listSpan), [listStart, listSpan]);
  const days = view === 'planning' ? listDays : view === 'month' ? monthDays : view === 'day' ? dayView : weekDays;
  const dayStrs = useMemo(() => days.map(toDateInput), [days]);
  const from = days[0]!.toISOString();
  const to = addDays(days[days.length - 1]!, 1).toISOString();

  const { data: evData, loading, reload } = useApi<{ items: PlanningEv[]; googleSync: boolean }>(`/api/planning?from=${from}&to=${to}`);
  const events = evData?.items ?? [];
  const [gcalBusy, setGcalBusy] = useState(false);
  async function gcalBackfill(reformat = false) {
    if (reformat && !confirm('Réécrire dans Google Agenda la fiche de tous les événements À VENIR envoyés depuis l’appli, avec la nouvelle présentation ? Les événements du passé et ceux faits à la main dans Google ne sont pas touchés.')) return;
    setGcalBusy(true);
    try {
      const r = await api<{ total: number; synced: number; errors: string[] }>(`/api/planning/gcal-backfill${reformat ? '?reformat=1' : ''}`, { method: 'POST' });
      alert(r.total === 0
        ? 'Tout était déjà synchronisé — rien à faire.'
        : `${r.synced}/${r.total} événement(s) envoyé(s) vers Google Agenda.${r.errors.length ? `\n${r.errors.length} échec(s), voir logs serveur.` : ''}`);
    } catch (e) {
      alert(`Échec : ${(e as Error).message}`);
    } finally {
      setGcalBusy(false);
    }
  }
  const { data: peopleData, reload: reloadPeople } = useApi<{ items: PersonRow[] }>('/api/people?active=1');
  const people = useMemo(() => (peopleData?.items ?? []).filter((p) => p.active), [peopleData]);
  const { data: wsData } = useApi<{ items: WsRow[] }>(`/api/worksites?status=${WORKSITE_STATUS_OPEN.join(',')}`);
  const worksitesActive = useMemo(() => [...(wsData?.items ?? [])].sort((a, b) => a.ref.localeCompare(b.ref)), [wsData]);
  // Les chantiers clôturés/archivés restent affectables et filtrables (reprise d'anciens dossiers) :
  // la liste courte /api/meta/pickers les contient tous ; on garde la liste « ouverts » pour les
  // compteurs et la vue par chantier, et on y ajoute les clôturés pour les sélecteurs seulement.
  const { data: pickData } = useApi<{ worksites: { id: string; name: string; city: string | null }[] }>('/api/meta/pickers');
  const worksitesClosed = useMemo(() => {
    const open = new Set(worksitesActive.map((w) => w.id));
    return (pickData?.worksites ?? []).filter((w) => !open.has(w.id)).map((w): WsRow => {
      const [ref = '', ...rest] = w.name.split(' · ');
      return { id: w.id, ref, title: rest.join(' · '), city: w.city, status: 'closed' };
    });
  }, [pickData, worksitesActive]);
  const worksitesAll = useMemo(() => [...worksitesActive, ...worksitesClosed], [worksitesActive, worksitesClosed]);
  const worksiteStatusCounts = useMemo(() => worksitesActive.reduce<Record<string, number>>((counts, w) => {
    counts[w.status] = (counts[w.status] ?? 0) + 1;
    return counts;
  }, {}), [worksitesActive]);
  const statusFilteredWorksites = useMemo(() => worksitesActive.filter((w) => !worksiteStatusFilter || w.status === worksiteStatusFilter), [worksitesActive, worksiteStatusFilter]);
  const statusFilteredWorksiteIds = useMemo(() => new Set(statusFilteredWorksites.map((w) => w.id)), [statusFilteredWorksites]);
  const observationWorksites = useMemo(() => worksitesActive.filter((w) => w.status === 'on_hold'), [worksitesActive]);
  const { data: vehData } = useApi<{ items: VehicleRow[] }>('/api/vehicles');
  const vehicles = useMemo(() => (vehData?.items ?? []).filter((v) => v.status !== 'sold' && v.status !== 'retired' && !v.excludedFromPlanning), [vehData]);
  const { data: equipData } = useApi<{ items: EquipRow[] }>('/api/equipment');
  const equipmentList = equipData?.items ?? [];
  const { data: absData, reload: reloadAbsences } = useApi<{ items: PlanAbsence[] }>(`/api/absences?from=${from}&to=${to}`);
  const absences = absData?.items ?? [];

  function reloadAll() { reload(); reloadPeople(); reloadAbsences(); }

  /** Glisser-déposer (vue mensuelle) : déplace l'affectation à un autre jour en conservant
   *  l'heure et la durée du créneau. */
  async function moveEventToDay(ev: PlanningEv, targetDs: string) {
    const curDs = toDateInput(new Date(ev.startAt));
    if (curDs === targetDs) return;
    const start = new Date(ev.startAt);
    const end = new Date(ev.endAt);
    const [ty, tm, td] = targetDs.split('-').map(Number);
    const newStart = new Date(ty!, tm! - 1, td!, start.getHours(), start.getMinutes(), start.getSeconds());
    const newEnd = new Date(newStart.getTime() + (end.getTime() - start.getTime()));
    try {
      await api(`/api/planning/${ev.id}`, { method: 'PATCH', body: { startAt: newStart.toISOString(), endAt: newEnd.toISOString() } });
      reloadAll();
    } catch (e) {
      alert((e as Error).message ?? 'Échec du déplacement');
    }
  }

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
  function shiftDay(n: number) {
    setTrackedDay((d) => toDateInput(addDays(new Date(`${d}T00:00:00`), n)));
  }
  function shiftMonth(n: number) {
    setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  }
  function goTodayMonth() {
    setMonthAnchor(startOfMonth(new Date()));
    setTrackedDay(toDateInput(new Date()));
  }

  // effectif terrain = les OUVRIERS ; sous-traitants (à la demande), gestionnaires (supervision) et bureau sont comptés à part
  const fieldIds = useMemo(() => new Set(people.filter(isFieldWorker).map((p) => p.id)), [people]);
  const subIds = useMemo(() => new Set(people.filter((p) => workforceCategory(p) === 'sous_traitant').map((p) => p.id)), [people]);
  const countIn = (ids: Set<string> | undefined, among: Set<string>) => { let n = 0; ids?.forEach((id) => { if (among.has(id)) n++; }); return n; };
  const totalActive = fieldIds.size;
  const affectedToday = countIn(peopleIdsByDay.get(trackedDay), fieldIds);
  const absentToday = countIn(absentIdsByDay.get(trackedDay), fieldIds);
  const subAffectedToday = countIn(peopleIdsByDay.get(trackedDay), subIds);
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

  function eventMatchesWorksiteFilters(e: PlanningEv) {
    if (worksiteFilter && e.worksite.id !== worksiteFilter) return false;
    if (worksiteStatusFilter && !statusFilteredWorksiteIds.has(e.worksite.id)) return false;
    return true;
  }

  const workerRows = useMemo(() => people.filter((p) => {
    if (q && !personLabel(p).toLowerCase().includes(q) && !specialtyLabel(p).toLowerCase().includes(q)) return false;
    if (specialtyFilter && specialtyLabel(p) !== specialtyFilter) return false;
    if ((worksiteFilter || worksiteStatusFilter) && !events.some((e) => eventMatchesWorksiteFilters(e) && e.assignments.some((a) => a.person.id === p.id))) return false;
    if (onlyFree) {
      if (!isFieldWorker(p)) return false; // « libres » = ouvriers uniquement
      const affected = peopleIdsByDay.get(trackedDay)?.has(p.id);
      const absent = absentIdsByDay.get(trackedDay)?.has(p.id);
      if (affected || absent) return false;
    }
    return true;
  }).sort((a, b) => CAT_ORDER[workforceCategory(a)] - CAT_ORDER[workforceCategory(b)]), [people, q, specialtyFilter, worksiteFilter, worksiteStatusFilter, statusFilteredWorksiteIds, events, onlyFree, peopleIdsByDay, absentIdsByDay, trackedDay]);

  const worksiteRows = useMemo(() => [...statusFilteredWorksites, ...(worksiteFilter ? worksitesClosed.filter((w) => w.id === worksiteFilter) : [])].filter((w) => {
    if (q && !w.ref.toLowerCase().includes(q) && !w.title.toLowerCase().includes(q) && !(w.city ?? '').toLowerCase().includes(q)) return false;
    if (worksiteFilter && w.id !== worksiteFilter) return false;
    return true;
  }), [statusFilteredWorksites, worksitesClosed, q, worksiteFilter]);

  const resourceRows = useMemo(() => resources.filter((r) => {
    if (q && !r.label.toLowerCase().includes(q)) return false;
    if ((worksiteFilter || worksiteStatusFilter) && !events.some((e) => eventMatchesWorksiteFilters(e) && (r.kind === 'vehicle' ? e.vehicles.some((v) => v.vehicle.id === r.id) : e.equipment.some((x) => x.equipment.id === r.id)))) return false;
    return true;
  }), [resources, q, worksiteFilter, worksiteStatusFilter, statusFilteredWorksiteIds, events]);

  function openNew(prefill?: { worksiteId?: string; date?: string; personId?: string; vehicleId?: string; equipmentId?: string }) {
    setAssignmentModal({ existing: null, prefill });
  }
  function openEdit(ev: PlanningEv) {
    setDetailEv(null);
    setAssignmentModal({ existing: ev });
  }
  function openDuplicate(ev: PlanningEv) {
    setDetailEv(null);
    // duplique l'équipe, le(s) véhicule(s)/conducteur(s), le matériel et les notes ; seule la
    // date reste à ajuster (même jour par défaut, à changer dans le formulaire au besoin).
    setAssignmentModal({ existing: null, duplicateFrom: ev });
  }

  function renderChips(dayStr: string, list: PlanningEv[]) {
    return list.map((e) => (
      <button
        key={e.id}
        type="button"
        className={`plan-chip ${e.kind === 'meeting' ? 'kind-meeting' : `tone-${toneFor(e.worksite.id)}`}${e.status === 'tentative' ? ' tentative' : ''}`}
        onClick={() => setDetailEv(e)}
      >
        <span className="t">{hhmm(e.startAt)}–{hhmm(e.endAt)}{e.status === 'tentative' ? ' · ?' : ''}</span>
        <span className="r">{e.kind === 'meeting' ? 'RDV · ' : ''}{e.worksite.ref} · {e.worksite.city ?? e.worksite.title}</span>
        <span className="n">{e.assignments.length} pers.{e.vehicles[0] ? ` · ${e.vehicles[0].vehicle.code ?? e.vehicles[0].vehicle.plate ?? ''}` : ''}</span>
      </button>
    ));
  }

  function navPrev() {
    if (view === 'planning') { setListStart((d) => addDays(d, -14)); setListSpan((n) => n + 14); }
    else if (view === 'month') shiftMonth(-1);
    else if (view === 'day') shiftDay(-1);
    else shiftWeek(-1);
  }
  function navNext() {
    if (view === 'planning') setListSpan((n) => n + 14);
    else if (view === 'month') shiftMonth(1);
    else if (view === 'day') shiftDay(1);
    else shiftWeek(1);
  }
  function navToday() {
    if (view === 'planning') { const t = new Date(); t.setHours(0, 0, 0, 0); setListStart(t); setListSpan(31); setTrackedDay(toDateInput(t)); }
    else if (view === 'month') goTodayMonth();
    else if (view === 'day') setTrackedDay(toDateInput(new Date()));
    else goToday();
  }
  const viewKey = view === 'agenda' ? (periodWeeks === 2 ? '2weeks' : 'week') : view;
  function changeView(v: string) {
    if (v === 'week') { setView('agenda'); setPeriodWeeks(1); }
    else if (v === '2weeks') { setView('agenda'); setPeriodWeeks(2); }
    else if (v === 'worksites') { setView('worksites'); setPeriodWeeks(1); }
    else setView(v as ViewMode);
  }
  const monthLabel = monthAnchor.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });
  const dayLabel = dayView[0]!.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const rangeLabel = view === 'planning'
    ? `Planning · à partir du ${listStart.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : view === 'month'
    ? monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)
    : view === 'day'
    ? dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)
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
            <details className="plan-more-menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.open = false; } }}>
              <summary className="btn">Plus <span aria-hidden="true">⌄</span></summary>
              <div className="plan-more-panel">
                <button className="btn ghost" onClick={() => setAbsenceModal({})}>+ Congé / formation</button>
                {evData?.googleSync && (
                  <>
                    <button className="btn ghost" onClick={() => gcalBackfill()} disabled={gcalBusy} title="Envoie vers Google Agenda les événements jamais synchronisés — ne touche pas à ceux déjà envoyés">
                      {gcalBusy ? 'Synchronisation…' : '↻ Rattraper Google Agenda'}
                    </button>
                    <button className="btn ghost" onClick={() => gcalBackfill(true)} disabled={gcalBusy} title="Réécrit dans Google Agenda les événements à venir déjà envoyés, avec la nouvelle présentation">
                      Mettre à jour le format Google
                    </button>
                  </>
                )}
              </div>
            </details>
            <button className="btn primary" onClick={() => openNew({ date: trackedDay })}>+ Nouvelle affectation</button>
          </div>
        }
      />

      <div className="plan-kpis">
        <div><strong>{totalActive}</strong><span>Ouvriers au planning</span></div>
        <div><strong>{affectedToday}</strong><span>Affectés le {trackedShort}</span></div>
        <div><strong>{freeToday}</strong><span>Libres toute la journée</span></div>
        <div><strong>{subAffectedToday}</strong><span>Sous-traitants affectés (à la demande, hors effectif)</span></div>
        <div><strong>{absentToday}</strong><span>Absences / formations</span></div>
        <div><strong>{vehiclesReservedToday}<small>/{vehicles.length}</small></strong><span>Véhicules réservés</span></div>
      </div>

      <div className="plan-topbar">
        <div className="plan-nav" role="group" aria-label="Navigation dans le temps">
          <button type="button" className="btn" onClick={navPrev} aria-label="Précédent">←</button>
          <button type="button" className="btn" onClick={navToday}>{view === 'month' || view === 'day' || view === 'planning' ? "Aujourd'hui" : 'Cette semaine'}</button>
          <button type="button" className="btn" onClick={navNext} aria-label="Suivant">→</button>
        </div>
        <div className="plan-period">
          {view !== 'month' && view !== 'day' && view !== 'planning' && <button type="button" className="btn plan-expand-toggle" onClick={() => setWide((w) => !w)}>{wide ? 'Réduire' : 'Agrandir le planning'}</button>}
          <label className="plan-view-select">
            <span>Affichage</span>
            <select className="select" value={viewKey} onChange={(e) => changeView(e.target.value)} aria-label="Format d’affichage du planning">
              <option value="planning">Planning (liste)</option>
              <option value="day">Jour</option>
              <option value="week">Semaine</option>
              <option value="2weeks">2 semaines</option>
              <option value="month">Mois</option>
              <optgroup label="Grilles">
                <option value="worksites">Par chantier</option>
                <option value="workers">Par ouvrier et sous-traitant</option>
                <option value="resources">Véhicules et matériel</option>
              </optgroup>
            </select>
          </label>
          <details className="plan-filter-menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); } }}>
            <summary className="btn" title="Recherche et filtres du planning">
              Filtres{(search || worksiteStatusFilter || worksiteFilter) && <span className="plan-filter-count">{Number(Boolean(search)) + Number(Boolean(worksiteStatusFilter)) + Number(Boolean(worksiteFilter))}</span>}
              {worksiteStatusFilter && <span className="plan-filter-active">{WORKSITE_STATUS_LABEL[worksiteStatusFilter as keyof typeof WORKSITE_STATUS_LABEL]}</span>}
              <span aria-hidden="true">⌄</span>
            </summary>
      <div className="plan-filter-panel">
        {view !== 'month' && view !== 'day' && (
          <label className="plan-search">
            <Search size={16} strokeWidth={2} />
            <input aria-label="Rechercher dans le planning" placeholder="Rechercher un chantier, une équipe…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        )}
        {view === 'workers' && (
          <select className="select" value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)}>
            <option value="">Tous</option>
            {specialtyOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select className="select" aria-label="Filtrer les chantiers par statut" value={worksiteStatusFilter} onChange={(e) => { setWorksiteStatusFilter(e.target.value); setWorksiteFilter(''); }}>
          <option value="">Tous les statuts · {worksitesActive.length}</option>
          {WORKSITE_STATUS_OPEN.map((status) => worksiteStatusCounts[status] ? (
            <option key={status} value={status}>{WORKSITE_STATUS_LABEL[status]} · {worksiteStatusCounts[status]}</option>
          ) : null)}
        </select>
        <select className="select" aria-label="Filtrer par chantier" value={worksiteFilter} onChange={(e) => setWorksiteFilter(e.target.value)}>
          <option value="">Tous les chantiers</option>
          {statusFilteredWorksites.map((w) => <option key={w.id} value={w.id}>{w.ref} · {w.title}</option>)}
          {worksitesClosed.length > 0 && (
            <optgroup label="Clôturés / archivés">
              {worksitesClosed.map((w) => <option key={w.id} value={w.id}>{w.ref} · {w.title}</option>)}
            </optgroup>
          )}
        </select>
        {view === 'workers' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
            Libres le {trackedShort}
          </label>
        )}
        <button type="button" className="btn ghost" onClick={() => { setSearch(''); setWorksiteStatusFilter(''); setWorksiteFilter(''); setSpecialtyFilter(''); setOnlyFree(false); }}>Réinitialiser les filtres</button>
      </div>
          </details>

        </div>
      </div>



      {observationWorksites.length > 0 && (
        <button
          type="button"
          className={`plan-observation-callout${worksiteStatusFilter === 'on_hold' ? ' active' : ''}`}
          onClick={() => { setWorksiteStatusFilter('on_hold'); setWorksiteFilter(''); setView('worksites'); }}
        >
          <span className="plan-observation-icon"><Eye size={18} strokeWidth={2} /></span>
          <span>
            <strong>{observationWorksites.length} chantier{observationWorksites.length > 1 ? 's' : ''} à garder sous observation</strong>
            <small>Séchage, contrôle ou attente terrain : les dossiers restent visibles jusqu’à la reprise.</small>
          </span>
          <span className="plan-observation-sites">{observationWorksites.slice(0, 3).map((w) => w.ref).join(' · ')}</span>
          <span className="plan-observation-action">Voir et planifier →</span>
        </button>
      )}

      <div className="plan-datebar">
        <strong>{rangeLabel}</strong>
        <label>
          Journée suivie{' '}
          <input className="input" type="date" value={trackedDay} onChange={(e) => selectTrackedDay(e.target.value)} />
        </label>
      </div>

      {loading && !evData ? <SkeletonRows /> : view === 'planning' ? (
        <PlanningList
          days={listDays}
          events={events.filter((e) => eventMatchesWorksiteFilters(e) && (!search || [e.title, e.worksite.title, e.worksite.ref, ...e.assignments.map((a) => a.person.displayName || a.person.firstName)].join(' ').toLowerCase().includes(q)))}
          absences={absences}
          absenceLabel={(k) => ABSENCE_KIND_LABEL[k as keyof typeof ABSENCE_KIND_LABEL] ?? k}
          busy={loading}
          onOpen={setDetailEv}
          onOpenAbsence={(a) => setAbsenceModal({ existing: a })}
          onLoadMore={() => setListSpan((n) => n + 31)}
          onLoadPrev={() => { setListStart((d) => addDays(d, -14)); setListSpan((n) => n + 14); }}
        />
      ) : view === 'agenda' ? (
        <PlanningAgenda days={weekDays} events={events.filter(e => eventMatchesWorksiteFilters(e) && (!search || [e.title,e.worksite.title,e.worksite.ref,...e.assignments.map(a=>a.person.displayName||a.person.firstName)].join(' ').toLowerCase().includes(search.toLowerCase())))} onOpen={setDetailEv} onNew={date=>openNew({date})} onMove={moveEventToDay} />
      ) : view === 'month' ? (
        <section className="plan-board plan-month-board">
          <div className="plan-month-weekdays">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="plan-month-grid">
            {monthDays.map((d) => {
              const ds = toDateInput(d);
              const outside = d.getMonth() !== monthAnchor.getMonth();
              const isToday = sameDate(ds, toDateInput(new Date()));
              const dayEvents = eventsFor(ds, eventMatchesWorksiteFilters)
                .sort((a, b) => a.startAt.localeCompare(b.startAt));
              const shown = dayEvents.slice(0, 3);
              const extra = dayEvents.length - shown.length;
              return (
                <div
                  key={ds}
                  className={`plan-month-day${outside ? ' outside' : ''}${sameDate(ds, trackedDay) ? ' selected-day' : ''}${isToday ? ' today' : ''}${dragOverDay === ds ? ' drag-over' : ''}`}
                  onClick={() => selectTrackedDay(ds)}
                  onDragOver={(dragEv) => { if (draggingId) { dragEv.preventDefault(); dragEv.dataTransfer.dropEffect = 'move'; setDragOverDay(ds); } }}
                  onDragLeave={() => setDragOverDay((cur) => (cur === ds ? null : cur))}
                  onDrop={(dragEv) => {
                    dragEv.preventDefault();
                    setDragOverDay(null);
                    const id = dragEv.dataTransfer.getData('text/plain');
                    const moved = events.find((x) => x.id === id);
                    if (moved) moveEventToDay(moved, ds);
                  }}
                >
                  <div className="plan-month-daynum">{isToday ? <span className="plan-month-today-dot">{d.getDate()}</span> : d.getDate()}</div>
                  <div className="plan-month-events">
                    {shown.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        draggable
                        title="Glisser pour déplacer à un autre jour"
                        className={`plan-month-chip kind-${e.kind}${e.status === 'tentative' ? ' tentative' : ''}${draggingId === e.id ? ' dragging' : ''}`}
                        onClick={(ev) => { ev.stopPropagation(); setDetailEv(e); }}
                        onDragStart={(dragEv) => { dragEv.dataTransfer.setData('text/plain', e.id); dragEv.dataTransfer.effectAllowed = 'move'; setDraggingId(e.id); }}
                        onDragEnd={() => { setDraggingId(null); setDragOverDay(null); }}
                      >
                        <span className="tm">{hhmm(e.startAt)}</span> {e.kind === 'meeting' ? `RDV · ${e.title || e.worksite.ref}` : e.title || e.worksite.ref}
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
      ) : view === 'day' ? (
        <section className="plan-board" style={{ padding: '1.2rem' }}>
          {(() => {
            const dayEvents = eventsFor(trackedDay, eventMatchesWorksiteFilters)
              .sort((a, b) => a.startAt.localeCompare(b.startAt));
            return dayEvents.length === 0
              ? <p className="muted">Rien de planifié ce jour-là.</p>
              : <div className="plan-day-list">{renderChips(trackedDay, dayEvents)}</div>;
          })()}
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
                    const affected = countIn(peopleIdsByDay.get(ds), fieldIds);
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
                {view === 'workers' && workerRows.map((p, i) => {
                  const cat = workforceCategory(p);
                  const first = i === 0 || workforceCategory(workerRows[i - 1]!) !== cat;
                  return (
                  <Fragment key={p.id}>
                  {first && (
                    <tr className="plan-group-row"><th colSpan={days.length + 1}>{WORKFORCE_CATEGORY_LABEL[cat]} · {workerRows.filter((x) => workforceCategory(x) === cat).length}{CAT_NOTE[cat]}</th></tr>
                  )}
                  <tr>
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
                          ) : cat === 'gestionnaire' || cat === 'bureau' ? (
                            <span className="muted" style={{ fontSize: '0.74rem' }}>{cat === 'gestionnaire' ? 'disponible' : '—'}</span>
                          ) : (
                            <button type="button" className="plan-vacancy" onClick={() => openNew({ personId: p.id, date: ds, worksiteId: worksiteFilter || undefined })}>
                              ＋ Affecter
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  </Fragment>
                  );
                })}

                {view === 'worksites' && worksiteRows.map((w) => (
                  <tr key={w.id}>
                    <th>
                      <span className={`plan-avatar tone-${toneFor(w.id)}`}>{w.ref.slice(0, 2)}</span>
                      <div>
                        <strong><Link href={`/app/chantiers/${w.id}`}>{w.ref}</Link></strong>
                        <div className="plan-row-sub">{w.title}{w.city ? ` · ${w.city}` : ''}</div>
                        <div className="plan-row-status"><StatusBadge status={w.status} /></div>
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
        {view === 'month' || view === 'planning' ? (
          <span><span className="plan-legend-swatch kind-intervention" /> Intervention confirmée</span>
        ) : (
          <span>Chaque couleur correspond à un chantier.</span>
        )}
        <span><span className="plan-legend-swatch kind-meeting" /> Rendez-vous d’affaire (jaune dans toutes les vues et dans Google Agenda)</span>
        <span className="plan-dashed-key">À confirmer</span>
        <span>Congés et formations bloquent l’affectation.</span>
      </div>

      {assignmentModal && (
        <PlanningAssignmentModal
          worksites={worksitesAll}
          people={people}
          vehicles={vehicles}
          equipmentList={equipmentList}
          events={events}
          existing={assignmentModal.existing}
          duplicateFrom={assignmentModal.duplicateFrom}
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
              {renderChips(dayAgenda, eventsFor(dayAgenda, eventMatchesWorksiteFilters).sort((a, b) => a.startAt.localeCompare(b.startAt)))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
