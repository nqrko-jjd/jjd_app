'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Une ligne du diagramme : une barre du jour de début (matin/après-midi) au jour de fin. Les jours sont des dates `AAAA-MM-JJ` (heure de Bruxelles). */
export interface GanttRow {
  id: string; label: string; sub?: string;
  startDay: string; startPart: 0 | 0.5; endDay: string; endPart: 0.5 | 1;
  tentative?: boolean; text?: string;
}

const MIN_DAY_W = 17;
const MAX_DAY_W = 60;
const WEEKEND_W = 12;
const LABEL_W = 190;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const toUtc = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y!, m! - 1, dd!); };
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isWeekend = (d: string) => { const w = new Date(toUtc(d)).getUTCDay(); return w === 0 || w === 6; };
const isoWeek = (d: string) => {
  const t = new Date(toUtc(d)); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
};
const todayBrussels = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Jours ouvrés couverts (en demi-journées = 0,5) par une barre. */
function spanDays(r: GanttRow, days: string[]) {
  const a = days.indexOf(r.startDay); const b = days.indexOf(r.endDay);
  if (a < 0 || b < 0) return 0;
  let n = 0;
  for (let i = a; i <= b; i++) {
    if (isWeekend(days[i]!)) continue;
    const from = i === a ? r.startPart : 0; const to = i === b ? r.endPart : 1;
    n += Math.max(0, to - from);
  }
  return n;
}
const fmtDays = (n: number) => `${String(n).replace('.', ',')} j`;

