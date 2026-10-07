'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { Avatar } from '@/lib/ui';
import { formatHours } from '@jjd/shared';
import { CalendarCheck } from 'lucide-react';

interface Proposal {
  key: string; date: string; personId: string; personName: string; photoThumbUrl: string | null;
  worksiteId: string; worksiteRef: string; worksiteTitle: string;
  slots: { start: string; end: string; allDay: boolean }[]; hours: number; pauseMinutes: number;
  state: 'open' | 'covered'; covered?: { hours: number | null; status: string };
}
interface PlannedData { items: Proposal[]; summary: { open: number; covered: number; hours: number }; perDay: Record<string, number> }

// jour LOCAL (jamais toISOString : la Belgique est en avance sur UTC)
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayLabel = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric' });
const longDay = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
const STATUS_FR: Record<string, string> = { running: 'en cours', submitted: 'à valider', approved: 'validé' };

/**
 * Pointage « d'après le planning » : pour un jour, chaque ouvrier affecté à une intervention a une ligne avec les heures prévues.
 * En fin de journée, le bureau (ou le chef de chantier) valide d'un clic — toute la journée, une sélection, ou ligne par ligne,
 * heures modifiables. Rien n'est enregistré avant cette validation ; les heures prévues non validées sont visibles dans les décomptes.
 */
