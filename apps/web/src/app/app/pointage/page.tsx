'use client';
import { tr } from '@/lib/ui-language';
import { SkeletonRows, ErrorState, EmptyState, Banner } from '@/components/States';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE, Kpi, Avatar } from '@/lib/ui';
import { Clock, ClipboardCheck, Building2, Euro, AlertTriangle } from 'lucide-react';
import { ComboBox } from '@/components/ComboBox';
import { PlannedTimesheet } from '@/components/PlannedTimesheet';
import { EntryEditModal } from '@/components/EntryEditModal';
import { formatHours } from '@jjd/shared';

interface Meta { people: { id: string; name: string }[]; worksites: { id: string; name: string }[] }

// Heure LOCALE — jamais toISOString() pour une date par défaut : la Belgique est en avance
// sur UTC (UTC+1/+2), ça décalerait le jour affiché juste après minuit.
function toDateInput(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

interface Pending {
  id: string; worksiteId: string | null; date: string | null; hours: number | null; amount: number | null; task: string | null;
  geoFlag: boolean; geoDistance: number | null; startLat: number | null; startLng: number | null;
  person: { displayName: string | null; firstName: string; photoThumbUrl: string | null };
  worksite: { ref: string; title: string } | null;
}

export default function PointagePage() {
  const { data, loading, error, reload } = useApi<{ items: Pending[] }>('/api/timesheet/pending');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Pending | null>(null);
  const [flash, setFlash] = useState<{ tone: 'success' | 'crit'; text: string } | null>(null);
  // repliés par défaut, une seule personne ouverte à la fois — comme la liste des décomptes du mois
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  async function act(id: string, action: 'approve' | 'reject') {
    try { await api(`/api/timesheet/entries/${id}/${action}`, { method: 'POST' }); reload(); }
    catch(e){setFlash({tone:'crit',text:e instanceof Error?e.message:'Impossible de modifier le pointage.'});}
  }
  async function approveAll() {
    try {
    const r = await api<{ approved: number }>('/api/timesheet/entries/approve-all', { method: 'POST' });
    setFlash({ tone: 'success', text: `${r.approved} pointage(s) validé(s).` });
    reload();
    } catch(e){setFlash({tone:'crit',text:e instanceof Error?e.message:'Validation impossible.'});}
  }
  async function approvePerson(name: string, entries: Pending[]) {
    try {
    // les lignes « hors zone » restent à contrôler une par une, comme pour « Tout valider »
    const ids = entries.filter((e) => !e.geoFlag).map((e) => e.id);
    const skipped = entries.length - ids.length;
    await Promise.all(ids.map((id) => api(`/api/timesheet/entries/${id}/approve`, { method: 'POST' })));
    setFlash({
      tone: 'success',
      text: `${name} : ${ids.length} pointage(s) validé(s)${skipped ? ` — ${skipped} hors zone laissé(s) à contrôler` : ''}.`,
    });
    reload();
    } catch(e){reload();setFlash({tone:'crit',text:e instanceof Error?e.message:'Certaines lignes n’ont pas pu être validées. Vérifiez les lignes restantes.'});}
  }

  const items = data?.items ?? [];
  const totalHours = items.reduce((a, e) => a + (e.hours ?? 0), 0);
  const totalAmount = items.reduce((a, e) => a + (e.amount ?? 0), 0);
  const flagged = items.filter((e) => e.geoFlag).length;
  const worksiteCount = new Set(items.filter((e) => e.worksite).map((e) => e.worksite!.ref)).size;

  // groupe par personne
  const byPerson = new Map<string, Pending[]>();
  for (const e of items) {
    const k = e.person.displayName || e.person.firstName;
    byPerson.set(k, [...(byPerson.get(k) ?? []), e]);
  }

  return (
    <>
      {adding && <TimeEntryModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {editing && <EntryEditModal entry={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      <PageHead
        eyebrow="Suivi du temps"
        title={tr("Pointage")}
        sub="Heures à valider avant le décompte de paie"
        action={
          <div className="row">
            <button className="btn primary" onClick={() => setAdding(true)}><Clock size={15} strokeWidth={2} /> Saisir des heures</button>
            {items.length > 0 && <button className="btn" onClick={approveAll}>Tout valider{flagged ? ' (sauf hors zone)' : ''}</button>}
            <Link href="/app/pointage/decomptes" className="btn">Décomptes du mois →</Link>
          </div>
        }
      />

      {flash && (
        <Banner
          tone={flash.tone}
          title={flash.tone === 'success' ? 'Terminé' : 'Action à vérifier'}
          onClose={() => setFlash(null)}
          action={flash.tone === 'success' ? <Link href="/app/pointage/decomptes">Voir le décompte</Link> : undefined}
        >
          {flash.text}
        </Banner>
      )}

      <PlannedTimesheet onChanged={reload} />

      {items.length > 0 && (
        <div className="kpis" style={{ marginBottom: '1.4rem' }}>
          <Kpi ic={Clock} label={tr("Heures")} value={formatHours(totalHours)} sub={`${byPerson.size} collaborateur${byPerson.size > 1 ? 's' : ''}`} hero />
          <Kpi ic={ClipboardCheck} label={tr("À valider")} value={items.length} sub="Lignes de pointage" />
          <Kpi ic={Building2} label="Chantiers concernés" value={worksiteCount} sub="En attente de validation" />
          <Kpi ic={Euro} label="Montant" value={<Money value={totalAmount} />} sub="HT, avant validation" />
          <Kpi
            ic={AlertTriangle}
            label="Hors zone"
            value={flagged}
            sub={flagged > 0 ? 'À vérifier avant validation' : 'Tous les pointages sont sur site'}
            warn={flagged > 0}
          />
        </div>
      )}

      {loading && <SkeletonRows />}

      {error && !loading && <ErrorState message={error} onRetry={reload} />}
      {data && items.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title={tr("Rien à valider")}
          text="Tous les pointages sont validés. Cette file se remplit dès qu’un ouvrier arrête son compteur, ou quand vous saisissez des heures."
          action={<button className="btn primary" onClick={() => setAdding(true)}>Saisir des heures</button>}
          secondary={<Link href="/app/pointage/decomptes" className="btn">Voir les décomptes du mois</Link>}
        />
      )}

      {[...byPerson.entries()].map(([name, entries]) => {
        const open = openPerson === name;
        const flaggedCount = entries.filter((e) => e.geoFlag).length;
        return (
          <div key={name} className="card" style={{ marginBottom: '0.7rem', overflow: 'hidden' }}>
            <div
              className="row"
              style={{ alignItems: 'center', padding: '0.85rem 1.05rem', cursor: 'pointer', gap: '0.6rem' }}
              onClick={() => setOpenPerson(open ? null : name)}
            >
              <span style={{ width: 16, color: 'var(--ink-3)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
              <Avatar src={entries[0]!.person.photoThumbUrl} label={name} />
              <strong>{name}</strong>
              <span className="hint">
                {entries.length} pointage{entries.length > 1 ? 's' : ''} · {formatHours(entries.reduce((a, e) => a + (e.hours ?? 0), 0))} · <Money value={entries.reduce((a, e) => a + (e.amount ?? 0), 0)} />
              </span>
              {flaggedCount > 0 && <span className="badge crit">{flaggedCount} hors zone</span>}
              <button
                className="btn primary"
                style={{ marginLeft: 'auto' }}
                disabled={entries.every((e) => e.geoFlag)}
                onClick={(ev) => { ev.stopPropagation(); approvePerson(name, entries); }}
                title={entries.some((e) => e.geoFlag) ? 'Valide toutes les lignes sauf celles pointées hors zone' : 'Valide tous les pointages de cette personne'}
              >
                Valider la personne
              </button>
            </div>
            {open && (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>{tr("Date")}</th><th>{tr("Chantier")}</th><th>Tâche</th><th>Lieu</th><th style={{ textAlign: 'right' }}>{tr("Heures")}</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} style={e.geoFlag ? { background: 'var(--warn-soft)' } : undefined}>
                        <td className="tnum">{formatDateBE(e.date)}</td>
                        <td>{e.worksite ? <><span className="mono">{e.worksite.ref}</span> {e.worksite.title}</> : <span className="muted">—</span>}</td>
                        <td className="muted">{e.task ?? '—'}</td>
                        <td>
                          <div className="row" style={{ gap: '0.4rem' }}>
                            {e.geoFlag
                              ? <span className="badge crit" title={`Pointé à ${e.geoDistance} m du chantier`}>Hors zone · {e.geoDistance} m</span>
                              : e.geoDistance != null ? <span className="badge ok">Sur place</span>
                              : <span className="muted" style={{ fontSize: '0.8rem' }}>—</span>}
                            {e.startLat != null && e.startLng != null && (
                              <a href={`https://www.google.com/maps?q=${e.startLat},${e.startLng}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>
                                📍 voir
                              </a>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="tnum">{formatHours(e.hours)}</td>
                        <td style={{ textAlign: 'right' }}><Money value={e.amount} /></td>
                        <td>
                          <div className="row" style={{ gap: '0.3rem' }}>
                            <button className="btn primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => act(e.id, 'approve')}>{tr("Valider")}</button>
                            <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => act(e.id, 'reject')}>{tr("Refuser")}</button>
                            <button className="btn ghost" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => setEditing(e)} title="Corriger les heures, la date ou le chantier">✎ Modifier</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {flagged > 0 && (
        <Banner tone="warn" title={`${flagged} ligne${flagged > 1 ? 's' : ''} hors zone`}>
          Les lignes surlignées ont été pointées loin du chantier de référence. « Tout valider » et « Valider la personne » les
          laissent de côté : vérifiez le lieu (📍 voir) puis validez-les une par une, ou refusez-les.
        </Banner>
      )}
    </>
  );
}

/** Heures - minutes de pause = durée nette, en heures décimales (0 si le créneau ne le permet pas). */
function computeHours(start: string, end: string, pauseMin: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  const net = (eh * 60 + em) - (sh * 60 + sm) - (Number(pauseMin) || 0);
  return net > 0 ? Math.round((net / 60) * 100) / 100 : 0;
}

/**
 * Saisie groupée : un même chantier/créneau pour plusieurs ouvriers à la fois (l'équipe qui a
 * travaillé ensemble ce jour-là) — chacun reçoit sa propre ligne « à valider », comme un
 * pointage terrain. Sert aussi pour un ouvrier isolé qui a oublié de pointer, ou une correction.
 */
function TimeEntryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: meta } = useApi<Meta>('/api/meta/pickers');
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [workerQuery, setWorkerQuery] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('16:30');
  const [pause, setPause] = useState('30');
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // bureau / chef : valider d'emblée ce qu'on saisit (décoché = file « à valider » comme un pointage terrain)
  const [approveNow, setApproveNow] = useState(true);
  const [prefillMsg, setPrefillMsg] = useState<string | null>(null);

  /** Reprend du planning (chantier + date choisis) : les ouvriers affectés, le créneau et la pause. */
  async function prefillFromPlanning() {
    setPrefillMsg(null);
    try {
      const r = await api<{ items: { personId: string; slots: { start: string; end: string; allDay: boolean }[]; pauseMinutes: number; worksiteTitle: string }[] }>(`/api/timesheet/planned?date=${date}&worksiteId=${worksiteId}`);
      if (r.items.length === 0) { setPrefillMsg('Rien au planning pour ce chantier ce jour-là.'); return; }
      setPersonIds([...new Set(r.items.map((i) => i.personId))]);
      const slot = r.items[0]!.slots.find((s) => !s.allDay);
      if (slot) { setStart(slot.start); setEnd(slot.end); setPause(String(r.items[0]!.pauseMinutes)); }
      if (!task.trim()) setTask(r.items[0]!.worksiteTitle);
      setPrefillMsg(`${new Set(r.items.map((i) => i.personId)).size} ouvrier(s) repris du planning.`);
    } catch (e) { setPrefillMsg(e instanceof Error ? e.message : 'Impossible de lire le planning.'); }
  }

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const filteredPeople = useMemo(() => {
    const q = workerQuery.trim().toLowerCase();
    const people = meta?.people ?? [];
    return q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  }, [meta, workerQuery]);

  function toggleWorker(id: string) {
    setPersonIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const hours = computeHours(start, end, pause);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (personIds.length === 0) { setErr('Sélectionnez au moins un ouvrier.'); return; }
    if (hours <= 0) { setErr('Le créneau ne laisse aucune heure de travail une fois la pause déduite.'); return; }
    setBusy(true);
    setErr(null);
    const savedIds: string[] = [];
    try {
      for (const personId of personIds) {
        await api('/api/timesheet/entries', {
          method: 'POST',
          body: {
            personId,
            worksiteId: worksiteId || null,
            date,
            hours,
            task: task.trim() || null,
            note: note.trim() || null,
            approve: approveNow,
          },
        });
        savedIds.push(personId);
      }
      onDone();
    } catch (e2) {
      setPersonIds(ids=>ids.filter(id=>!savedIds.includes(id)));
      setErr(`${savedIds.length ? `${savedIds.length} pointage(s) enregistré(s). Seules les personnes restantes sont sélectionnées. ` : ''}${(e2 as Error).message ?? 'Erreur'}`);
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim">
      <form className="modal wiz" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Saisir des heures</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label={tr("Fermer")}>✕</button>
        </div>
        <div className="wiz-body">
          <div className="plan-form-intro">
            <strong>Une même équipe, un même créneau</strong>
            <p style={{ margin: '0.2rem 0 0' }}>Chaque ouvrier sélectionné reçoit sa propre ligne à valider.</p>
          </div>
          {err && <div className="plan-form-error">{err}</div>}

          <fieldset>
            <legend>01 · Qui a travaillé ?</legend>
            <input className="input" style={{ marginBottom: '0.7rem' }} placeholder="Chercher un nom…" value={workerQuery} onChange={(e) => setWorkerQuery(e.target.value)} />
            <div className="plan-worker-picker">
              {filteredPeople.map((p) => {
                const on = personIds.includes(p.id);
                return (
                  <label key={p.id} className={`plan-worker-option${on ? ' selected' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleWorker(p.id)} />
                    <div><strong>{p.name}</strong></div>
                  </label>
                );
              })}
            </div>
            <div className="plan-selection-count">{personIds.length} ouvrier(s) sélectionné(s).</div>
          </fieldset>

          <fieldset>
            <legend>02 · Chantier & créneau</legend>
            <div className="field full" style={{ marginBottom: '0.85rem' }}>
              <label>{tr("Chantier")}</label>
              <ComboBox placeholder="— (frais général)" value={worksiteId} onChange={setWorksiteId} options={meta?.worksites.map((w) => ({ value: w.id, label: w.name })) ?? []} />
              {worksiteId && date && (
                <div style={{ marginTop: '0.5rem' }}>
                  <button type="button" className="btn" onClick={prefillFromPlanning}>Reprendre l’équipe et le créneau du planning</button>
                  {prefillMsg && <span className="hint" style={{ marginLeft: '0.6rem' }}>{prefillMsg}</span>}
                </div>
              )}
            </div>
            <div className="wiz-grid">
              <div className="field">
                <label>Date *</label>
                <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Début *</label>
                <input className="input" type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="field">
                <label>Fin *</label>
                <input className="input" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="field">
                <label>Pause non travaillée (minutes)</label>
                <input className="input" type="number" min="0" step="5" value={pause} onChange={(e) => setPause(e.target.value)} />
              </div>
            </div>
            <small style={{ display: 'block', marginTop: '0.6rem' }}>
              Durée nette : <strong>{formatHours(hours)}</strong> par ouvrier, pause déduite.
            </small>
          </fieldset>

          <fieldset>
            <legend>03 · Détails</legend>
            <div className="field full" style={{ marginBottom: '0.85rem' }}>
              <label>Travaux réalisés *</label>
              <input className="input" required value={task} onChange={(e) => setTask(e.target.value)} placeholder="ex. Pose de l’étanchéité toiture" />
            </div>
            <div className="field full">
              <label>Remarque</label>
              <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. oublié de pointer, ajouté par le bureau" />
            </div>
          </fieldset>
        </div>
        <div className="modal-foot">
          <label className="row" style={{ gap: '0.4rem', marginRight: 'auto', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} /> Valider directement
          </label>
          <button type="button" className="btn" onClick={onClose}>{tr("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy || personIds.length === 0 || !date || !task.trim()}>
            {busy ? tr("Enregistrement…") : approveNow ? 'Enregistrer et valider' : 'Ajouter à la file à valider'}
          </button>
        </div>
      </form>
    </div>
  );
}