/** Diagramme de Gantt : une barre par lot / intervention sur un calendrier (week-ends grisés, demi-journées visibles). */
export function GanttChart({ rows }: { rows: GanttRow[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el); setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => {
    if (!rows.length) return null;
    const min = Math.min(...rows.map((r) => toUtc(r.startDay)));
    const max = Math.max(...rows.map((r) => toUtc(r.endDay)));
    const days: string[] = [];
    for (let t = min; t <= max; t += 86_400_000) days.push(toIso(t));
    // la largeur d'un jour s'adapte à l'espace disponible (tout tient sans défiler tant que le chantier reste court)
    const we = days.filter(isWeekend).length;
    const dayW = Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, cw ? (cw - LABEL_W - 2 - we * WEEKEND_W) / Math.max(1, days.length - we) : 34));
    const w = (i: number) => (isWeekend(days[i]!) ? WEEKEND_W : dayW);
    const left: number[] = []; let x = 0;
    for (let i = 0; i < days.length; i++) { left.push(x); x += w(i); }
    const width = x;
    const weeks: { label: string; from: number; to: number }[] = [];
    days.forEach((d, i) => {
      const wk = isoWeek(d); const last = weeks[weeks.length - 1];
      if (last && last.label.startsWith(`S${wk} `)) last.to = i;
      else { const dt = new Date(toUtc(d)); weeks.push({ label: `S${wk} · ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`, from: i, to: i }); }
    });
    const today = todayBrussels(); const ti = days.indexOf(today);
    return { days, left, width, w, weeks, todayX: ti >= 0 ? left[ti]! + w(ti) / 2 : null };
  }, [rows, cw]);

  if (!g) return <p className="muted" style={{ margin: 0 }}>{tr("Rien à afficher.")}</p>;
  const pos = (day: string, part: number) => { const i = g.days.indexOf(day); return g.left[i]! + part * g.w(i); };

  return (
    <div className="gantt" ref={root} role="img" aria-label="Diagramme de Gantt du planning">
      <div className="gantt-scroll">
        <div style={{ width: LABEL_W + g.width, position: 'relative' }}>
          {/* en-tête : semaines puis jours */}
          <div className="gantt-head">
            <div className="gantt-label gantt-corner" style={{ width: LABEL_W }} />
            <div style={{ position: 'relative', width: g.width, height: 44 }}>
              {g.weeks.map((wk) => (
                <div key={wk.label + wk.from} className="gantt-week" style={{ left: g.left[wk.from], width: g.left[wk.to]! + g.w(wk.to) - g.left[wk.from]! }}>{wk.label}</div>
              ))}
              {g.days.map((d, i) => (
                <div key={d} className={`gantt-day${isWeekend(d) ? ' we' : ''}`} style={{ left: g.left[i], width: g.w(i), top: 22 }}>
                  {!isWeekend(d) && <><span>{DOW[new Date(toUtc(d)).getUTCDay()]}</span><b>{Number(d.slice(8))}</b></>}
                </div>
              ))}
            </div>
          </div>
          {/* lignes */}
          {rows.map((r) => {
            const a = pos(r.startDay, r.startPart); const b = pos(r.endDay, r.endPart);
            const n = spanDays(r, g.days);
            return (
              <div key={r.id} className="gantt-row">
                <div className="gantt-label" style={{ width: LABEL_W }} title={r.label}>
                  <div className="gantt-title">{r.label}</div>
                  {r.sub && <div className="gantt-sub">{r.sub}</div>}
                </div>
                <div style={{ position: 'relative', width: g.width, height: 38 }}>
                  {g.days.map((d, i) => isWeekend(d) && <div key={d} className="gantt-we-col" style={{ left: g.left[i], width: g.w(i) }} />)}
                  <div
                    className={`gantt-bar${r.tentative ? ' tentative' : ''}`}
                    style={{ left: a, width: Math.max(8, b - a) }}
                    title={`${r.label} — ${r.text ?? fmtDays(n)}${r.tentative ? ' (à confirmer)' : ''}`}
                  >
                    {b - a > 44 ? (r.text ?? fmtDays(n)) : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {g.todayX !== null && <div className="gantt-today" style={{ left: LABEL_W + g.todayX }} title={tr("Aujourd’hui")} />}
        </div>
      </div>
      <div className="gantt-legend"><span className="gantt-key" /> confirmé <span className="gantt-key tentative" /> à confirmer · <span>matin / après-midi : une demi-journée = une demi-case</span></div>
    </div>
  );
}

/** Heure de Bruxelles d'un instant ISO : { day: AAAA-MM-JJ, minutes depuis minuit }. */
function brussels(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

interface PlanEvent { id: string; title: string | null; kind: string; status: string; startAt: string; endAt: string; allDay?: boolean; assignments?: { person: { displayName: string | null; firstName: string } }[]; note?: string | null }

/** Interventions d'un chantier -> lignes de Gantt. Les créneaux « Lot N — … » sont regroupés en une barre par lot ; les autres ont chacun leur ligne. */
export function eventsToGantt(events: PlanEvent[], max = 24): GanttRow[] {
  const rows: GanttRow[] = [];
  const lots = new Map<string, { evs: PlanEvent[] }>();
  for (const e of events) {
    if (e.kind === 'meeting') continue;
    const m = e.title && /^Lot \d+/.test(e.title) ? e.title : null;
    if (m) { const k = lots.get(m) ?? { evs: [] }; k.evs.push(e); lots.set(m, k); }
    else {
      const s = brussels(e.startAt); const f = brussels(e.endAt);
      rows.push({ id: e.id, label: e.title ?? e.note ?? 'Intervention', sub: who([e]), startDay: s.day, startPart: e.allDay || s.min < 12 * 60 ? 0 : 0.5, endDay: f.day, endPart: e.allDay || f.min > 13 * 60 ? 1 : 0.5, tentative: e.status === 'tentative' });
    }
  }
  for (const [title, { evs }] of lots) {
    const starts = evs.map((e) => ({ e, ...brussels(e.startAt) })).sort((a, b) => a.day.localeCompare(b.day) || a.min - b.min);
    const ends = evs.map((e) => ({ e, ...brussels(e.endAt) })).sort((a, b) => a.day.localeCompare(b.day) || a.min - b.min);
    const s = starts[0]!; const f = ends[ends.length - 1]!;
    rows.push({ id: `lot-${title}`, label: title, sub: who(evs), startDay: s.day, startPart: s.min < 12 * 60 ? 0 : 0.5, endDay: f.day, endPart: f.min > 13 * 60 ? 1 : 0.5, tentative: evs.every((e) => e.status === 'tentative') });
  }
  return rows.sort((a, b) => a.startDay.localeCompare(b.startDay) || a.startPart - b.startPart).slice(0, max);
}
function who(evs: PlanEvent[]) {
  const names = [...new Set(evs.flatMap((e) => (e.assignments ?? []).map((a) => a.person.displayName || a.person.firstName)))];
  return names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') : undefined;
}
