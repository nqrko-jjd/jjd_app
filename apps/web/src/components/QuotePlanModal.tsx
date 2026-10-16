'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useMemo, useState } from 'react';
import { GanttChart, type GanttRow } from './GanttChart';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { formatEur } from '@/lib/ui';

interface Lot { title: string; budgetHt: number; labourHt: number; materialHt: number; manDays: number; days: number }
interface Slot { lot: number; title: string; date: string; start: string; end: string }
interface Preview {
  quote: { number: string | null; totalHt: number }; worksite: { id: string; ref: string; title: string };
  params: { startDate: string; teamSize: number; dayRate: number; labourShare: number };
  lots: Lot[]; slots: Slot[]; totalDays: number; endDate: string; existing: number; confirmed: number;
}
const dayFr = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
const KEY = 'jjd-plan-params';

/**
 * Planning prévisionnel d'après le budget du devis : on règle les hypothèses (équipe, prix d'une journée, part de main-d'œuvre, date de départ),
 * l'aperçu se recalcule, puis on enregistre le PROGRAMME du chantier (onglet Planning du chantier, en Gantt). Rien n'est écrit dans le planning des équipes
 * ni dans Google Agenda : on l'y crée plus tard, après validation, depuis le chantier.
 */
export function QuotePlanModal({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const [startDate, setStartDate] = useState('');
  const [teamSize, setTeamSize] = useState('2');
  const [dayRate, setDayRate] = useState('380');
  const [share, setShare] = useState('50');
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; endDate: string; worksiteId: string } | null>(null);

  useEffect(() => {
    try { const k = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (k) { setTeamSize(String(k.teamSize)); setDayRate(String(k.dayRate)); setShare(String(k.share)); } } catch { /* ignoré */ }
  }, []);

  const body = useMemo(() => ({
    ...(startDate ? { startDate } : {}),
    teamSize: Math.max(1, Math.round(Number(teamSize) || 1)),
    dayRate: Number(dayRate.replace(',', '.')) || 380,
    labourShare: Math.min(95, Math.max(5, Number(share) || 50)) / 100,
  }), [startDate, teamSize, dayRate, share]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api<Preview>(`/api/quote-tools/${quoteId}/plan/preview`, { method: 'POST', body });
        if (cancelled) return;
        setPv(r); setErr(null);
        if (!startDate) setStartDate(r.params.startDate);
      } catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : 'Calcul impossible.'); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [quoteId, body, startDate]);

  // une barre par lot : du premier créneau (matin / après-midi) au dernier
  const ganttRows: GanttRow[] = useMemo(() => {
    if (!pv) return [];
    return pv.lots.flatMap((l, i): GanttRow[] => {
      const s = pv.slots.filter((x) => x.lot === i + 1);
      if (!s.length) return [];
      const first = s[0]!; const last = s[s.length - 1]!;
      return [{ id: String(i), label: l.title, sub: `${l.manDays} j d’ouvrier · ${formatEur(l.budgetHt)}`, startDay: first.date, startPart: first.start < '12:00' ? 0 : 0.5, endDay: last.date, endPart: last.end <= '13:00' ? 0.5 : 1, tentative: true, text: `${String(l.days).replace('.', ',')} j` }];
    });
  }, [pv]);

  async function create(replace: boolean) {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ created: number; endDate: string; worksiteId: string }>(`/api/quote-tools/${quoteId}/plan/create`, { method: 'POST', body: { ...body, replace } });
      try { localStorage.setItem(KEY, JSON.stringify({ teamSize: body.teamSize, dayRate: body.dayRate, share: Math.round(body.labourShare * 100) })); } catch { /* ignoré */ }
      setDone(r);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Création impossible.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 980, maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Programme prévisionnel d’après le devis</h2><button className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button></div>
        <div style={{ padding: '1rem', display: 'grid', gap: '0.9rem' }}>
          {done ? (
            <>
              <p className="state" role="status">Programme enregistré : {done.created} lot{done.created > 1 ? 's' : ''}, jusqu’au {dayFr(done.endDate)}.</p>
              <p className="muted" style={{ margin: 0 }}>Il s’affiche dans l’onglet Planning du chantier (diagramme de Gantt). <strong>Rien n’a été écrit dans le planning des équipes ni dans Google Agenda</strong> : tu pourras ajuster les dates, puis le créer dans le planning quand tu le valides.</p>
              <div className="row"><Link className="btn primary" href={`/app/chantiers/${done.worksiteId}?tab=planning`}>Voir le programme du chantier</Link><button className="btn" onClick={onClose}>{tr("Fermer")}</button></div>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
                Les journées d’ouvrier se déduisent du budget : part de main-d’œuvre de chaque lot ÷ prix d’une journée, réparties sur l’équipe, posées à la suite sur les jours ouvrables (hors week-ends et jours fériés).
                C’est une proposition à ajuster, pas un engagement.
              </p>
              <div className="wiz-grid">
                <div className="field"><label>Début des travaux</label><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                <div className="field"><label>Ouvriers sur le chantier</label><input className="input" type="number" min={1} max={20} value={teamSize} onChange={(e) => setTeamSize(e.target.value)} /></div>
                <div className="field"><label>Prix d’une journée d’ouvrier (€ HT)</label><input className="input" inputMode="decimal" value={dayRate} onChange={(e) => setDayRate(e.target.value)} /></div>
                <div className="field"><label>Part de main-d’œuvre du budget (%)</label><input className="input" type="number" min={5} max={95} value={share} onChange={(e) => setShare(e.target.value)} /></div>
              </div>

              {err && <p className="state error" role="alert" style={{ margin: 0 }}>{err}</p>}

              {pv && (
                <>
                  <div>
                    <div className="eyebrow" style={{ margin: '0 0 0.4rem' }}>Programme en diagramme de Gantt</div>
                    <GanttChart rows={ganttRows} />
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>Lot</th><th style={{ textAlign: 'right' }}>Budget HT</th><th style={{ textAlign: 'right' }}>Main-d’œuvre</th><th style={{ textAlign: 'right' }}>Journées d’ouvrier</th><th style={{ textAlign: 'right' }}>Durée</th></tr></thead>
                      <tbody>
                        {pv.lots.map((l) => (
                          <tr key={l.title}><td>{l.title}</td><td style={{ textAlign: 'right' }}>{formatEur(l.budgetHt)}</td><td style={{ textAlign: 'right' }}>{formatEur(l.labourHt)}</td><td style={{ textAlign: 'right' }}>{l.manDays}</td><td style={{ textAlign: 'right' }}><strong>{l.days} j</strong></td></tr>
                        ))}
                      </tbody>
                      <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={4}>Durée totale estimée</td><td style={{ textAlign: 'right' }}>{pv.totalDays} j · fin le {dayFr(pv.endDate)}</td></tr></tfoot>
                    </table>
                  </div>
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: '0.86rem' }}>{tr("Voir les")} {pv.slots.length} demi-journées / journées du programme</summary>
                    <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                      {pv.slots.map((s, i) => <li key={i}>{dayFr(s.date)} · {s.start}–{s.end} · Lot {s.lot} — {s.title}</li>)}
                    </ul>
                  </details>

                  {pv.existing > 0 && (
                    <p className="state error" style={{ margin: 0 }}>
                      Un programme existe déjà pour ce devis ({pv.existing} lot{pv.existing > 1 ? 's' : ''}{pv.confirmed ? `, dont ${pv.confirmed} déjà créé${pv.confirmed > 1 ? 's' : ''} dans le planning` : ''}). « Remplacer » ne supprime que les lots pas encore créés dans le planning.
                    </p>
                  )}
                  <div className="row" style={{ gap: '0.5rem' }}>
                    {pv.existing > 0
                      ? <button className="btn primary" disabled={busy} onClick={() => create(true)}>{busy ? 'Enregistrement…' : 'Remplacer le programme'}</button>
                      : <button className="btn primary" disabled={busy} onClick={() => create(false)}>{busy ? 'Enregistrement…' : `Enregistrer le programme (${pv.lots.length} lots)`}</button>}
                    <button className="btn" onClick={onClose}>{tr("Annuler")}</button>
                  </div>
                </>
              )}
              {!pv && !err && <p className="muted">Calcul en cours…</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
