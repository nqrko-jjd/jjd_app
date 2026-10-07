'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PLANNING_EVENT_STATUS_LABEL, PLANNING_EVENT_KIND_LABEL } from '@jjd/shared';
import type { PlanningEv } from './planningTypes';

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function PlanningEventDetail({
  ev,
  onClose,
  onEdit,
  onDuplicate,
  onDeleted,
}: {
  ev: PlanningEv;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDeleted: () => void;
}) {
  const people = ev.assignments.map((a) => a.person);
  const leadId = ev.leadPerson?.id;
  const isMeeting = ev.kind === 'meeting';
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isMeeting ? 'Rendez-vous' : 'Affectation'} · {ev.worksite.ref}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body" style={{ display: 'block', maxHeight: '72vh', overflowY: 'auto' }}>
          <div className="plan-detail-heading">
            <span className="muted">{fmtDate(ev.startAt)} · {hhmm(ev.startAt)} – {hhmm(ev.endAt)}</span>
            {isMeeting && <span className="badge kind-meeting" style={{ marginLeft: 8, background: 'var(--tone-bg)', color: 'var(--tone-fg)', borderColor: 'var(--tone-line)' }}>{PLANNING_EVENT_KIND_LABEL.meeting}</span>}
            <span className={`badge ${ev.status === 'tentative' ? 'warn' : ''}`} style={{ marginLeft: 8 }}>
              {PLANNING_EVENT_STATUS_LABEL[ev.status as keyof typeof PLANNING_EVENT_STATUS_LABEL] ?? ev.status}
            </span>
            <h2 style={{ margin: '0.5rem 0 0.2rem' }}>{ev.title || ev.worksite.title}</h2>
            <p className="muted" style={{ margin: 0 }}>{[ev.worksite.city, ev.worksite.ref].filter(Boolean).join(' · ')}</p>
          </div>

          {people.length > 0 && (
            <div className="plan-detail-section">
              <h3>{isMeeting ? 'Participants JJD' : 'Équipe de cette intervention'}</h3>
              <div className="plan-crew">
                {people.map((p) => (
                  <span key={p.id}>{p.displayName || p.firstName}{p.id === leadId ? ' · Référent' : ''}</span>
                ))}
              </div>
            </div>
          )}

          {!isMeeting && (
            <div className="plan-detail-columns">
              <section>
                <h3>Véhicule & trajet</h3>
                {ev.vehicles.length > 0 ? (
                  ev.vehicles.map((v) => (
                    <p key={v.vehicle.id} style={{ margin: '0 0 0.3rem' }}>
                      {[v.vehicle.brand, v.vehicle.model].filter(Boolean).join(' ') || v.vehicle.code || v.vehicle.plate}
                      {v.vehicle.code ? ` · ${v.vehicle.code}` : ''}
                      {v.driver && <span className="muted"> · conduit par {v.driver.displayName || v.driver.firstName}</span>}
                    </p>
                  ))
                ) : (
                  <p className="muted" style={{ margin: 0 }}>Accès autonome / sans véhicule réservé</p>
                )}
                {ev.vehicles.length === 0 && ev.driverPerson && <p className="muted" style={{ margin: '0 0 0.2rem' }}>Conducteur : {ev.driverPerson.displayName || ev.driverPerson.firstName}</p>}
                {ev.departureFrom && (
                  <p className="muted" style={{ margin: 0 }}>
                    {ev.departureFrom}{ev.departureAt ? ` · départ ${hhmm(ev.departureAt)}` : ''}
                  </p>
                )}
              </section>
              <section>
                <h3>Matériel réservé</h3>
                {ev.equipment.length > 0 ? ev.equipment.map((e) => <p key={e.equipment.id} style={{ margin: '0 0 0.3rem' }}>{e.equipment.name}</p>) : <p className="muted" style={{ margin: 0 }}>—</p>}
                {ev.consumables.length > 0 && (
                  <p className="muted" style={{ margin: 0 }}>{ev.consumables.map((c) => `${c.consumable.name} · ${c.qty} ${c.consumable.unit}`).join(', ')}</p>
                )}
                {ev.materialsNote && <p className="muted" style={{ margin: '0.3rem 0 0' }}>{ev.materialsNote}</p>}
              </section>
            </div>
          )}

          {isMeeting && (
            <div className="plan-detail-section">
              <h3>Lieu du rendez-vous</h3>
              {ev.meetingOnSite ? (
                <p style={{ margin: 0 }}>
                  Sur place — {[
                    [ev.worksite.address, ev.worksite.box && `bte ${ev.worksite.box}`].filter(Boolean).join(' '),
                    [ev.worksite.postalCode, ev.worksite.city].filter(Boolean).join(' '),
                  ].filter(Boolean).join(', ') || `${ev.worksite.ref} · ${ev.worksite.title}`}
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  {[
                    [ev.meetingAddress, ev.meetingBox && `bte ${ev.meetingBox}`].filter(Boolean).join(' '),
                    [ev.meetingPostalCode, ev.meetingCity].filter(Boolean).join(' '),
                  ].filter(Boolean).join(', ') || <span className="muted">Adresse non renseignée</span>}
                </p>
              )}
            </div>
          )}

          {ev.tasksNote && (
            <div className="plan-detail-section">
              <h3>{isMeeting ? 'Ordre du jour' : 'Travaux à réaliser'}</h3>
              <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {ev.tasksNote.split('\n').map((t) => t.trim()).filter(Boolean).map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            </div>
          )}
          {(ev.note || ev.accessNote) && (
            <div className="plan-detail-section">
              {ev.note && <h3>{isMeeting ? 'Avec qui' : 'Contact & consignes'}</h3>}
              {ev.note && <p style={{ margin: '0 0 0.5rem' }}>{ev.note}</p>}
              {ev.accessNote && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{ev.accessNote}</p>}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            style={{ color: 'var(--crit)', marginRight: 'auto' }}
            onClick={async () => {
              if (!confirm(isMeeting ? 'Retirer ce rendez-vous ?' : 'Retirer cette affectation ?')) return;
              await api(`/api/planning/${ev.id}`, { method: 'DELETE' });
              onDeleted();
            }}
          >
            Retirer
          </button>
          <button className="btn" onClick={onDuplicate}>Dupliquer</button>
          <button className="btn primary" onClick={onEdit}>{isMeeting ? 'Modifier le rendez-vous' : 'Modifier l’affectation'}</button>
        </div>
        <div className="modal-foot" style={{ borderTop: 'none', paddingTop: 0, justifyContent: 'space-between' }}>
          <a href={`/fiche/${ev.id}`} target="_blank" rel="noreferrer" className="hint">Imprimer la fiche →</a>
          <Link href={`/app/chantiers/${ev.worksite.id}`} className="hint">Ouvrir le chantier →</Link>
        </div>
      </div>
    </div>
  );
}
