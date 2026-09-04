'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Fiche {
  id: string; title: string | null; startAt: string; endAt: string; allDay: boolean;
  instructions: string | null;
  worksite: { id: string; ref: string; title: string; description: string | null; address: string };
  client: { name: string; phone: string | null } | null;
  building: { name: string; digicode: string | null; accessNote: string | null; contacts: { role: string | null; name: string; phone: string | null }[] } | null;
  manager: { name: string; phone: string | null } | null;
  team: string | null;
  vehicle: { label: string; plate: string | null } | null;
  people: { name: string; role: string; phone: string | null }[];
  equipment: { name: string; reference: string | null }[];
  consumables: { name: string; qty: number; unit: string }[];
  tasks: { title: string; assignee: string | null }[];
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export default function FichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [f, setF] = useState<Fiche | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ fiche: Fiche }>(`/api/planning/${id}/fiche`)
      .then((r) => setF(r.fiche))
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (f) {
      document.title = `Fiche chantier — ${f.worksite.ref}`;
      if (document.visibilityState === 'visible' && !new URLSearchParams(location.search).has('noprint')) {
        const t = setTimeout(() => window.print(), 500);
        return () => clearTimeout(t);
      }
    }
  }, [f]);

  if (err) return <div style={{ padding: 40 }}>Erreur : {err}</div>;
  if (!f) return <div style={{ padding: 40 }}>Chargement…</div>;

  return (
    <>
      <style>{CSS}</style>
      <div className="toolbar no-print">
        <button onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>
      <div className="sheet">
        <header className="head">
          <div>
            <div className="ref">{f.worksite.ref}</div>
            <h1>{f.title || f.worksite.title}</h1>
            {f.worksite.description && <div className="sub">{f.worksite.description}</div>}
          </div>
          <div className="when">
            <div className="date">{dateLabel(f.startAt)}</div>
            {!f.allDay && <div className="hours">{hhmm(f.startAt)} – {hhmm(f.endAt)}</div>}
          </div>
        </header>

        <section className="grid2">
          <div className="box">
            <div className="lbl">Adresse</div>
            <div className="big">{f.worksite.address || '—'}</div>
            {f.building?.name && <div>{f.building.name}</div>}
          </div>
          <div className="box">
            <div className="lbl">Contacts</div>
            {f.client && <div>Client : {f.client.name}{f.client.phone ? ` · ${f.client.phone}` : ''}</div>}
            {f.manager && <div>Responsable : {f.manager.name}{f.manager.phone ? ` · ${f.manager.phone}` : ''}</div>}
            {f.building?.contacts.map((c, i) => (
              <div key={i}>{c.role ? `${c.role} : ` : ''}{c.name}{c.phone ? ` · ${c.phone}` : ''}</div>
            ))}
            {!f.client && !f.manager && (f.building?.contacts.length ?? 0) === 0 && <div className="muted">—</div>}
          </div>
        </section>

        {(f.building?.digicode || f.building?.accessNote) && (
          <section className="access">
            <div className="lbl">Accès</div>
            {f.building.digicode && <div className="code">Code : <strong>{f.building.digicode}</strong></div>}
            {f.building.accessNote && <div className="note">{f.building.accessNote}</div>}
          </section>
        )}

        <section className="grid3">
          <div className="box">
            <div className="lbl">Équipe</div>
            {f.team && <div className="team-name">{f.team}</div>}
            {f.people.length === 0 && <div className="muted">—</div>}
            <ul>
              {f.people.map((p, i) => (
                <li key={i}>{p.name}{p.role === 'foreman' ? ' (chef d’équipe)' : ''}{p.phone ? ` · ${p.phone}` : ''}</li>
              ))}
            </ul>
          </div>
          <div className="box">
            <div className="lbl">Véhicule</div>
            {f.vehicle ? <div className="big">{f.vehicle.label}{f.vehicle.plate ? ` · ${f.vehicle.plate}` : ''}</div> : <div className="muted">—</div>}
          </div>
          <div className="box">
            <div className="lbl">Matériel</div>
            {f.equipment.length === 0 && <div className="muted">—</div>}
            <ul>
              {f.equipment.map((e, i) => <li key={i}>{e.name}{e.reference ? ` (${e.reference})` : ''}</li>)}
            </ul>
          </div>
        </section>

        {f.consumables.length > 0 && (
          <section className="box">
            <div className="lbl">Consommables à prévoir</div>
            <ul className="consumables">
              {f.consumables.map((c, i) => <li key={i}><span>{c.name}</span><span>{c.qty} {c.unit}</span></li>)}
            </ul>
          </section>
        )}

        {f.instructions && (
          <section className="instructions">
            <div className="lbl">Instructions pour l’équipe</div>
            <p>{f.instructions}</p>
          </section>
        )}

        {f.tasks.length > 0 && (
          <section className="box">
            <div className="lbl">Tâches en cours sur le chantier</div>
            <ul>
              {f.tasks.map((t, i) => <li key={i}>{t.title}{t.assignee ? ` — ${t.assignee}` : ''}</li>)}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

const CSS = `
  @page { size: A4; margin: 16mm; }
  body { background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; padding: 24px; font: 13px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2b25; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid #0c2a22; padding-bottom: 14px; }
  .ref { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #c1922a; }
  .head h1 { font-size: 22px; margin: 2px 0 4px; font-family: "Fraunces", Georgia, serif; color: #0c2a22; }
  .sub { color: #5a675f; font-size: 12px; }
  .when { text-align: right; white-space: nowrap; }
  .when .date { font-weight: 700; text-transform: capitalize; }
  .when .hours { font-size: 18px; font-weight: 800; color: #0c2a22; margin-top: 2px; }
  section { margin-top: 16px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .grid3 { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 14px; }
  .box { border: 1px solid #dbe3dd; border-radius: 8px; padding: 10px 12px; }
  .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: #8a938c; font-weight: 700; margin-bottom: 4px; }
  .big { font-weight: 700; font-size: 14px; }
  .muted { color: #99a19b; }
  ul { margin: 4px 0 0; padding-left: 18px; }
  li { margin-bottom: 2px; }
  .team-name { font-weight: 700; margin-bottom: 2px; }
  .access { background: #fbf3e3; border: 1px solid #e9d29a; border-radius: 8px; padding: 10px 12px; }
  .access .code strong { font-size: 16px; letter-spacing: .04em; }
  .access .note { margin-top: 2px; }
  .consumables { list-style: none; padding: 0; margin-top: 4px; }
  .consumables li { display: flex; justify-content: space-between; border-bottom: 1px dashed #e0e6e2; padding: 3px 0; }
  .instructions { background: #eef4f0; border-left: 4px solid #0c2a22; border-radius: 6px; padding: 12px 14px; }
  .instructions p { margin: 0; white-space: pre-wrap; }
  .toolbar { max-width: 780px; margin: 12px auto 0; padding: 0 24px; text-align: right; }
  .toolbar button { padding: 8px 14px; border: 1px solid #0c2a22; background: #0c2a22; color: #fff; border-radius: 6px; font-size: 12px; cursor: pointer; }
  @media print { .sheet { padding: 0; max-width: none; } .no-print { display: none !important; } .box, .access { break-inside: avoid; } }
`;
