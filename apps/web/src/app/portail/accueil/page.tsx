'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { portalApi, portalBlobUrl, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface Dash {
  greeting: { name: string; isSyndic: boolean };
  kpis: { buildings: number; interventionsActive: number; quotesToValidate: number; urgent: number };
  urgentItems: { id: string; ref: string; title: string; building: string | null; statusLabel: string; priority: string }[];
  recentInterventions: {
    id: string; ref: string; title: string; building: string | null; status: string; statusLabel: string;
    priority: string; priorityLabel: string; manager: string | null; updatedAt: string;
  }[];
  weekPlanning: { days: { label: string; date: string; items: { time: string; label: string; worksiteId: string | null }[] }[] };
  quotesToValidate: { id: string; number: string; title: string | null; totalHt: number; building: string | null; worksiteId: string | null; worksiteRef: string | null; issuedOn: string | null }[];
  recentDocuments: { id: string; kind: string; kindLabel: string; number: string; title: string | null; building: string | null; issuedOn: string | null; hasPdf: boolean }[];
}

const STATUS_DOT: Record<string, string> = {
  scheduled: 'gold', in_progress: 'ok', on_hold: 'blue', done: 'ok', to_invoice: 'gold',
  invoiced: 'grey', closed: 'grey', lead: 'grey', to_plan: 'grey', cancelled: 'crit',
};
const PRIO_DOT: Record<string, string> = { urgent: 'crit', high: 'crit', normal: 'gold', low: 'grey' };

function fdate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function eur(n: number) {
  return `${n.toLocaleString('fr-BE', { maximumFractionDigits: 0 })} €`;
}

