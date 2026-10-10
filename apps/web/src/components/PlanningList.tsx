'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useRef, useState } from 'react';
import type { PlanningEv, PlanAbsence } from './planningTypes';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Plafond de la liste (≈ 2 ans) : au-delà, plus de chargement. */
const MAX_DAYS = 730;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const personName = (p: { displayName: string | null; firstName: string }) => p.displayName || p.firstName;

/** Titre complet comme dans Google Agenda : « R-494 - Chantier - Créneau », sans répéter ce qui est déjà dedans. */
function fullTitle(ev: PlanningEv) {
  const parts = [ev.worksite.ref, ev.worksite.title];
  if (ev.title && !ev.worksite.title.toLowerCase().includes(ev.title.toLowerCase())) parts.push(ev.title);
  return parts.filter(Boolean).join(' - ');
}

const joinNames = (l: string[]) => (l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`);
const minutes = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

/** Les interventions d'un même chantier le même jour (matin / après-midi, plusieurs équipes) forment UNE ligne ; les rendez-vous restent seuls. */
interface Row { key: string; evs: PlanningEv[]; start: string; end: string; }
function buildRows(evs: PlanningEv[]): Row[] {
  const rows: Row[] = [];
  for (const e of evs) {
    const row = e.kind === 'intervention' ? rows.find((r) => r.evs[0]!.kind === 'intervention' && r.evs[0]!.worksite.id === e.worksite.id) : undefined;
    if (row) {
      row.evs.push(e);
      if (e.startAt < row.start) row.start = e.startAt;
      if (e.endAt > row.end) row.end = e.endAt;
    } else rows.push({ key: e.id, evs: [e], start: e.startAt, end: e.endAt });
  }
  return rows;
}
/** AM / PM / horaire d'un créneau, seulement quand les créneaux de la ligne n'ont pas tous le même horaire */
function slotTag(ev: PlanningEv, row: Row) {
  const same = row.evs.every((x) => x.startAt === row.evs[0]!.startAt && x.endAt === row.evs[0]!.endAt);
  if (same || ev.allDay) return '';
  if (minutes(ev.endAt) <= 13 * 60) return 'AM';
  if (minutes(ev.startAt) >= 12 * 60) return 'PM';
  return ev.startAt === row.start && ev.endAt === row.end ? '' : `${hhmm(ev.startAt)}–${hhmm(ev.endAt)}`;
}
const slotNames = (ev: PlanningEv) => joinNames(ev.assignments.map((a) => personName(a.person))) || (ev.team ? ev.team.name : '');

/** Titre d'une ligne regroupée : le titre propre aux créneaux n'apparaît que s'il est unique. */
function groupTitle(row: Row) {
  if (row.evs.length === 1) return fullTitle(row.evs[0]!);
  const w = row.evs[0]!.worksite;
  const titles = [...new Set(row.evs.map((e) => e.title ?? '').filter((t) => t && !w.title.toLowerCase().includes(t.toLowerCase())))];
  return [w.ref, w.title, titles.length === 1 ? titles[0] : ''].filter(Boolean).join(' - ');
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
  const [open, setOpen] = useState<Set<string>>(new Set());
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;
  const state = useRef({ busy, capped: false });
  const capped = days.length >= MAX_DAYS;
  state.current = { busy, capped };
  // chargement automatique en descendant : UNE fois à chaque fois que le bas de la liste entre dans l'écran (observateur créé une seule fois).
  // Sans cela, une liste courte (peu d'événements à venir) laisserait le bas toujours visible et enchaînerait les chargements sans fin.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    let inView = false;
    const io = new IntersectionObserver((entries) => {
      const now = entries.some((e) => e.isIntersecting);
      if (now && !inView && !state.current.busy && !state.current.capped) loadMore.current();
      inView = now;
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const today = dayKey(new Date());
  const endLabel = days.length ? days[days.length - 1]!.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const lastEvent = events.reduce<string | null>((m, e) => (!m || e.startAt > m ? e.startAt : m), null);
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
                <span className="plan-list-time">{tr("Toute la journée")}</span>
                <span className="plan-list-title"><strong>{absenceLabel(a.kind)}</strong> {personName(a.person)}</span>
                <span className="plan-list-where" /><span className="plan-list-people" />
              </button>
            ))}
            {buildRows(evs).map((row) => {
              const ev = row.evs[0]!;
              const multi = row.evs.length > 1;
              const where = ev.kind === 'meeting' && !ev.meetingOnSite
                ? [ev.meetingAddress, ev.meetingCity].filter(Boolean).join(', ')
                : [ev.worksite.address, ev.worksite.city].filter(Boolean).join(', ');
              const people = multi
                ? row.evs.map((x) => { const n = slotNames(x); const t = slotTag(x, row); return n ? (t ? `${n} (${t})` : n) : ''; }).filter(Boolean).join(' · ')
                : ev.assignments.map((a) => personName(a.person)).join(', ');
              const tentative = row.evs.every((x) => x.status === 'tentative');
              const expanded = multi && open.has(row.key);
              return (
                <div key={row.key} className="plan-list-group">
                  <button
                    type="button"
                    className={`plan-list-row kind-${ev.kind}${tentative ? ' tentative' : ''}`}
                    onClick={() => (multi ? setOpen((o) => { const n = new Set(o); if (n.has(row.key)) n.delete(row.key); else n.add(row.key); return n; }) : onOpen(ev))}
                  >
                    <span className="plan-list-dot" />
                    <span className="plan-list-time">{ev.allDay && !multi ? tr("Toute la journée") : `${hhmm(row.start)} – ${hhmm(row.end)}`}</span>
                    <span className="plan-list-title">{groupTitle(row)}{tentative ? ' · à confirmer' : ''}{multi ? ` · ${row.evs.length} créneaux ${expanded ? '▴' : '▾'}` : ''}</span>
                    <span className="plan-list-where">{where}</span>
                    <span className="plan-list-people" title={people}>{people || 'Équipe à affecter'}</span>
                  </button>
                  {expanded && row.evs.map((x) => (
                    <button key={x.id} type="button" className={`plan-list-row plan-list-sub kind-${x.kind}${x.status === 'tentative' ? ' tentative' : ''}`} onClick={() => onOpen(x)}>
                      <span />
                      <span className="plan-list-time">{x.allDay ? tr("Toute la journée") : `${hhmm(x.startAt)} – ${hhmm(x.endAt)}`}</span>
                      <span className="plan-list-title">{[slotTag(x, row), x.title].filter(Boolean).join(' · ') || 'Créneau'}</span>
                      <span className="plan-list-where" />
                      <span className="plan-list-people">{slotNames(x) || 'Équipe à affecter'}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div className="plan-list-empty" style={{ padding: '1.4rem' }}>Rien de planifié sur cette période.</div>}
      <div ref={sentinel} className="plan-list-end">
        {busy ? 'Chargement…' : capped ? 'Fin de la liste (2 ans affichés).' : (
          <div>
            <div style={{ marginBottom: '0.3rem' }}>
              {lastEvent ? `Dernier événement : ${new Date(lastEvent).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })}` : 'Rien de planifié sur cette période'} · affiché jusqu’au {endLabel}
            </div>
            <button type="button" className="plan-list-more" onClick={onLoadMore}>Charger {days.length >= 31 ? 'un mois de plus' : 'la suite'} ↓</button>
          </div>
        )}
      </div>
    </section>
  );
}
