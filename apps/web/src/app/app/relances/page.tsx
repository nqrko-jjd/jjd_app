'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { PageHead, formatEur, formatDateBE } from '@/lib/ui';
import { SkeletonRows, ErrorState, EmptyState } from '@/components/States';
import { BellRing } from 'lucide-react';

interface Step { daysAfterDue: number; subject: string; body: string }
interface Settings { autoSend: boolean; copyToSelf: boolean; minBalance: number; minDaysBetween: number; steps: Step[] }
interface Proposal {
  documentId: string; number: string | null; client: string; contactId: string | null; to: string | null; balance: number; dueOn: string | null; daysLate: number;
  step: number; stepCount: number; subject: string; body: string; blocked: string | null; lastReminderAt: string | null;
}
interface HistoryRow { id: string; step: number; status: string; auto: boolean; toEmail: string | null; subject: string | null; error: string | null; sentAt: string | null; createdAt: string; daysLate: number | null; balance: number | null; document: { id: string; number: string | null; status: string; contact: { name: string } | null } }
interface Data { emailConfigured: boolean; settings: Settings; proposals: Proposal[]; history: HistoryRow[] }

const PLACEHOLDERS = '{client} {numero} {montant} {restant} {echeance} {jours} {communication} {societe} {telephone}';

/**
 * Relances de paiement : factures échues à relancer (une proposition par facture, avec l'étape atteinte), historique, et réglages du calendrier
 * (jours de retard, textes, envoi automatique). Rien ne part sans validation tant que l'envoi automatique n'est pas activé.
 */
