'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { Star } from 'lucide-react';

interface Settings { autoSend: boolean; copyToSelf: boolean; reviewUrl: string; delayDays: number; maxAgeDays: number; minAmount: number; subject: string; body: string }
interface Proposal {
  documentId: string; number: string | null; client: string; contactId: string | null; to: string | null; totalTtc: number; paidOn: string; daysSince: number;
  subject: string; body: string; blocked: string | null; worksiteRef: string | null;
}
interface HistoryRow { id: string; status: string; auto: boolean; toEmail: string | null; error: string | null; sentAt: string | null; createdAt: string; document: { id: string; number: string | null; contact: { name: string } | null } | null }
interface Data { emailConfigured: boolean; settings: Settings; proposals: Proposal[]; history: HistoryRow[] }
const PLACEHOLDERS = '{client} {numero} {montant} {lien} {chantier} {societe} {telephone}';

/** Demandes d'avis : quelques jours après une facture finale payée, un e-mail court avec le lien d'avis, à valider une par une (ou automatique si activé). */
export default function ReviewRequestsPage() {
  const { data, error, loading, reload } = useApi<Data>('/api/reminders/reviews');
  const [tab, setTab] = useState<'todo' | 'history' | 'settings'>('todo');
  const [edit, setEdit] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading && !data) return <SkeletonRows />;
  if (error || !data) return <ErrorState message={error ?? 'Erreur'} onRetry={reload} />;
  async function run(key: string, fn: () => Promise<{ note?: string } | void>) {
    setBusy(key); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: (r && r.note) || 'Fait.' }); reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHead
        eyebrow="Clients"
        title="Demandes d’avis"
        sub={`${data.proposals.length} demande(s) à envoyer · ${data.settings.autoSend ? 'envoi automatique activé' : 'à valider une par une'}`}
        action={<div className="row"><Link className="btn" href="/app/relances">Factures impayées</Link><Link className="btn" href="/app/relances/devis">Devis sans réponse</Link></div>}
      />
      {!data.emailConfigured && <div className="badge warn" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>L’envoi par e-mail n’est pas configuré sur ce serveur : les demandes ne peuvent pas partir.</div>}
      {!data.settings.reviewUrl && <div className="badge warn" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>Renseignez le lien de votre page d’avis dans l’onglet « Réglages » pour pouvoir envoyer.</div>}
      {msg && <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg.text}</div>}
      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'todo' ? 'on' : ''} onClick={() => setTab('todo')}>À envoyer · {data.proposals.length}</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Historique</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Réglages</button>
      </div>

      {tab === 'todo' && (data.proposals.length === 0
        ? <EmptyState icon={Star} title="Aucune demande d’avis à envoyer" text="Une demande est proposée quelques jours après le paiement complet d’une facture finale (hors client déjà sollicité cette année)." />
        : (
          <div className="panel doc-list">
            {data.proposals.map((p) => (
              <div key={p.documentId} className="doc-item">
                <div className="doc-item-body">
                  <div className="doc-item-top" style={{ flexWrap: 'wrap' }}>
                    <Link href={`/app/documents/${p.documentId}`} className="mono doc-item-num">{p.number}</Link>
                    <span className="badge ok">payée il y a {p.daysSince} j</span>
                    {p.worksiteRef && <span className="chip">🏗 {p.worksiteRef}</span>}
                    {p.blocked && <span className="badge plain" title={p.blocked}>✉ {p.blocked}</span>}
                    <span className="doc-item-amount" style={{ marginLeft: 'auto' }}>{formatEur(p.totalTtc)}</span>
                  </div>
                  <div className="doc-item-title">{p.client}</div>
                  <div className="doc-item-meta"><span>{p.to ?? '—'}</span><span>Payée le {formatDateBE(p.paidOn)}</span></div>
                  <div className="row" style={{ marginTop: '0.5rem', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button className="btn primary" disabled={!!busy || !data.emailConfigured || !data.settings.reviewUrl} onClick={() => setEdit(p)}>Relire et envoyer</button>
                    <button className="btn" disabled={!!busy} onClick={() => run(`skip-${p.documentId}`, async () => { await api('/api/reminders/reviews/skip', { method: 'POST', body: { documentId: p.documentId } }); })}>Ne pas demander</button>
                    {p.contactId && <button className="btn ghost" disabled={!!busy} onClick={() => { if (window.confirm(`Ne plus rien envoyer automatiquement à ${p.client} (relances, suivis, avis) ?`)) run(`off-${p.contactId}`, async () => { await api(`/api/reminders/contact/${p.contactId}`, { method: 'POST', body: { off: true } }); }); }}>Ne plus solliciter ce client</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'history' && (data.history.length === 0
        ? <EmptyState icon={Star} title="Aucune demande envoyée" text="L’historique des demandes d’avis envoyées apparaîtra ici." />
        : (
          <div className="panel doc-list">
            {data.history.map((h) => (
              <div key={h.id} className="doc-item">
                <div className="doc-item-body">
                  <div className="doc-item-top" style={{ flexWrap: 'wrap' }}>
                    {h.document && <Link href={`/app/documents/${h.document.id}`} className="mono doc-item-num">{h.document.number}</Link>}
                    <span className={`badge ${h.status === 'sent' ? 'ok' : 'crit'}`}>{h.status === 'sent' ? (h.auto ? 'Envoyée (auto)' : 'Envoyée') : 'Échec'}</span>
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.84rem' }}>{formatDateBE(h.sentAt ?? h.createdAt)}</span>
                  </div>
                  <div className="doc-item-title">{h.document?.contact?.name ?? '—'}</div>
                  <div className="doc-item-meta"><span>{h.toEmail ?? '—'}</span></div>
                  {h.error && <div style={{ color: 'var(--crit)', fontSize: '0.82rem' }}>{h.error}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'settings' && <SettingsForm initial={data.settings} onSaved={() => { setMsg({ ok: true, text: 'Réglages enregistrés.' }); reload(); }} onError={(t) => setMsg({ ok: false, text: t })} />}
      {edit && <SendModal p={edit} onClose={() => setEdit(null)} busy={!!busy} onSend={(subject, body, to) => run(`send-${edit.documentId}`, async () => { const r = await api<{ note: string }>('/api/reminders/reviews/send', { method: 'POST', body: { documentId: edit.documentId, subject, body, ...(to ? { to } : {}) } }); setEdit(null); return r; })} />}
    </>
  );
}

function SendModal({ p, onClose, onSend, busy }: { p: Proposal; onClose: () => void; onSend: (subject: string, body: string, to: string) => void; busy: boolean }) {
  const [subject, setSubject] = useState(p.subject);
  const [body, setBody] = useState(p.body);
  const [to, setTo] = useState(p.to ?? '');
  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSend(subject, body, to); }}>
        <div className="modal-head"><h2>Demande d’avis · {p.client}</h2><button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>À</label><input className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="adresse e-mail du client" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Objet</label><input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Message</label><textarea className="input" rows={11} required value={body} onChange={(e) => setBody(e.target.value)} /></div>
        </div>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button></div>
      </form>
    </div>
  );
}

function SettingsForm({ initial, onSaved, onError }: { initial: Settings; onSaved: () => void; onError: (t: string) => void }) {
  const [s, setS] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/api/reminders/reviews/settings', { method: 'PUT', body: s }); onSaved(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
      <div className="field">
        <label>Lien de la page d’avis (Google, Trustpilot…)</label>
        <input className="input" value={s.reviewUrl} onChange={(e) => setS({ ...s, reviewUrl: e.target.value })} placeholder="https://g.page/r/…/review" />
        <span className="muted" style={{ fontSize: '0.8rem' }}>Sur Google : fiche d’établissement → « Demander des avis » → copier le lien.</span>
      </div>
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={s.autoSend} onChange={(e) => setS({ ...s, autoSend: e.target.checked })} style={{ marginTop: 4 }} />
        <span><strong>Envoi automatique</strong><br /><span className="muted" style={{ fontSize: '0.86rem' }}>Les demandes partent toutes seules, en semaine entre 8 h et 18 h, une passe par jour (10 maximum). Désactivé : vous validez chaque demande depuis l’onglet « À envoyer ».</span></span>
      </label>
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}><input type="checkbox" checked={s.copyToSelf} onChange={(e) => setS({ ...s, copyToSelf: e.target.checked })} /> Recevoir une copie de chaque demande (Cci)</label>
      <div className="row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div className="field"><label>Délai après le paiement (jours)</label><input className="input" inputMode="numeric" style={{ width: 120 }} value={s.delayDays} onChange={(e) => setS({ ...s, delayDays: Number(e.target.value) || 0 })} /></div>
        <div className="field"><label>Ne plus demander après (jours)</label><input className="input" inputMode="numeric" style={{ width: 120 }} value={s.maxAgeDays} onChange={(e) => setS({ ...s, maxAgeDays: Number(e.target.value) || 7 })} /></div>
        <div className="field"><label>Montant TTC minimum (€)</label><input className="input" inputMode="numeric" style={{ width: 120 }} value={s.minAmount} onChange={(e) => setS({ ...s, minAmount: Number(e.target.value) || 0 })} /></div>
      </div>
      <div className="field"><label>Objet</label><input className="input" value={s.subject} onChange={(e) => setS({ ...s, subject: e.target.value })} /></div>
      <div className="field"><label>Message</label><textarea className="input" rows={10} value={s.body} onChange={(e) => setS({ ...s, body: e.target.value })} /></div>
      <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>Variables utilisables : <span className="mono">{PLACEHOLDERS}</span>. Une seule demande par client sur 12 mois ; pas de demande si la facture a été corrigée par une note de crédit.</p>
      <div><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer les réglages'}</button></div>
    </div>
  );
}