export default function PortalDashboard() {
  const { me, loading } = usePortalGuard();
  const router = useRouter();
  const [d, setD] = useState<Dash | null>(null);

  useEffect(() => {
    if (me) portalApi<Dash>('/dashboard').then(setD).catch(() => {});
  }, [me]);

  if (loading || !me) return null;

  async function openPdf(id: string) {
    try { window.open(await portalBlobUrl(`/documents/${id}/pdf`), '_blank'); } catch { /* */ }
  }

  const firstName = (d?.greeting.name ?? me.label).split(/[\s,]+/)[0];
  const alert = d?.urgentItems[0];

  return (
    <PortalShell
      title={`Bonjour, ${firstName}`}
      subtitle={me.isSyndic ? 'Voici l’activité de votre portefeuille' : 'Voici l’activité de vos chantiers'}
      action={<Link href="/portail/demande" className="p-btn-primary">+ Nouvelle demande</Link>}
    >
      {!d ? <div className="p-empty">Chargement…</div> : (
        <>
          {/* KPIs */}
          <div className="p-kpis">
            <div className="p-kpi"><span className="ico">▦</span><div><div className="v">{d.kpis.buildings}</div><div className="l">{me.isSyndic ? 'Immeubles' : 'Dossiers'}</div></div></div>
            <div className="p-kpi"><span className="ico">⚒</span><div><div className="v">{d.kpis.interventionsActive}</div><div className="l">Interventions en cours</div></div></div>
            <div className="p-kpi"><span className="ico">▤</span><div><div className="v">{d.kpis.quotesToValidate}</div><div className="l">Devis à valider</div></div></div>
            <div className={`p-kpi${d.kpis.urgent > 0 ? ' alert' : ''}`}><span className="ico">!</span><div><div className="v">{d.kpis.urgent}</div><div className="l">{d.kpis.urgent > 1 ? 'Urgences' : 'Urgence'}</div></div></div>
          </div>

          {/* Alert */}
          {alert && (
            <Link href={`/portail/chantier/${alert.id}`} className="p-alert">
              <span className="ico">◈</span>
              <div className="tx">
                <strong>{alert.title}{alert.building ? ` · ${alert.building}` : ''}</strong>
                <span>{alert.ref} — {alert.statusLabel}</span>
              </div>
              <span className="p-tag gold">{alert.priority === 'urgent' ? 'Urgent' : 'Prioritaire'}</span>
              <span className="chev">›</span>
            </Link>
          )}

          <div className="p-cols">
            {/* Interventions récentes */}
            <div className="p-panel">
              <div className="p-panel-h">
                <h2>Interventions récentes</h2>
              </div>
              {d.recentInterventions.length === 0 ? <p className="p-note">Aucune intervention.</p> : (
                <table className="p-tbl">
                  <thead><tr><th>{me.isSyndic ? 'Immeuble' : 'Chantier'}</th><th>Statut</th><th>Priorité</th><th>Technicien</th><th>Maj</th></tr></thead>
                  <tbody>
                    {d.recentInterventions.map((w) => (
                      <tr key={w.id} onClick={() => router.push(`/portail/chantier/${w.id}`)} style={{ cursor: 'pointer' }}>
                        <td><span className="b-ico">⌂</span>{w.building ?? w.title}</td>
                        <td><span className={`p-dot ${STATUS_DOT[w.status] ?? 'grey'}`}>{w.statusLabel}</span></td>
                        <td>{w.priority === 'normal' || w.priority === 'low' ? <span className="p-note">—</span> : <span className={`p-dot ${PRIO_DOT[w.priority] ?? 'gold'}`}>{w.priorityLabel}</span>}</td>
                        <td>{w.manager ?? '—'}</td>
                        <td className="p-note">{fdate(w.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link href="/portail/interventions" className="p-more">Voir toutes les interventions ›</Link>
            </div>

            {/* Planning de la semaine */}
            <div className="p-panel">
              <div className="p-panel-h"><h2>Planning de la semaine</h2></div>
              <div className="p-week">
                {d.weekPlanning.days.map((day) => (
                  <div className="p-day" key={day.label + day.date}>
                    <div className="d">{day.label}<b>{day.date}</b></div>
                    <div className="ev">
                      {day.items.length === 0 ? <span className="empty">—</span> : day.items.map((it, i) => (
                        <div className="row" key={i}>
                          <span className="t">{it.time || '·'}</span>
                          <span>{it.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/portail/planning" className="p-more">Voir tout le planning ›</Link>
            </div>
          </div>

          {/* Devis à valider */}
          {d.quotesToValidate.length > 0 && (
            <div className="p-panel">
              <div className="p-panel-h"><h2>Devis à valider</h2></div>
              {d.quotesToValidate.map((q) => (
                <div key={q.id} className="p-doc-row">
                  <span className="p-quote"><span className="ico">▤</span></span>
                  <div>
                    <div style={{ fontWeight: 700 }}>{q.title ?? 'Devis'} · <span className="amt">{eur(q.totalHt)} HTVA</span></div>
                    <div className="p-note">{q.building ?? q.worksiteRef ?? ''} · reçu le {fdate(q.issuedOn)}</div>
                  </div>
                  <Link href={q.worksiteId ? `/portail/chantier/${q.worksiteId}` : '/portail/devis'} className="p-btn-primary p-btn-gold" style={{ marginLeft: 'auto' }}>Consulter le devis</Link>
                </div>
              ))}
              <Link href="/portail/devis" className="p-more">Voir tous les devis ›</Link>
            </div>
          )}

          {/* Documents récents */}
          {d.recentDocuments.length > 0 && (
            <div>
              <h2 style={{ marginBottom: '0.9rem' }}>Documents et activité récente</h2>
              <div className="p-docs">
                {d.recentDocuments.slice(0, 3).map((doc) => (
                  <div key={doc.id} className="p-doc">
                    <span className="ico">▤</span>
                    <div className="meta">
                      <b>{doc.kindLabel} {doc.number}</b>
                      <span>{doc.building ?? ''} · {fdate(doc.issuedOn)}</span>
                    </div>
                    {doc.hasPdf && <button onClick={() => openPdf(doc.id)} aria-label="Télécharger">⤓</button>}
                  </div>
                ))}
              </div>
              <Link href="/portail/documents" className="p-more">Voir tous les documents ›</Link>
            </div>
          )}
        </>
      )}
    </PortalShell>
  );
}