export default function RemindersPage() {
  const { data, error, loading, reload } = useApi<Data>('/api/reminders');
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
  const totalDue = data.proposals.reduce((s, p) => s + p.balance, 0);

  return (
    <>
      <PageHead
        eyebrow="Facturation"
        title="Relances de paiement"
        sub={`${data.proposals.length} facture${data.proposals.length > 1 ? 's' : ''} à relancer · ${formatEur(totalDue)} TTC · ${data.settings.autoSend ? 'envoi automatique activé' : 'à valider une par une'}`}
      />
      {!data.emailConfigured && <div className="badge warn" style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>L’envoi par e-mail n’est pas configuré sur ce serveur : les relances ne peuvent pas partir.</div>}
      {msg && <div className={`badge ${msg.ok ? 'ok' : 'crit'}`} style={{ marginBottom: '1rem', padding: '0.5rem 0.8rem' }}>{msg.text}</div>}

      <div className="seg" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'todo' ? 'on' : ''} onClick={() => setTab('todo')}>À relancer · {data.proposals.length}</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Historique</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Réglages</button>
      </div>

      {tab === 'todo' && (data.proposals.length === 0
        ? <EmptyState icon={BellRing} title="Aucune relance à faire" text="Toutes les factures échues ont déjà été relancées ou sont encore dans les délais du calendrier de relances." />
        : (
          <div className="panel doc-list">
            {data.proposals.map((p) => (
              <div key={p.documentId} className="doc-item">
                <div className="doc-item-body">
                  <div className="doc-item-top" style={{ flexWrap: 'wrap' }}>
                    <Link href={`/app/documents/${p.documentId}`} className="mono doc-item-num">{p.number}</Link>
                    <span className={`badge ${p.step >= p.stepCount ? 'crit' : 'warn'}`}>Relance {p.step}/{p.stepCount}</span>
                    <span className="badge crit">{p.daysLate} j de retard</span>
                    {p.blocked && <span className="badge plain" title={p.blocked}>✉ pas d’e-mail</span>}
                    <span className="doc-item-amount" style={{ marginLeft: 'auto' }}>{formatEur(p.balance)}</span>
                  </div>
                  <div className="doc-item-title">{p.client}</div>
                  <div className="doc-item-meta">
                    <span>{p.to ?? '—'}</span>
                    <span>Échue le {p.dueOn ? formatDateBE(p.dueOn) : '—'}{p.lastReminderAt ? ` · dernière relance le ${formatDateBE(p.lastReminderAt)}` : ''}</span>
                  </div>
                  <div className="row" style={{ marginTop: '0.5rem', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button className="btn primary" disabled={!!busy || !data.emailConfigured} onClick={() => setEdit(p)}>Relire et envoyer</button>
                    <button className="btn" disabled={!!busy} onClick={() => run(`skip-${p.documentId}`, async () => { await api('/api/reminders/skip', { method: 'POST', body: { documentId: p.documentId, step: p.step } }); })}>Ignorer cette étape</button>
                    {p.contactId && <button className="btn ghost" disabled={!!busy} onClick={() => { if (window.confirm(`Ne plus relancer ${p.client} ?`)) run(`off-${p.contactId}`, async () => { await api(`/api/reminders/contact/${p.contactId}`, { method: 'POST', body: { off: true } }); }); }}>Ne plus relancer ce client</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'history' && (data.history.length === 0
        ? <EmptyState icon={BellRing} title="Aucune relance envoyée" text="L’historique des relances envoyées (et des envois échoués) apparaîtra ici." />
        : (
          <div className="panel doc-list">
            {data.history.map((h) => (
              <div key={h.id} className="doc-item">
                <div className="doc-item-body">
                  <div className="doc-item-top" style={{ flexWrap: 'wrap' }}>
                    <Link href={`/app/documents/${h.document.id}`} className="mono doc-item-num">{h.document.number}</Link>
                    <span className="badge plain">Relance {h.step}</span>
                    <span className={`badge ${h.status === 'sent' ? 'ok' : 'crit'}`}>{h.status === 'sent' ? (h.auto ? 'Envoyée (auto)' : 'Envoyée') : 'Échec'}</span>
                    {h.document.status === 'paid' && <span className="badge ok">Payée depuis</span>}
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.84rem' }}>{formatDateBE(h.sentAt ?? h.createdAt)}</span>
                  </div>
                  <div className="doc-item-title">{h.document.contact?.name ?? '—'}</div>
                  <div className="doc-item-meta"><span>{h.toEmail ?? '—'}</span><span>{h.balance != null ? formatEur(h.balance) : ''}{h.daysLate != null ? ` · ${h.daysLate} j de retard` : ''}</span></div>
                  {h.error && <div className="muted" style={{ color: 'var(--crit)', fontSize: '0.82rem' }}>{h.error}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'settings' && <SettingsForm initial={data.settings} onSaved={() => { setMsg({ ok: true, text: 'Réglages enregistrés.' }); reload(); }} onError={(t) => setMsg({ ok: false, text: t })} />}

      {edit && <SendModal p={edit} onClose={() => setEdit(null)} onSend={(subject, body, to) => run(`send-${edit.documentId}`, async () => { const r = await api<{ note: string }>('/api/reminders/send', { method: 'POST', body: { documentId: edit.documentId, step: edit.step, subject, body, ...(to ? { to } : {}) } }); setEdit(null); return r; })} busy={!!busy} />}
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
        <div className="modal-head"><h2>Relance {p.step}/{p.stepCount} · {p.number}</h2><button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="modal-body">
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>À</label><input className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="adresse e-mail du client" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Objet</label><input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Message</label><textarea className="input" rows={11} required value={body} onChange={(e) => setBody(e.target.value)} /><span className="muted" style={{ fontSize: '0.8rem' }}>La facture {p.number} est jointe en PDF.</span></div>
        </div>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la relance'}</button></div>
      </form>
    </div>
  );
}

function SettingsForm({ initial, onSaved, onError }: { initial: Settings; onSaved: () => void; onError: (t: string) => void }) {
  const [s, setS] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  const setStep = (i: number, patch: Partial<Step>) => setS((v) => ({ ...v, steps: v.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  async function save() {
    setBusy(true);
    try { await api('/api/reminders/settings', { method: 'PUT', body: s }); onSaved(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={s.autoSend} onChange={(e) => setS({ ...s, autoSend: e.target.checked })} style={{ marginTop: 4 }} />
        <span><strong>Envoi automatique</strong><br /><span className="muted" style={{ fontSize: '0.86rem' }}>Les relances partent toutes seules, en semaine entre 8 h et 18 h, une passe par jour (25 maximum). Désactivé : vous validez chaque relance depuis l’onglet « À relancer ».</span></span>
      </label>
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}><input type="checkbox" checked={s.copyToSelf} onChange={(e) => setS({ ...s, copyToSelf: e.target.checked })} /> Recevoir une copie de chaque relance (Cci)</label>
      <div className="row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div className="field"><label>Reste dû minimum (€ TTC)</label><input className="input" inputMode="decimal" style={{ width: 120 }} value={s.minBalance} onChange={(e) => setS({ ...s, minBalance: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
        <div className="field"><label>Délai minimum entre deux relances (jours)</label><input className="input" inputMode="numeric" style={{ width: 120 }} value={s.minDaysBetween} onChange={(e) => setS({ ...s, minDaysBetween: Number(e.target.value) || 1 })} /></div>
      </div>
      <div style={{ display: 'grid', gap: '0.8rem' }}>
        {s.steps.map((st, i) => (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '0.8rem', display: 'grid', gap: '0.5rem' }}>
            <div className="row" style={{ alignItems: 'center', gap: '0.6rem' }}>
              <strong>Relance {i + 1}</strong> à
              <input className="input" inputMode="numeric" style={{ width: 80 }} value={st.daysAfterDue} onChange={(e) => setStep(i, { daysAfterDue: Number(e.target.value) || 1 })} /> jours après l’échéance
              {s.steps.length > 1 && <button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setS({ ...s, steps: s.steps.filter((_, j) => j !== i) })}>Retirer</button>}
            </div>
            <input className="input" value={st.subject} onChange={(e) => setStep(i, { subject: e.target.value })} aria-label={`Objet de la relance ${i + 1}`} />
            <textarea className="input" rows={7} value={st.body} onChange={(e) => setStep(i, { body: e.target.value })} aria-label={`Texte de la relance ${i + 1}`} />
          </div>
        ))}
        {s.steps.length < 6 && <button type="button" className="btn" onClick={() => setS({ ...s, steps: [...s.steps, { daysAfterDue: (s.steps[s.steps.length - 1]?.daysAfterDue ?? 30) + 15, subject: 'Rappel : facture {numero}', body: 'Bonjour,\n\nLa facture {numero} de {restant} TTC reste impayée ({jours} jours de retard).\n\nCordialement,\n{societe}' }] })}>+ Ajouter une relance</button>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>Variables utilisables dans l’objet et le texte : <span className="mono">{PLACEHOLDERS}</span></p>
      <div><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer les réglages'}</button></div>
    </div>
  );
}
