'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
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
  photos: { id: string; url: string; thumbUrl: string | null; caption: string | null; createdAt: string }[];
  messages: { id: string; body: string | null; kind: string; authorName: string | null; createdAt: string; fromClient: boolean }[];
  threadClosed: boolean;
}

const STEPS = ['scheduled', 'in_progress', 'done', 'invoiced'];
const STEP_LABEL = ['Planifié', 'En cours', 'Terminé', 'Facturé'];
function eur(n: number) { return `${n.toLocaleString('fr-BE', { maximumFractionDigits: 2 })} €`; }
function d(s: string | null) { return s ? new Date(s).toLocaleDateString('fr-BE') : '—'; }

export default function PortalWorksite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = usePortalGuard();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<'suivi' | 'devis' | 'factures' | 'photos' | 'messages'>('suivi');
  const [msg, setMsg] = useState('');

  const load = () => portalApi<Data>(`/worksites/${id}`).then(setData).catch(() => {});
  useEffect(() => { if (me) load(); }, [me, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !me) return null;
  if (!data) return <PortalShell title="Chantier"><p className="p-note">Chargement…</p></PortalShell>;
  const w = data.worksite;
  const stepIdx = STEPS.indexOf(w.status) >= 0 ? STEPS.indexOf(w.status)
    : w.status === 'closed' || w.status === 'paid' ? 3
    : w.status === 'to_invoice' ? 2 : 0;

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
    <PortalShell
      title={w.title}
      subtitle={`${w.ref}${w.building ? ` · ${w.building.name}` : ''}${w.address ? ` · ${w.address}` : ''}`}
    >
      <div>
        <Link href={w.building ? `/portail/immeuble/${w.building.id}` : '/portail/interventions'} className="p-back">← Retour</Link>

        <div className="p-tabs">
          {(['suivi', 'devis', 'factures', 'photos', 'messages'] as const).map((t) => (
            <button key={t} className={`p-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'suivi' ? 'Suivi' : t === 'devis' ? `Devis (${data.quotes.length})`
                : t === 'factures' ? `Factures (${data.invoices.length})`
                : t === 'photos' ? `Photos (${data.photos.length})` : `Messages (${data.messages.length})`}
            </button>
          ))}
        </div>

        {tab === 'suivi' && (
          <div className="p-card p-card-pad">
            <div className="p-steps">
              {STEP_LABEL.map((label, i) => (
                <div key={label} className={`p-step${i < stepIdx ? ' done' : i === stepIdx ? ' now' : ''}`}>
                  <div className="bul">{i < stepIdx ? '✓' : i + 1}</div>
                  {label}
                </div>
              ))}
            </div>
            <p style={{ marginTop: '1rem' }}><span className="p-pill">{w.statusLabel}</span></p>
            <p className="p-note" style={{ marginTop: '0.8rem' }}>
              Début : {d(w.startedOn)} · Fin prévue : {d(w.endedOn)}
            </p>
            {w.description && <p style={{ marginTop: '0.8rem', whiteSpace: 'pre-wrap' }}>{w.description}</p>}
          </div>
        )}

        {tab === 'devis' && (
          <div className="p-card p-card-pad">
            {data.quotes.length === 0 && <p className="p-note">Aucun devis.</p>}
            {data.quotes.map((q) => (
              <div key={q.id} className="p-doc-row">
                <span className="n">{q.number}</span>
                <span className="p-note">{d(q.issuedOn)}</span>
                <span className="amt">{eur(q.totalTtc)}</span>
                {q.hasPdf && <button className="p-btn-line" onClick={() => openPdf(q.id)}>PDF</button>}
                {q.status === 'accepted' ? (
                  <span className="p-pill ok">Accepté</span>
                ) : q.status === 'declined' ? (
                  <span className="p-pill crit">Décliné</span>
                ) : (
                  <button className="p-btn-primary" onClick={() => acceptQuote(q.id)}>Accepter</button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'factures' && (
          <div className="p-card p-card-pad">
            {data.invoices.length === 0 && <p className="p-note">Aucune facture.</p>}
            {data.invoices.map((f) => (
              <div key={f.id} className="p-doc-row">
                <span className="n">{f.number}</span>
                <span className="p-note">{d(f.issuedOn)}{f.dueOn ? ` · éch. ${d(f.dueOn)}` : ''}</span>
                <span className="amt">{eur(f.totalTtc)}</span>
                {f.hasPdf && <button className="p-btn-line" onClick={() => openPdf(f.id)}>PDF</button>}
                <span className={`p-pill ${f.status === 'paid' ? 'ok' : f.status === 'overdue' ? 'crit' : 'warn'}`}>
                  {f.status === 'paid' ? 'Payée' : f.status === 'overdue' ? 'En retard' : 'À payer'}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'photos' && (
          data.photos.length === 0 ? <div className="p-card p-card-pad"><p className="p-note">Aucune photo pour le moment.</p></div> : (
            <div className="p-photos">
              {data.photos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl ?? p.url} alt={p.caption ?? ''} />
                </a>
              ))}
            </div>
          )
        )}

        {tab === 'messages' && (
          <div className="p-card p-card-pad">
            <div className="p-thread">
              {data.messages.length === 0 && <p className="p-note">Aucun message. Écrivez à l’équipe ci-dessous.</p>}
              {data.messages.map((m) => (
                <div key={m.id} className={`p-msg ${m.fromClient ? 'mine' : ''} ${m.kind === 'status' ? 'status' : ''}`}>
                  {m.kind !== 'status' && <div className="who">{m.authorName} · {new Date(m.createdAt).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                  <div className="bubble">{m.body}</div>
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
    </PortalShell>
  );
}
