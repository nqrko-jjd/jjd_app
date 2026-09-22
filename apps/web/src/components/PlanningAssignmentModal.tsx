'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { WorksitePicker, type WsPickerOption } from './WorksitePicker';
import {
  PLANNING_EVENT_STATUSES, PLANNING_EVENT_STATUS_LABEL, PERSON_ROLE_LABEL,
} from '@jjd/shared';
import type { PlanningEv, PlanPerson, PlanVehicleRef } from './planningTypes';

interface WsRef { id: string; ref: string; title: string; city: string | null }
interface PersonRef extends PlanPerson { role: string; specialties?: unknown; active: boolean }
interface EquipRef { id: string; name: string }
interface VehicleSel { vehicleId: string; driverPersonId: string }

// Heure LOCALE — jamais toISOString() pour lire une date/heure affichée à l'utilisateur :
// la Belgique est en avance sur UTC (UTC+1/+2), ça décalerait le jour ou l'heure affichés.
function toDateInput(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function toTimeInput(iso: string) { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function combine(date: string, time: string) { return new Date(`${date}T${time}:00`).toISOString(); }
function personLabel(p: PlanPerson) { return p.displayName || p.firstName; }
function specialtyLabel(p: PersonRef) {
  const specs = Array.isArray(p.specialties) ? (p.specialties as string[]) : [];
  return specs[0] || PERSON_ROLE_LABEL[p.role as keyof typeof PERSON_ROLE_LABEL] || p.role;
}
function fmtDayShort(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: 'short' });
}

/** tous les jours (samedi/dimanche compris — les équipes travaillent aussi le week-end) entre
 *  from et until inclus, limité à 31 jours d'écart. */
