'use client';
import { tr } from '@/lib/ui-language';
import { useState } from 'react';

export type LabourRow = { date: string; personId: string; personName: string; hours: number; amount: number; pending: boolean };
const money = (n: number) => n.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });
const hours = (n: number) => `${n.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} h`;

/** Read-only display of recorded hours; planned assignments never enter these totals. */
export function WorksiteLabourDetail({ rows, demo = false }: { rows: LabourRow[]; demo?: boolean }) {
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState('all');
  const people = [...new Map(rows.map(r => [r.personId, r.personName])).entries()];
  const filtered = rows.filter(r => (!person || r.personId === person) && (status === 'all' || r.pending === (status === 'pending')));
  const dates = [...new Set(filtered.map(r => r.date.slice(0, 10)))].sort().reverse();
  const validated = filtered.filter(r => !r.pending);
  const pending = filtered.filter(r => r.pending);
  return <section className="card labour-detail" id="worksite-labour" tabIndex={-1}>
    <details className="labour-toggle">
      <summary className="labour-heading"><div><span className="eyebrow">QUI ÉTAIT SUR PLACE ?</span><h2>Détail de la main-d’œuvre</h2><p>Heures enregistrées par jour et par ouvrier · coûts internes{demo ? ' · données fictives' : ''}.</p></div><div className="labour-toggle-right"><span className="badge">{dates.length} jours affichés</span><span className="labour-toggle-arrow" aria-hidden="true" /></div></summary>
      <div className="labour-filters"><label>{tr("Ouvrier")}<select className="input" value={person} onChange={e => setPerson(e.target.value)}><option value="">Tous les ouvriers</option>{people.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Pointages<select className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Tous les pointages</option><option value="validated">Validés</option><option value="pending">{tr("À valider")}</option></select></label><div className="labour-total"><strong>{hours(validated.reduce((s,r)=>s+r.hours,0))} sur journées validées</strong><span>{money(validated.reduce((s,r)=>s+r.amount,0))} de pointages sur journées validées</span><small>{hours(pending.reduce((s,r)=>s+r.hours,0))} sur journées à contrôler</small></div></div>
      <p className="muted" style={{fontSize:".8rem"}}>Une journée à contrôler peut contenir des pointages validés et en attente. Les montants ci-dessous proviennent des pointages ; le coût retenu dans la rentabilité peut être remplacé par les factures de rémunération.</p>
      {!dates.length && <p className="muted">{rows.length ? 'Aucun pointage ne correspond aux filtres.' : 'Aucun pointage enregistré sur ce chantier.'}</p>}
      {dates.map(date => { const day = filtered.filter(r => r.date.slice(0,10) === date); return <details className="labour-day" key={date}>
        <summary><strong>{new Date(`${date}T12:00:00`).toLocaleDateString('fr-BE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong><span>{new Set(day.map(r=>r.personId)).size} ouvriers · {hours(day.reduce((s,r)=>s+r.hours,0))}</span><b>{money(day.reduce((s,r)=>s+r.amount,0))} enregistrés</b></summary>
        <div className="labour-lines">{day.map((r,i)=><div className="labour-line" key={`${r.personId}-${i}`}><span className="labour-avatar" aria-hidden="true">{r.personName.slice(0,2).toUpperCase()}</span><strong>{r.personName}</strong><span>{hours(r.hours)}</span><span className={`badge ${r.pending?'warn':'ok'}`}>{r.pending?'À contrôler':'Validé'}</span><b>{money(r.amount)}{r.pending && <small>à contrôler</small>}</b></div>)}</div>
      </details>; })}
    </details>
  </section>;
}
