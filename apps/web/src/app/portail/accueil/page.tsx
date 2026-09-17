'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { portalApi, portalBlobUrl, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface Dash {
  greeting: { name: string; isSyndic: boolean; access: 'full' | 'limited' };
  singleProject: {
    id: string; ref: string; title: string; building: string | null; address: string | null;
    photoThumbUrl: string | null; status: string; statusLabel: string; progressPct: number;
  } | null;
  kpis: { buildings: number; interventionsActive: number; quotesToValidate: number | null; urgent: number };
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

  const name = d?.greeting.name ?? me.label;
  // pour un particulier on garde juste le prénom ; pour un syndic / une ACP on garde le nom complet
  const greetName = me.isSyndic || me.access === 'limited' ? name : name.split(/[\s,]+/)[0];
  const alert = d?.urgentItems[0];

  return (
    <PortalShell>
      {!d ? <div className="p-empty">Chargement…</div> : (
        <>
          {/* Hero */}
          <div className="p-hero">
            <div className="eyebrow">{me.isSyndic ? 'Espace syndic / promoteur' : 'Espace client'}</div>
            <h1>Bonjour, {greetName}</h1>
            <div className="sub">{me.isSyndic ? 'Voici l’activité de votre portefeuille.' : 'Voici l’activité de vos chantiers.'}</div>
            <Link href="/portail/demande" className="p-btn-primary p-btn-gold cta">+ Nouvelle demande</Link>
            <div className="p-hero-stats">
              <Link href="/portail/immeubles" className="p-hero-stat link">
                <div className="v">{String(d.kpis.buildings).padStart(2, '0')}</div>
                <div className="l">{me.isSyndic ? 'Immeubles' : 'Dossiers'} <span className="chev">→</span></div>
              </Link>
              <Link href="/portail/interventions" className="p-hero-stat link">
                <div className="v">{String(d.kpis.interventionsActive).padStart(2, '0')}</div>
                <div className="l">Interventions en cours <span className="chev">→</span></div>
              </Link>
              {d.kpis.quotesToValidate != null && (
                <Link href="/portail/devis" className="p-hero-stat link">
                  <div className="v">{String(d.kpis.quotesToValidate).padStart(2, '0')}</div>
                  <div className="l">Devis à valider <span className="chev">→</span></div>
                </Link>
              )}
            </div>
          </div>

          {/* Projet unique (client particulier) — avancement des travaux, comme la maquette */}
          {d.singleProject && (
            <Link href={`/portail/chantier/${d.singleProject.id}`} className="p-card" style={{ display: 'block', overflow: 'hidden' }}>
              {d.singleProject.photoThumbUrl && (
                <div style={{ height: 200 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.singleProject.photoThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div className="p-card-pad">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    {d.singleProject.building && <div className="eyebrow">{d.singleProject.building}</div>}
                    <h2>{d.singleProject.title}</h2>
                    {d.singleProject.address && <p className="p-note" style={{ marginTop: '0.2rem' }}>{d.singleProject.address}</p>}
                  </div>
                  <span className="p-tag">{d.singleProject.statusLabel}</span>
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Avancement des travaux</span>
                    <span style={{ fontWeight: 700 }}>{d.singleProject.progressPct}%</span>
                  </div>
                  <div className="p-progress-track"><div className="p-progress-fill" style={{ width: `${d.singleProject.progressPct}%` }} /></div>
                </div>
              </div>
            </Link>
          )}

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
                <div className="p-ilist">
                  {d.recentInterventions.map((w) => (
                    <div key={w.id} className="p-irow" onClick={() => router.push(`/portail/chantier/${w.id}`)}>
                      <span className="ico">⌂</span>
                      <div className="body">
                        <div className="t">{w.building ?? w.title}</div>
                        <div className="s">{w.ref}</div>
                      </div>
                      <div className="right">
                        <span className={`p-dot ${STATUS_DOT[w.status] ?? 'grey'}`}>{w.statusLabel}</span>
                        <div className="d">{fdate(w.updatedAt)}</div>
                      </div>
                      <span className="chev">→</span>
                    </div>
                  ))}
                </div>
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
