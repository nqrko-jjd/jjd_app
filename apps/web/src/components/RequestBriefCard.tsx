'use client';
import { REQUEST_GOALS, REQUEST_ROLES, REQUEST_LOCATIONS, type RequestBrief } from '@jjd/shared';
export function RequestBriefCard({ brief }: { brief: RequestBrief }) {
  return <div className="request-brief">
    {!!brief.units?.length && <section><h3>Appartements et zones</h3>{brief.units.map((u, i) => <p key={i}><strong>{u.label}</strong> · {REQUEST_LOCATIONS[u.purpose]}</p>)}</section>}
    {!!brief.contacts?.length && <section><h3>Personnes à joindre</h3>{brief.contacts.map((c, i) => <div className="request-person" key={i}><strong>{c.name}</strong><span>{REQUEST_ROLES[c.role]}{c.unitLabel ? ` · ${c.unitLabel}` : ''}</span>{c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}{c.phone2 && <a href={`tel:${c.phone2}`}>{c.phone2}</a>}{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</div>)}</section>}
    {(brief.repeated || brief.history) && <section><h3>Historique signalé</h3><p>{brief.repeated ? 'Problème déjà constaté auparavant.' : ''}</p><p>{brief.history || 'Dates et circonstances à préciser.'}</p></section>}
    {brief.measures && <section><h3>Mesures déjà prises</h3><p>{brief.measures}</p></section>}
    {!!brief.goals?.length && <section><h3>Intervention et documents attendus</h3><ul>{brief.goals.map(g => <li key={g}>{REQUEST_GOALS[g]}</li>)}</ul></section>}
    {brief.clientReference && <p><strong>Référence client :</strong> {brief.clientReference}</p>}
    {brief.relatedWorksiteId && <p><strong>Un dossier précédent a été indiqué.</strong></p>}
    {!!brief.attachments?.length && <section><h3>Pièces jointes</h3>{brief.attachments.map((a, i) => <p key={i}><a href={a.url} target="_blank" rel="noreferrer" onClick={e => {
        if (!a.url.startsWith('data:application/pdf;base64,')) return;
        e.preventDefault(); const bytes = Uint8Array.from(atob(a.url.split(',')[1]), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); window.open(url, '_blank', 'noopener,noreferrer'); setTimeout(() => URL.revokeObjectURL(url), 60000);
      }}>PDF · {a.name}</a></p>)}</section>}
  </div>;
}
