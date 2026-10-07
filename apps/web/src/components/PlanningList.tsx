'use client';
import { useEffect, useRef } from 'react';
import type { PlanningEv, PlanAbsence } from './planningTypes';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const personName = (p: { displayName: string | null; firstName: string }) => p.displayName || p.firstName;

/** Titre complet comme dans Google Agenda : « R-494 - Chantier - Créneau », sans répéter ce qui est déjà dedans. */
function fullTitle(ev: PlanningEv) {
  const parts = [ev.kind === 'meeting' ? 'RDV' : ev.worksite.ref, ev.worksite.title];
  if (ev.title && !ev.worksite.title.toLowerCase().includes(ev.title.toLowerCase())) parts.push(ev.title);
  return parts.filter(Boolean).join(' - ');
}

/**
 * Vue « Planning » façon Google Agenda (affichage liste) : les jours qui ont quelque chose, avec leurs rendez-vous et travaux,
 * qui défilent sans fin vers le bas (chargement automatique) ; rendez-vous en jaune, travaux en bleu, congés en gris.
 */
export function PlanningList({ days, events, absences, absenceLabel, busy, onOpen, onOpenAbsence, onLoadMore, onLoadPrev }: {
  days: Date[];
  events: PlanningEv[];
  absences: PlanAbsence[];
  absenceLabel: (kind: string) => string;
  busy: boolean;
  onOpen: (ev: PlanningEv) => void;
  onOpenAbsence: (a: PlanAbsence) => void;
  onLoadMore: () => void;
  onLoadPrev: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || busy) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore.current(); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [busy, days.length]);

  const today = dayKey(new Date());
  const byDay = new Map<string, PlanningEv[]>();
  for (const e of events) {
    const k = dayKey(new Date(e.startAt));
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const groups = days.map((d) => {
    const k = dayKey(d);
    const evs = (byDay.get(k) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
    const abs = absences.filter((a) => k >= dayKey(new Date(a.startsOn)) && k <= dayKey(new Date(a.endsOn)));
    return { d, k, evs, abs };
  }).filter((g) => g.evs.length > 0 || g.abs.length > 0 || g.k === today);

  return (
    <section className="plan-list">
      <button type="button" className="plan-list-more" onClick={onLoadPrev}>↑ Jours précédents</button>
      {groups.map(({ d, k, evs, abs }) => (
        <div key={k} className={`plan-list-day${k === today ? ' today' : ''}`}>
          <div className="plan-list-date">
            <strong>{d.getDate()}</strong>
            <small>{d.toLocaleDateString('fr-BE', { month: 'short', weekday: 'short' }).replace('.', '')}</small>
          </div>
          <div className="plan-list-rows">
            {evs.length === 0 && abs.length === 0 && <div className="plan-list-empty">Rien de prévu aujourd’hui</div>}
            {abs.map((a) => (
              <button key={a.id} type="button" className="plan-list-row absence" onClick={() => onOpenAbsence(a)}>
                <span className="plan-list-dot" />
                <span className="plan-list-time">Toute la journée</span>
                <span className="plan-list-title"><strong>{absenceLabel(a.kind)}</strong> {personName(a.person)}</span>
                <span className="plan-list-where" /><span className="plan-list-people" />
              </button>
            ))}
            {evs.map((ev) => {
              const where = ev.kind === 'meeting' && !ev.meetingOnSite
                ? [ev.meetingAddress, ev.meetingCity].filter(Boolean).join(', ')
                : [ev.worksite.address, ev.worksite.city].filter(Boolean).join(', ');
              const names = ev.assignments.map((a) => personName(a.person)).join(', ');
              return (
                <button key={ev.id} type="button" className={`plan-list-row kind-${ev.kind}${ev.status === 'tentative' ? ' tentative' : ''}`} onClick={() => onOpen(ev)}>
                  <span className="plan-list-dot" />
                  <span className="plan-list-time">{ev.allDay ? 'Toute la journée' : `${hhmm(ev.startAt)} – ${hhmm(ev.endAt)}`}</span>
                  <span className="plan-list-title">{fullTitle(ev)}{ev.status === 'tentative' ? ' · à confirmer' : ''}</span>
                  <span className="plan-list-where">{where}</span>
                  <span className="plan-list-people" title={names}>{names || 'Équipe à affecter'}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div className="plan-list-empty" style={{ padding: '1.4rem' }}>Rien de planifié sur cette période.</div>}
      <div ref={sentinel} className="plan-list-end">{busy ? 'Chargement…' : <button type="button" className="plan-list-more" onClick={onLoadMore}>Charger la suite ↓</button>}</div>
    </section>
  );
}