function daysBetween(from: string, until: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${until}T00:00:00`);
  if (end < start) return [from];
  const out: string[] = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 31) {
    out.push(toDateInput(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out.length ? out : [from];
}

export function PlanningAssignmentModal({
  worksites, people, vehicles, equipmentList, events,
  existing, duplicateFrom, prefill,
  onClose, onSaved,
}: {
  worksites: WsRef[];
  people: PersonRef[];
  vehicles: PlanVehicleRef[];
  equipmentList: EquipRef[];
  events: PlanningEv[];
  existing?: PlanningEv | null;
  /** Affectation source d'un « Dupliquer » : équipe, véhicules/conducteurs, matériel et notes
   *  sont repris tels quels (seule la date reste à ajuster). */
  duplicateFrom?: PlanningEv | null;
  prefill?: { worksiteId?: string; date?: string; personId?: string; vehicleId?: string; equipmentId?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  // source des valeurs par défaut : l'affectation modifiée, ou celle dupliquée — jamais les deux
  const seed = existing ?? duplicateFrom ?? null;
  const initDate = existing
    ? toDateInput(new Date(existing.startAt))
    : prefill?.date ?? (duplicateFrom ? toDateInput(new Date(duplicateFrom.startAt)) : toDateInput(new Date()));
  const [f, setF] = useState(() => ({
    worksiteId: seed?.worksite.id ?? prefill?.worksiteId ?? '',
    date: initDate,
    start: seed ? toTimeInput(seed.startAt) : '08:30',
    end: seed ? toTimeInput(seed.endAt) : '17:00',
    repeatUntil: '',
    status: (existing?.status ?? 'confirmed') as string,
    personIds: seed ? seed.assignments.map((a) => a.person.id) : prefill?.personId ? [prefill.personId] : [],
    leadPersonId: seed?.leadPerson?.id ?? '',
    vehicles: seed
      ? seed.vehicles.map((v): VehicleSel => ({ vehicleId: v.vehicle.id, driverPersonId: v.driver?.id ?? '' }))
      : prefill?.vehicleId ? [{ vehicleId: prefill.vehicleId, driverPersonId: '' }] : [] as VehicleSel[],
    equipmentIds: seed ? seed.equipment.map((e) => e.equipment.id) : (prefill?.equipmentId ? [prefill.equipmentId] : [] as string[]),
    tasksNote: seed?.tasksNote ?? '',
    departureFrom: seed?.departureFrom ?? '',
    departureTime: seed?.departureAt ? toTimeInput(seed.departureAt) : '',
    note: seed?.note ?? '',
    accessNote: seed?.accessNote ?? '',
  }));
  const [workerQuery, setWorkerQuery] = useState('');
  const [equipmentQuery, setEquipmentQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherEvents = useMemo(() => events.filter((e) => e.id !== existing?.id), [events, existing]);
  const eventsOnDay = useMemo(
    () => otherEvents.filter((e) => toDateInput(new Date(e.startAt)) === f.date),
    [otherEvents, f.date],
  );
  const busyPersonIds = useMemo(
    () => new Set(eventsOnDay.flatMap((e) => e.assignments.map((a) => a.person.id))),
    [eventsOnDay],
  );
  const busyVehicleIds = useMemo(
    () => new Set(eventsOnDay.flatMap((e) => e.vehicles.map((v) => v.vehicle.id))),
    [eventsOnDay],
  );
  const busyEquipmentIds = useMemo(
    () => new Set(eventsOnDay.flatMap((e) => e.equipment.map((x) => x.equipment.id))),
    [eventsOnDay],
  );

  // le chantier de l'affectation modifiée/dupliquée peut être clôturé/archivé (donc absent de
  // `worksites`, qui ne liste que les chantiers actifs) : on l'ajoute quand même à la liste,
  // sinon le champ chantier apparaît vide alors que la valeur est bien enregistrée.
  const worksiteOptions = useMemo((): WsPickerOption[] => {
    const extra = seed?.worksite;
    if (extra && !worksites.some((w) => w.id === extra.id)) return [{ ...extra }, ...worksites];
    return worksites;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksites, seed?.worksite.id]);

  const filteredPeople = useMemo(() => {
    const q = workerQuery.trim().toLowerCase();
    const active = people.filter((p) => p.active);
    if (!q) return active;
    return active.filter((p) => personLabel(p).toLowerCase().includes(q) || specialtyLabel(p).toLowerCase().includes(q));
  }, [people, workerQuery]);

  const filteredEquipment = useMemo(() => {
    const q = equipmentQuery.trim().toLowerCase();
    if (!q) return equipmentList;
    return equipmentList.filter((eq) => eq.name.toLowerCase().includes(q));
  }, [equipmentList, equipmentQuery]);

  const selectedPeople = people.filter((p) => f.personIds.includes(p.id));

  function toggleWorker(id: string) {
    setF((cur) => {
      const on = cur.personIds.includes(id);
      const personIds = on ? cur.personIds.filter((x) => x !== id) : [...cur.personIds, id];
      return {
        ...cur, personIds,
        leadPersonId: personIds.includes(cur.leadPersonId) ? cur.leadPersonId : '',
        // un conducteur retiré de l'équipe n'est plus proposé comme conducteur d'un véhicule
        vehicles: cur.vehicles.map((v) => (v.driverPersonId && !personIds.includes(v.driverPersonId) ? { ...v, driverPersonId: '' } : v)),
      };
    });
  }
  function toggleEquipment(id: string) {
    setF((cur) => ({ ...cur, equipmentIds: cur.equipmentIds.includes(id) ? cur.equipmentIds.filter((x) => x !== id) : [...cur.equipmentIds, id] }));
  }
  function toggleVehicle(id: string) {
    setF((cur) => ({
      ...cur,
      vehicles: cur.vehicles.some((v) => v.vehicleId === id)
        ? cur.vehicles.filter((v) => v.vehicleId !== id)
        : [...cur.vehicles, { vehicleId: id, driverPersonId: '' }],
    }));
  }
  function setVehicleDriver(id: string, driverPersonId: string) {
    setF((cur) => ({ ...cur, vehicles: cur.vehicles.map((v) => (v.vehicleId === id ? { ...v, driverPersonId } : v)) }));
  }

  async function submit() {
    if (!f.worksiteId || !f.date || !f.start || !f.end) { setError('Chantier, date et créneau sont requis.'); return; }
    setBusy(true);
    setError(null);
    try {
      const dates = existing ? [f.date] : (f.repeatUntil ? daysBetween(f.date, f.repeatUntil) : [f.date]);
      const base = {
        worksiteId: f.worksiteId,
        allDay: false,
        status: f.status,
        personIds: f.personIds,
        leadPersonId: f.leadPersonId || null,
        // conservé pour compatibilité (anciens usages d'un conducteur unique) : celui du 1er véhicule
        driverPersonId: f.vehicles[0]?.driverPersonId || null,
        vehicles: f.vehicles.map((v) => ({ vehicleId: v.vehicleId, driverPersonId: v.driverPersonId || null })),
        equipmentIds: f.equipmentIds,
        tasksNote: f.tasksNote.trim() || null,
        departureFrom: f.departureFrom.trim() || null,
        note: f.note.trim() || null,
        accessNote: f.accessNote.trim() || null,
      };
      if (existing) {
        await api(`/api/planning/${existing.id}`, {
          method: 'PATCH',
          body: {
            ...base,
            startAt: combine(f.date, f.start),
            endAt: combine(f.date, f.end),
            departureAt: f.departureFrom.trim() && f.departureTime ? combine(f.date, f.departureTime) : null,
          },
        });
      } else {
        for (const d of dates) {
          await api('/api/planning', {
            method: 'POST',
            body: {
              ...base,
              startAt: combine(d, f.start),
              endAt: combine(d, f.end),
              departureAt: f.departureFrom.trim() && f.departureTime ? combine(d, f.departureTime) : null,
            },
          });
        }
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal wiz" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{existing ? 'Modifier l’affectation' : duplicateFrom ? 'Dupliquer l’affectation' : 'Nouvelle affectation'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="wiz-body">
          <div className="plan-form-intro">
            <strong>Une équipe pour cette intervention</strong>
            <p style={{ margin: '0.2rem 0 0' }}>
              {duplicateFrom ? 'Équipe, véhicules et notes repris à l’identique — ajustez la date et le reste au besoin.' : 'Sélectionnez librement les ouvriers, puis réservez les moyens nécessaires.'}
            </p>
          </div>
          {error && <div className="plan-form-error">{error}</div>}

          <fieldset>
            <legend>01 · Chantier & créneau</legend>
            <div className="field full" style={{ marginBottom: '0.85rem' }}>
              <label>Chantier</label>
              <WorksitePicker
                value={f.worksiteId}
                onChange={(v) => setF((cur) => ({ ...cur, worksiteId: v }))}
                options={worksiteOptions}
              />
            </div>
            <div className="wiz-grid">
              <div className="field">
                <label>Date</label>
                <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </div>
              <div className="field">
                <label>Début</label>
                <input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
              </div>
              <div className="field">
                <label>Fin</label>
                <input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
              </div>
              {!existing && (
                <div className="field">
                  <label>Répéter jusqu’au (facultatif)</label>
                  <input className="input" type="date" value={f.repeatUntil} onChange={(e) => setF({ ...f, repeatUntil: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label>Statut</label>
                <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {PLANNING_EVENT_STATUSES.map((s) => <option key={s} value={s}>{PLANNING_EVENT_STATUS_LABEL[s]}</option>)}
                </select>
              </div>
            </div>
            {!existing && <small style={{ display: 'block', marginTop: '0.6rem' }}>Créneau sur une journée. Répétition tous les jours, week-end compris, maximum 31 jours.</small>}
          </fieldset>

          <fieldset>
            <legend>02 · Ouvriers & responsabilités</legend>
            <input className="input" style={{ marginBottom: '0.7rem' }} placeholder="Nom ou métier…" value={workerQuery} onChange={(e) => setWorkerQuery(e.target.value)} />
            <div className="plan-worker-picker">
              {filteredPeople.map((p) => {
                const on = f.personIds.includes(p.id);
                const busyHere = busyPersonIds.has(p.id);
                return (
                  <label key={p.id} className={`plan-worker-option${on ? ' selected' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleWorker(p.id)} />
                    <div>
                      <strong>{personLabel(p)}</strong>
                      <div className="plan-availability" style={{ marginTop: 0 }}>{specialtyLabel(p)}</div>
                      <div className="plan-availability">{busyHere ? `Déjà affecté · ${fmtDayShort(f.date)}` : 'Disponible sur le créneau'}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="plan-selection-count">{f.personIds.length} ouvrier(s) sélectionné(s) · les disponibilités sont contrôlées à l’enregistrement.</div>
            <div className="wiz-grid" style={{ marginTop: '0.85rem' }}>
              <div className="field">
                <label>Référent de l’intervention</label>
                <select className="select" value={f.leadPersonId} onChange={(e) => setF({ ...f, leadPersonId: e.target.value })}>
                  <option value="">Choisir parmi les ouvriers sélectionnés</option>
                  {selectedPeople.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>03 · Véhicules & matériel</legend>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: 'var(--ink-2)', marginBottom: '0.4rem' }}>
              Véhicules — plusieurs possibles, un conducteur par véhicule
            </label>
            <div className="plan-vehicle-picker">
              {vehicles.map((v) => {
                const sel = f.vehicles.find((x) => x.vehicleId === v.id);
                const busyHere = busyVehicleIds.has(v.id);
                const label = [v.code, [v.brand, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || v.plate || '—';
                return (
                  <div key={v.id} className="plan-vehicle-option">
                    <label>
                      <input type="checkbox" checked={!!sel} onChange={() => toggleVehicle(v.id)} />
                      <div>
                        <div>{label}</div>
                        <div className="plan-availability" style={{ marginTop: 2 }}>{busyHere ? `Indisponible · ${fmtDayShort(f.date)}` : 'Disponible'}</div>
                      </div>
                    </label>
                    {sel && (
                      <select
                        className="select driver-select"
                        value={sel.driverPersonId}
                        onChange={(e) => setVehicleDriver(v.id, e.target.value)}
                      >
                        <option value="">Sans conducteur assigné</option>
                        {selectedPeople.map((p) => <option key={p.id} value={p.id}>{personLabel(p)} conduit</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            {vehicles.length === 0 && <p className="muted" style={{ margin: '0 0 0.7rem' }}>Aucun véhicule dans la flotte.</p>}

            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: 'var(--ink-2)', margin: '0.9rem 0 0.4rem' }}>Matériel</label>
            <input className="input" style={{ marginBottom: '0.7rem' }} placeholder="Chercher un matériel…" value={equipmentQuery} onChange={(e) => setEquipmentQuery(e.target.value)} />
            <div className="plan-equipment-picker">
              {filteredEquipment.map((eq) => {
                const on = f.equipmentIds.includes(eq.id);
                const busyHere = busyEquipmentIds.has(eq.id);
                return (
                  <label key={eq.id}>
                    <input type="checkbox" checked={on} onChange={() => toggleEquipment(eq.id)} />
                    <div>
                      <div>{eq.name}</div>
                      <div className="plan-availability" style={{ marginTop: 2 }}>{busyHere ? `Indisponible · ${fmtDayShort(f.date)}` : 'Disponible'}</div>
                    </div>
                  </label>
                );
              })}
              {filteredEquipment.length === 0 && <p className="muted" style={{ margin: 0 }}>Aucun résultat.</p>}
            </div>
          </fieldset>

          <fieldset>
            <legend>04 · Tâches & organisation</legend>
            <div className="field full" style={{ marginBottom: '0.85rem' }}>
              <label>Travaux à réaliser — une tâche par ligne</label>
              <textarea className="input" rows={3} value={f.tasksNote} onChange={(e) => setF({ ...f, tasksNote: e.target.value })} placeholder={'Protéger les parties communes\nPréparer les supports\nContrôler les finitions'} />
            </div>
            <div className="wiz-grid" style={{ marginBottom: '0.85rem' }}>
              <div className="field">
                <label>Rendez-vous / lieu de départ</label>
                <input className="input" value={f.departureFrom} onChange={(e) => setF({ ...f, departureFrom: e.target.value })} placeholder="Dépôt · Ruisbroek" />
              </div>
              <div className="field">
                <label>Heure de départ</label>
                <input className="input" type="time" value={f.departureTime} onChange={(e) => setF({ ...f, departureTime: e.target.value })} />
              </div>
            </div>
            <div className="field full" style={{ marginBottom: '0.85rem' }}>
              <label>Contact sur place / coordination</label>
              <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Julien · coordination JJD" />
            </div>
            <div className="field full">
              <label>Accès, livraison, protections & consignes</label>
              <textarea className="input" rows={3} value={f.accessNote} onChange={(e) => setF({ ...f, accessNote: e.target.value })} placeholder="Clés, parking, accès au lot, EPI, livraison, points de vigilance…" />
            </div>
          </fieldset>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Enregistrement…' : 'Enregistrer dans le planning'}</button>
        </div>
      </div>
    </div>
  );
}
