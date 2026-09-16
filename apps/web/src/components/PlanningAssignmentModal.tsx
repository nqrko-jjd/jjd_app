'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { ComboBox } from './ComboBox';
import {
  PLANNING_EVENT_STATUSES, PLANNING_EVENT_STATUS_LABEL, PERSON_ROLE_LABEL,
} from '@jjd/shared';
import type { PlanningEv, PlanPerson, PlanVehicleRef } from './planningTypes';

interface WsRef { id: string; ref: string; title: string; city: string | null }
interface PersonRef extends PlanPerson { role: string; specialties?: unknown; active: boolean }
interface EquipRef { id: string; name: string }

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

/** jours ouvrés (lun-ven) entre from et until inclus, limité à 31 jours d'écart. */
function weekdaysBetween(from: string, until: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${until}T00:00:00`);
  if (end < start) return [from];
  const out: string[] = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 62) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) out.push(toDateInput(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out.length ? out : [from];
}

export function PlanningAssignmentModal({
  worksites, people, vehicles, equipmentList, events,
  existing, prefill,
  onClose, onSaved,
}: {
  worksites: WsRef[];
  people: PersonRef[];
  vehicles: PlanVehicleRef[];
  equipmentList: EquipRef[];
  events: PlanningEv[];
  existing?: PlanningEv | null;
  prefill?: { worksiteId?: string; date?: string; personId?: string; vehicleId?: string; equipmentId?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const initDate = existing ? toDateInput(new Date(existing.startAt)) : prefill?.date ?? toDateInput(new Date());
  const [f, setF] = useState(() => ({
    worksiteId: existing?.worksite.id ?? prefill?.worksiteId ?? '',
    date: initDate,
    start: existing ? toTimeInput(existing.startAt) : '08:00',
    end: existing ? toTimeInput(existing.endAt) : '16:30',
    repeatUntil: '',
    status: (existing?.status ?? 'confirmed') as string,
    personIds: existing ? existing.assignments.map((a) => a.person.id) : prefill?.personId ? [prefill.personId] : [],
    leadPersonId: existing?.leadPerson?.id ?? '',
    driverPersonId: existing?.driverPerson?.id ?? '',
    vehicleId: existing?.vehicles[0]?.vehicle.id ?? prefill?.vehicleId ?? '',
    equipmentIds: existing ? existing.equipment.map((e) => e.equipment.id) : (prefill?.equipmentId ? [prefill.equipmentId] : [] as string[]),
    tasksNote: existing?.tasksNote ?? '',
    departureFrom: existing?.departureFrom ?? '',
    departureTime: existing?.departureAt ? toTimeInput(existing.departureAt) : '',
    note: existing?.note ?? '',
    accessNote: existing?.accessNote ?? '',
  }));
  const [workerQuery, setWorkerQuery] = useState('');
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

  const filteredPeople = useMemo(() => {
    const q = workerQuery.trim().toLowerCase();
    const active = people.filter((p) => p.active);
    if (!q) return active;
    return active.filter((p) => personLabel(p).toLowerCase().includes(q) || specialtyLabel(p).toLowerCase().includes(q));
  }, [people, workerQuery]);

  function toggleWorker(id: string) {
    setF((cur) => {
      const on = cur.personIds.includes(id);
      const personIds = on ? cur.personIds.filter((x) => x !== id) : [...cur.personIds, id];
      return {
        ...cur, personIds,
        leadPersonId: personIds.includes(cur.leadPersonId) ? cur.leadPersonId : '',
        driverPersonId: personIds.includes(cur.driverPersonId) ? cur.driverPersonId : '',
      };
    });
  }
  function toggleEquipment(id: string) {
    setF((cur) => ({ ...cur, equipmentIds: cur.equipmentIds.includes(id) ? cur.equipmentIds.filter((x) => x !== id) : [...cur.equipmentIds, id] }));
  }

  async function submit() {
    if (!f.worksiteId || !f.date || !f.start || !f.end) { setError('Chantier, date et créneau sont requis.'); return; }
    setBusy(true);
    setError(null);
    try {
      const dates = existing ? [f.date] : (f.repeatUntil ? weekdaysBetween(f.date, f.repeatUntil) : [f.date]);
      const base = {
        worksiteId: f.worksiteId,
        allDay: false,
        status: f.status,
        personIds: f.personIds,
        leadPersonId: f.leadPersonId || null,
        driverPersonId: f.driverPersonId || null,
        vehicleIds: f.vehicleId ? [f.vehicleId] : [],
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
          <h2>{existing ? 'Modifier l’affectation' : 'Nouvelle affectation'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="wiz-body">
          <div className="plan-form-intro">
            <strong>Une équipe pour cette intervention</strong>
            <p style={{ margin: '0.2rem 0 0' }}>Sélectionnez librement les ouvriers, puis réservez les moyens nécessaires.</p>
          </div>
          {error && <div className="plan-form-error">{error}</div>}

          <fieldset>
            <legend>01 · Chantier & créneau</legend>
            <div className="field full" style={{ marginBottom: '0.85rem' }}>
              <label>Chantier</label>
              <ComboBox
                placeholder="chercher un chantier (réf ou nom)…"
                value={f.worksiteId}
                onChange={(v) => setF((cur) => ({ ...cur, worksiteId: v }))}
                options={worksites.map((w) => ({ value: w.id, label: `${w.ref} · ${w.title} · ${w.city ?? ''}` }))}
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
            {!existing && <small style={{ display: 'block', marginTop: '0.6rem' }}>Créneau sur une journée. Répétition les jours ouvrés, maximum 31 jours.</small>}
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
                  {people.filter((p) => f.personIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Conducteur</label>
                <select className="select" value={f.driverPersonId} onChange={(e) => setF({ ...f, driverPersonId: e.target.value })}>
                  <option value="">Sans conducteur</option>
                  {people.filter((p) => f.personIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>03 · Véhicule & matériel</legend>
            <div className="field full" style={{ marginBottom: '0.4rem' }}>
              <label>Véhicule</label>
              <select className="select" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
                <option value="">Sans véhicule réservé / accès autonome</option>
                {vehicles.map((v) => {
                  const label = [v.code, [v.brand, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
                  return <option key={v.id} value={v.id}>{label || v.plate || '—'}</option>;
                })}
              </select>
            </div>
            <small style={{ display: 'block', marginBottom: '0.7rem' }}>
              {f.vehicleId
                ? (busyVehicleIds.has(f.vehicleId) ? `Indisponible · ${fmtDayShort(f.date)}` : 'Disponible')
                : 'Aucun véhicule réservé'}
            </small>
            <div className="plan-equipment-picker">
              {equipmentList.map((eq) => {
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
