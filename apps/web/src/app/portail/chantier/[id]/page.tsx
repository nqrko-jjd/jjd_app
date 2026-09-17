'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { portalApi, portalBlobUrl, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../../PortalShell';

interface Data {
  worksite: {
    id: string; ref: string; title: string; status: string; statusLabel: string;
    address: string; building: { id: string; name: string } | null;
    startedOn: string | null; endedOn: string | null; description: string | null;
  };
  quotes: { id: string; number: string; title: string | null; status: string; hasPdf: boolean; totalHt: number; totalTtc: number; issuedOn: string | null }[];
  invoices: { id: string; number: string; status: string; hasPdf: boolean; totalTtc: number; paidAmount: number; issuedOn: string | null; dueOn: string | null }[];
  photos: { id: string; url: string; thumbUrl: string | null; caption: string | null; createdAt: string; video?: boolean }[];
  messages: { id: string; body: string | null; kind: string; fileUrl?: string | null; thumbUrl?: string | null; authorName: string | null; createdAt: string; fromClient: boolean }[];
  reports: {
    id: string; date: string; authorName: string; workDone: string | null; notes: string | null;
    clientName: string | null; signedAt: string | null;
    photos: { id: string; url: string; thumbUrl: string | null; caption: string | null }[];
  }[];
  threadClosed: boolean;
  threadId: string | null;
  access: 'full' | 'limited';
}

// Historique façon maquette : on n'affiche que les étapes déjà atteintes, avec une
// courte phrase par étape (pas un stepper 1-2-3-4 qui prévisualise les étapes futures).
const STEP_DEFS = [
  { key: 'lead', label: 'Demande enregistrée', text: 'Votre dossier a été enregistré.' },
  { key: 'scheduled', label: 'Planifiée', text: 'Une date d’intervention a été fixée.' },
  { key: 'in_progress', label: 'En cours', text: 'L’équipe intervient sur place.' },
  { key: 'done', label: 'Terminée', text: 'Les travaux sont terminés.' },
  { key: 'invoiced', label: 'Facturée', text: 'La facture a été émise.' },
];
function eur(n: number) { return `${n.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} €`; }
function d(s: string | null) { return s ? new Date(s).toLocaleDateString('fr-BE') : '—'; }

export default function PortalWorksite(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <PortalWorksiteInner {...props} />
    </Suspense>
  );
}

function PortalWorksiteInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = usePortalGuard();
  const sp = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [msgOpen, setMsgOpen] = useState(sp.get('discussion') === '1');
  const full = data?.access !== 'limited';
  const [msg, setMsg] = useState('');

  const load = () => portalApi<Data>(`/worksites/${id}`).then(setData).catch(() => {});
  useEffect(() => { if (me) load(); }, [me, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (msgOpen && data?.threadId) portalApi(`/messages/${data.threadId}/read`, { method: 'POST' }).catch(() => {});
  }, [msgOpen, data?.threadId]);

  if (loading || !me) return null;
  if (!data) return <PortalShell><p className="p-note">Chargement…</p></PortalShell>;
  const w = data.worksite;
  const stepIdx = w.status === 'scheduled' ? 1
    : w.status === 'in_progress' ? 2
    : w.status === 'done' || w.status === 'to_invoice' ? 3
    : w.status === 'invoiced' || w.status === 'closed' || w.status === 'paid' ? 4
    : 0;

  async function send() {
    if (!msg.trim()) return;
    await portalApi(`/worksites/${id}/messages`, { method: 'POST', body: { body: msg.trim() } });
    setMsg('');
    load();
  }
  async function acceptQuote(qid: string) {
    if (!confirm('Confirmer l’acceptation de ce devis ?')) return;
    await portalApi(`/quotes/${qid}/accept`, { method: 'POST' });
    load();
  }
  async function openPdf(docId: string) {
    try { window.open(await portalBlobUrl(`/documents/${docId}/pdf`), '_blank'); }
    catch { alert('PDF indisponible.'); }
  }

  return (
    <PortalShell>
      <div>
        <Link href={w.building ? `/portail/immeuble/${w.building.id}` : '/portail/interventions'} className="p-back">
          ← {w.building ? w.building.name : 'Retour'}
        </Link>

        <div className="eyebrow" style={{ color: 'var(--p-ink-3)' }}>INTERVENTION {w.ref}{w.address ? ` · ${w.address}` : ''}</div>
        <h1 style={{ margin: '0.3rem 0 1.2rem' }}>{w.title}</h1>

        <div className="p-cols">
          <div style={{ display: 'grid', gap: '1.3rem' }}>
            <div className="p-card p-card-pad">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span className="p-pill">{w.statusLabel}</span>
                <span className="p-note">Début : {d(w.startedOn)} · Fin prévue : {d(w.endedOn)}</span>
              </div>

              {w.description && (
                <>
                  <h3 style={{ marginBottom: '0.5rem' }}>Votre demande</h3>
                  <p style={{ whiteSpace: 'pre-wrap', marginBottom: '1.2rem' }}>{w.description}</p>
                </>
              )}

              <h3 style={{ marginBottom: '0.7rem' }}>Suivi de l’intervention</h3>
              <div className="p-timeline">
                {STEP_DEFS.slice(0, stepIdx + 1).map((s) => (
                  <div key={s.key} className="p-tstep">
                    <span className="dot" />
                    <div>
                      <div className="label">{s.label}</div>
                      <div className="desc">{s.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {(data.reports.length > 0 || data.photos.length > 0) && (
              <div className="p-card p-card-pad">
                <h3 style={{ marginBottom: '0.8rem' }}>Photos &amp; rapport</h3>
                {data.reports.map((r) => (
                  <div key={r.id} style={{ marginBottom: '1.1rem' }}>
                    <p className="p-note" style={{ marginBottom: '0.3rem' }}>
                      {d(r.date)} — {r.authorName}{r.clientName ? ` · signé par ${r.clientName}` : ''}
                    </p>
                    {r.workDone && <p style={{ fontSize: '0.92rem', whiteSpace: 'pre-wrap' }}>{r.workDone}</p>}
                    {r.notes && <p className="p-note" style={{ marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>Remarques : {r.notes}</p>}
                    {r.photos.length > 0 && (
                      <div className="p-photos" style={{ marginTop: '0.6rem' }}>
                        {r.photos.map((p) => (
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.thumbUrl ?? p.url} alt={p.caption ?? ''} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {data.photos.length > 0 && (
                  <div className="p-photos">
                    {data.photos.map((p) => (
                      p.video ? (
                        <video key={p.id} src={p.url} controls preload="metadata" style={{ width: '100%', borderRadius: 8 }} />
                      ) : (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.thumbUrl ?? p.url} alt={p.caption ?? ''} />
                        </a>
                      )
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: '1.3rem', alignContent: 'start' }}>
            {full && (
              <div className="p-panel">
                <div className="p-panel-h"><h2>Documents</h2></div>
                {data.quotes.length === 0 && data.invoices.length === 0 && <p className="p-note">Aucun document.</p>}
                {data.quotes.map((q) => (
                  <div key={q.id} className="p-doc-row" style={{ cursor: q.hasPdf ? 'pointer' : 'default' }} onClick={() => q.hasPdf && openPdf(q.id)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Devis {q.number}</div>
                      <div className="p-note">{eur(q.totalTtc)} · {d(q.issuedOn)}</div>
                    </div>
                    {q.status === 'accepted' ? (
                      <span className="p-tag ok">Accepté</span>
                    ) : q.status === 'declined' ? (
                      <span className="p-tag crit">Décliné</span>
                    ) : (
                      <button className="p-btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem' }} onClick={(e) => { e.stopPropagation(); acceptQuote(q.id); }}>
                        Accepter
                      </button>
                    )}
                  </div>
                ))}
                {data.invoices.map((f) => (
                  <div key={f.id} className="p-doc-row" style={{ cursor: f.hasPdf ? 'pointer' : 'default' }} onClick={() => f.hasPdf && openPdf(f.id)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Facture {f.number}</div>
                      <div className="p-note">{eur(f.totalTtc)} · {d(f.issuedOn)}</div>
                    </div>
                    <span className={`p-tag ${f.status === 'paid' ? 'ok' : f.status === 'overdue' ? 'crit' : 'gold'}`}>
                      {f.status === 'paid' ? 'Payée' : f.status === 'overdue' ? 'En retard' : 'À payer'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="p-panel">
              <div className="p-panel-h"><h2>Échanger avec JJD</h2></div>
              <p className="p-note" style={{ marginBottom: '0.9rem' }}>Votre fil dédié à cette intervention.</p>
              <button className="p-btn-primary" onClick={() => setMsgOpen((v) => !v)}>
                {msgOpen ? 'Fermer la discussion' : `Ouvrir la discussion${data.messages.length ? ` (${data.messages.length})` : ''}`}
              </button>
            </div>

            {msgOpen && (
              <div className="p-panel">
                <div className="p-thread">
                  {data.messages.length === 0 && <p className="p-note">Aucun message. Écrivez à l’équipe ci-dessous.</p>}
                  {data.messages.map((m) => (
                    <div key={m.id} className={`p-msg ${m.fromClient ? 'mine' : ''} ${m.kind === 'status' ? 'status' : ''}`}>
                      {m.kind !== 'status' && <div className="who">{m.authorName} · {new Date(m.createdAt).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                      {m.kind === 'file' && m.fileUrl
                        ? <div className="bubble"><a href={m.fileUrl} target="_blank" rel="noreferrer">📎 {m.body || 'Fichier'}</a></div>
                        : <div className="bubble">{m.body}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <input className="p-input" placeholder="Votre message…" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                  <button className="p-btn-primary" onClick={send} disabled={!msg.trim()}>Envoyer</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
