'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api } from '@/lib/api';
import { PageHead, Money, formatDateBE } from '@/lib/ui';
import { ComboBox } from '@/components/ComboBox';
import { formatHours } from '@jjd/shared';
import { downloadCsv, pickAndImportCsv, summarizeImport } from '@/lib/csvIO';

interface Meta { people: { id: string; name: string }[]; worksites: { id: string; name: string }[] }

interface Pending {
  id: string; date: string | null; hours: number | null; amount: number | null; task: string | null;
  geoFlag: boolean; geoDistance: number | null; startLat: number | null; startLng: number | null;
  person: { displayName: string | null; firstName: string };
  worksite: { ref: string; title: string } | null;
}

export default function PointagePage() {
  const { data, loading, reload } = useApi<{ items: Pending[] }>('/api/timesheet/pending');
  const [adding, setAdding] = useState(false);

  async function act(id: string, action: 'approve' | 'reject') {
    await api(`/api/timesheet/entries/${id}/${action}`, { method: 'POST' });
    reload();
  }
  async function approveAll() {
    const r = await api<{ approved: number }>('/api/timesheet/entries/approve-all', { method: 'POST' });
    alert(`${r.approved} pointage(s) validé(s).`);
    reload();
  }
  function exportCsv() {
    downloadCsv('/api/timesheet/entries/export.csv', `horaires-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  function importCsv() {
    pickAndImportCsv(
      '/api/timesheet/entries/import',
      (r) => { alert(summarizeImport(r)); reload(); },
      (msg) => alert(`Échec de l’import : ${msg}`),
    );
  }

  const items = data?.items ?? [];
  const totalHours = items.reduce((a, e) => a + (e.hours ?? 0), 0);
  const totalAmount = items.reduce((a, e) => a + (e.amount ?? 0), 0);
  const flagged = items.filter((e) => e.geoFlag).length;

  // groupe par personne
  const byPerson = new Map<string, Pending[]>();
  for (const e of items) {
    const k = e.person.displayName || e.person.firstName;
    byPerson.set(k, [...(byPerson.get(k) ?? []), e]);
  }

  return (
    <>
      {adding && <ManualEntryModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      <PageHead
        title="Pointage"
        sub="Heures à valider avant le décompte de paie"
        action={
          <div className="row">
            <button className="btn" onClick={exportCsv} title="Exporter tous les pointages en CSV (éditable dans Excel)">⇩ Exporter CSV</button>
            <button className="btn" onClick={importCsv} title="Réimporter un CSV/Excel corrigé (met à jour par id, crée les nouveaux pointages)">⇧ Importer</button>
            <button className="btn" onClick={() => setAdding(true)}>+ Pointage manuel</button>
            {items.length > 0 && <button className="btn primary" onClick={approveAll}>Tout valider{flagged ? ' (sauf hors zone)' : ''}</button>}
            <Link href="/app/pointage/decomptes" className="btn">Décomptes du mois →</Link>
          </div>
        }
      />

      {items.length > 0 && (
        <div className="kpis" style={{ marginBottom: '1.4rem' }}>
          <div className="kpi"><span className="ic">◷</span><div className="label">À valider</div><div className="value">{items.length}</div></div>
          <div className="kpi"><span className="ic">Σ</span><div className="label">Heures</div><div className="value">{formatHours(totalHours)}</div></div>
          <div className="kpi"><span className="ic">€</span><div className="label">Montant</div><div className="value"><Money value={totalAmount} /></div></div>
          <div className={`kpi${flagged ? ' warn' : ''}`}><span className="ic">⚑</span><div className="label">Hors zone</div><div className="value">{flagged}</div></div>
        </div>
      )}

      {loading && <div className="empty">Chargement…</div>}
      {data && items.length === 0 && (
        <div className="card card-pad muted">Rien à valider. Le compteur des ouvriers alimente cette file.</div>
      )}

      {[...byPerson.entries()].map(([name, entries]) => (
        <div key={name} style={{ marginBottom: '1.3rem' }}>
          <div className="section-title">
            {name} <span className="hint">{entries.length} · {formatHours(entries.reduce((a, e) => a + (e.hours ?? 0), 0))} · <Money value={entries.reduce((a, e) => a + (e.amount ?? 0), 0)} /></span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Date</th><th>Chantier</th><th>Tâche</th><th>Lieu</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Montant</th><th></th></tr>
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
                        <button className="btn primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => act(e.id, 'approve')}>Valider</button>
                        <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }} onClick={() => act(e.id, 'reject')}>Refuser</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/** Saisie manuelle : ouvrier qui a oublié de pointer, correction, etc. Reste "à valider" (source=manual). */
function ManualEntryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: meta } = useApi<Meta>('/api/meta/pickers');
  const [personId, setPersonId] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/timesheet/entries', {
        method: 'POST',
        body: {
          personId,
          worksiteId: worksiteId || null,
          date: new Date(date).toISOString(),
          hours: hours ? Number(hours) : null,
          task: task || null,
          note: note || null,
        },
      });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message ?? 'Erreur');
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Pointage manuel</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Pour un ouvrier qui a oublié de pointer, ou une correction. Reste « à valider » comme un pointage terrain.</p>
          <div className="field">
            <label>Ouvrier *</label>
            <ComboBox placeholder="chercher un nom" value={personId} onChange={setPersonId} options={meta?.people.map((p) => ({ value: p.id, label: p.name })) ?? []} />
          </div>
          <div className="field">
            <label>Chantier</label>
            <ComboBox placeholder="— (frais général)" value={worksiteId} onChange={setWorksiteId} options={meta?.worksites.map((w) => ({ value: w.id, label: w.name })) ?? []} />
          </div>
          <div className="field">
            <label>Date *</label>
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Heures</label>
            <input className="input" type="number" step="any" min="0" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="ex. 8" />
          </div>
          <div className="field">
            <label>Tâche</label>
            <input className="input" value={task} onChange={(e) => setTask(e.target.value)} />
          </div>
          <div className="field">
            <label>Note</label>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. oublié de pointer, ajouté par le bureau" />
          </div>
        </div>
        {err && <div className="badge crit" style={{ margin: '0 1.15rem', padding: '0.4rem 0.7rem' }}>{err}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || !personId || !date}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  );
}