export function PlannedTimesheet({ onChanged }: { onChanged: () => void }) {
  const today = useMemo(() => ymd(new Date()), []);
  const [day, setDay] = useState(today);
  const [hoursEdit, setHoursEdit] = useState<Record<string, string>>({});
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const strip = useApi<PlannedData>(`/api/timesheet/planned?from=${ymd(addDays(new Date(), -6))}&to=${today}`);
  const { data, loading, reload } = useApi<PlannedData>(`/api/timesheet/planned?date=${day}`);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => ymd(addDays(new Date(), i - 6))), []);

  const items = data?.items ?? [];
  const open = items.filter((i) => i.state === 'open');
  const selected = open.filter((i) => !unchecked.has(i.key));
  const hoursOf = (i: Proposal) => {
    const raw = hoursEdit[i.key];
    const n = raw === undefined || raw === '' ? i.hours : Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : i.hours;
  };
  const totalSel = selected.reduce((s, i) => s + hoursOf(i), 0);

  const byWorksite = useMemo(() => {
    const m = new Map<string, { ref: string; title: string; rows: Proposal[] }>();
    for (const i of items) {
      const g = m.get(i.worksiteId) ?? { ref: i.worksiteRef, title: i.worksiteTitle, rows: [] };
      g.rows.push(i);
      m.set(i.worksiteId, g);
    }
    return [...m.values()];
  }, [items]);

  function done(text: string) {
    setFlash({ ok: true, text });
    setHoursEdit({});
    reload(); strip.reload(); onChanged();
  }
  async function run(path: string, body: unknown, okText: (r: { created: number; skipped?: number; hours?: number }) => string) {
    setBusy(true); setFlash(null);
    try {
      const r = await api<{ created: number; skipped?: number; hours?: number }>(path, { method: 'POST', body });
      done(okText(r));
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : 'Action impossible.' });
    } finally { setBusy(false); }
  }
  const payload = (list: Proposal[], withHours: boolean) => ({
    items: list.map((i) => ({ personId: i.personId, worksiteId: i.worksiteId, date: i.date, ...(withHours ? { hours: hoursOf(i) } : {}) })),
  });

  const validateOne = (i: Proposal) => run('/api/timesheet/planned/validate', payload([i], true), () => `${i.personName} : ${formatHours(hoursOf(i))} validées.`);
  const dismissOne = (i: Proposal) => run('/api/timesheet/planned/dismiss', payload([i], false), () => `${i.personName} : marqué « n’a pas travaillé ».`);
  const validateSelection = () => run('/api/timesheet/planned/validate', payload(selected, true), (r) => `${r.created} pointage(s) validé(s) pour ${longDay(day)}${r.skipped ? ` (${r.skipped} déjà traité(s))` : ''}.`);
  const validateDay = () => run('/api/timesheet/planned/validate-day', { date: day }, (r) => `Journée du ${longDay(day)} validée : ${r.created} pointage(s), ${formatHours(r.hours ?? 0)}.`);

  const pendingDays = Object.values(strip.data?.perDay ?? {}).reduce((a, b) => a + b, 0);

  return (
    <section className="card" style={{ marginBottom: '1.4rem', overflow: 'hidden' }}>
      <div className="row" style={{ alignItems: 'center', gap: '0.7rem', padding: '0.9rem 1.1rem', cursor: 'pointer' }} onClick={() => setCollapsed((c) => !c)}>
        <span style={{ width: 16, color: 'var(--ink-3)' }}>{collapsed ? '▸' : '▾'}</span>
        <CalendarCheck size={18} strokeWidth={2} />
        <strong>D’après le planning</strong>
        <span className="hint">
          {pendingDays > 0 ? `${pendingDays} ligne${pendingDays > 1 ? 's' : ''} à valider sur les 7 derniers jours` : 'Tout est à jour sur les 7 derniers jours'}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 1.1rem 1.1rem' }}>
          <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.9rem' }} role="group" aria-label="Choisir le jour">
            {days.map((d) => {
              const n = strip.data?.perDay[d] ?? 0;
              return (
                <button key={d} type="button" className={`btn${d === day ? ' primary' : ''}`} onClick={() => { setDay(d); setUnchecked(new Set()); setHoursEdit({}); setFlash(null); }} style={{ padding: '0.3rem 0.65rem' }}>
                  {d === today ? 'Aujourd’hui' : dayLabel(d)}
                  {n > 0 && <span className="badge warn" style={{ marginLeft: '0.4rem' }}>{n}</span>}
                </button>
              );
            })}
          </div>

          {flash && <p className={flash.ok ? 'state' : 'state error'} role="status" style={{ margin: '0 0 0.8rem' }}>{flash.text}</p>}
          {loading && !data && <p className="muted">Chargement…</p>}

          {data && items.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Aucune intervention avec des ouvriers affectés le {longDay(day)}. <Link href="/app/planning">Ouvrir le planning</Link> · ou saisis des heures à la main avec le bouton « Saisir des heures ».
            </p>
          )}

          {open.length > 0 && (
            <div className="row" style={{ gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
              <button className="btn primary" disabled={busy} onClick={validateDay}>
                Valider la journée · {open.length} ligne{open.length > 1 ? 's' : ''} · {formatHours(data!.summary.hours)}
              </button>
              {selected.length !== open.length && (
                <button className="btn" disabled={busy || selected.length === 0} onClick={validateSelection}>Valider la sélection ({selected.length} · {formatHours(totalSel)})</button>
              )}
              <span className="hint">Heures du planning moins 30 min de pause ; modifiables ligne par ligne.</span>
            </div>
          )}

          {byWorksite.map((g) => (
            <div key={g.ref} style={{ marginBottom: '0.9rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}><span className="mono">{g.ref}</span> {g.title}</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    {g.rows.map((i) => {
                      const isOpen = i.state === 'open';
                      return (
                        <tr key={i.key} style={isOpen ? undefined : { opacity: 0.65 }}>
                          <td style={{ width: 28 }}>
                            {isOpen && (
                              <input
                                type="checkbox" aria-label={`Sélectionner ${i.personName}`}
                                checked={!unchecked.has(i.key)}
                                onChange={() => setUnchecked((u) => { const n = new Set(u); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })}
                              />
                            )}
                          </td>
                          <td><Avatar src={i.photoThumbUrl} label={i.personName} /> <strong>{i.personName}</strong></td>
                          <td className="muted" style={{ fontSize: '0.85rem' }}>{i.slots.map((s) => (s.allDay ? 'journée' : `${s.start}–${s.end}`)).join(' + ')}</td>
                          {isOpen ? (
                            <>
                              <td style={{ width: 110 }}>
                                <input
                                  className="input" inputMode="decimal" style={{ width: 80, textAlign: 'right' }}
                                  aria-label={`Heures de ${i.personName}`}
                                  value={hoursEdit[i.key] ?? String(i.hours).replace('.', ',')}
                                  onChange={(e) => setHoursEdit((h) => ({ ...h, [i.key]: e.target.value }))}
                                />{' '}<span className="muted">h</span>
                              </td>
                              <td>
                                <div className="row" style={{ gap: '0.3rem', justifyContent: 'flex-end' }}>
                                  <button className="btn primary" style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem' }} disabled={busy} onClick={() => validateOne(i)}>Valider</button>
                                  <button className="btn" style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem' }} disabled={busy} onClick={() => dismissOne(i)} title="Absent, malade, resté au dépôt… : aucune heure comptée">N’a pas travaillé</button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <td colSpan={2} className="muted" style={{ textAlign: 'right', fontSize: '0.82rem' }}>
                              Déjà pointé · {formatHours(i.covered?.hours ?? 0)} ({STATUS_FR[i.covered?.status ?? ''] ?? i.covered?.status})
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
