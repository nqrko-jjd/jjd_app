'use client';
import { SkeletonRows, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl } from '@/lib/api';
import { PageHead, formatDateBE } from '@/lib/ui';
import { WorksitePicker, type WsPickerOption } from '@/components/WorksitePicker';
import { NewWorksiteWizard } from '@/components/NewWorksiteWizard';
import { MailReader, openAttachment, type ReaderAttachment } from '@/components/MailReader';
import { INTERVENTION_PROBLEM_TYPES, INTERVENTION_PROBLEM_TYPE_LABEL } from '@jjd/shared';
import { Mail, Sparkles, Plus } from 'lucide-react';

type Kind = 'lead' | 'appointment' | 'worksite_note' | 'payment_reminder' | 'other';

interface Extracted {
  requesterName: string | null; requesterPhone: string | null; problemType: string | null;
  urgent: boolean; proposedDate: string | null; proposedLocation: string | null;
  amount: number | null; reference: string | null; companyOrWorksiteHint: string | null;
}
interface Suggestion {
  id: string; kind: Kind; subject: string | null; fromAddress: string | null; receivedAt: string | null;
  summary: string | null; status: string; extracted: Extracted | null;
  worksite: { id: string; ref: string; title: string } | null;
}
type Picker = { worksites: { id: string; name: string; city?: string | null }[]; people?: { id: string; name: string; role?: string }[] };
/** Ouvre l'assistant de création de chantier (valeurs reprises du mail) ; `done` reçoit l'id du chantier créé. */
type NewWorksite = (s: Suggestion, done: (id: string) => void) => void;

const KIND_LABEL: Record<Kind, string> = {
  lead: 'Nouvelle demande', appointment: 'Rendez-vous', worksite_note: 'Note chantier',
  payment_reminder: 'Rappel de paiement', other: 'Autre',
};
const KIND_TABS: { key: Kind | ''; label: string }[] = [
  { key: '', label: 'Tous' }, { key: 'lead', label: 'Demandes' }, { key: 'appointment', label: 'Rendez-vous' },
  { key: 'worksite_note', label: 'Notes chantier' }, { key: 'payment_reminder', label: 'Paiements' }, { key: 'other', label: 'Autre' },
];
const wsToPicker = (w: { id: string; name: string; city?: string | null }): WsPickerOption => ({ id: w.id, ref: w.name.split(' · ')[0]!, title: w.name, city: w.city ?? null });

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BoiteIaPage() {
  const [kind, setKind] = useState<Kind | ''>('');
  const [status, setStatus] = useState('pending');
  const qs = new URLSearchParams({ status });
  if (kind) qs.set('kind', kind);
  const { data, loading, reload } = useApi<{ items: Suggestion[] }>(`/api/mail-suggestions?${qs}`);
  const { data: pick, reload: reloadPick } = useApi<Picker>('/api/meta/pickers');
  const [wizard, setWizard] = useState<{ s: Suggestion; done: (id: string) => void } | null>(null);
  const openWizard: NewWorksite = (sg, done) => setWizard({ s: sg, done });
  const worksiteOpts: WsPickerOption[] = (pick?.worksites ?? []).map(wsToPicker);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sourceOpenId, setSourceOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function dismiss(s: Suggestion) {
    if (!window.confirm('Rejeter cette suggestion ? Rien ne sera créé.')) return;
    setBusy(s.id);
    try { await api(`/api/mail-suggestions/${s.id}`, { method: 'PATCH', body: { status: 'dismissed' } }); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function apply(s: Suggestion, body: Record<string, unknown>) {
    setBusy(s.id); setErr(null);
    try { await api(`/api/mail-suggestions/${s.id}/apply`, { method: 'POST', body }); setOpenId(null); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHead
        eyebrow="IA"
        title="Boîte IA"
        sub="Suggestions détectées dans les mails reçus — rien n'est créé sans validation."
      />

      <div className="row" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        {KIND_TABS.map((t) => (
          <button key={t.key} className={`btn ${kind === t.key ? 'primary' : ''}`} onClick={() => setKind(t.key)}>{t.label}</button>
        ))}
        <select className="select" style={{ maxWidth: 170, marginLeft: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">À traiter</option>
          <option value="applied">Validées</option>
          <option value="dismissed">Rejetées</option>
          <option value="all">Toutes</option>
        </select>
      </div>

      {err && <p className="state error" role="alert">{err}</p>}
      {loading && <SkeletonRows />}
      {!loading && data && data.items.length === 0 && (
        <EmptyState icon={Mail} title="Rien à traiter ici" text="Les suggestions détectées dans les mails reçus apparaîtront dans cette liste." />
      )}

      <div className="grid" style={{ gap: '0.75rem' }}>
        {data?.items.map((s) => (
          <div key={s.id} className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.7rem' }}>
              <div>
                <div className="row" style={{ gap: '0.4rem', marginBottom: '0.3rem' }}>
                  <span className="badge plain"><Sparkles size={12} style={{ marginRight: 4 }} />{KIND_LABEL[s.kind]}</span>
                  {s.extracted?.urgent && <span className="badge crit">Urgent</span>}
                  {s.worksite && <span className="badge ok">{s.worksite.ref}</span>}
                </div>
                <strong>{s.summary ?? s.subject ?? '(sans résumé)'}</strong>
                <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {s.fromAddress ?? '—'} · {formatDateBE(s.receivedAt)}{s.subject ? ` · ${s.subject}` : ''}
                </div>
                {s.kind === 'payment_reminder' && (s.extracted?.amount || s.extracted?.reference) && (
                  <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                    {s.extracted?.amount != null ? `${s.extracted.amount} €` : ''}{s.extracted?.reference ? ` · réf. ${s.extracted.reference}` : ''}
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: '0.4rem', flexShrink: 0 }}>
                <button className="btn ghost" onClick={() => setSourceOpenId(sourceOpenId === s.id ? null : s.id)}>
                  {sourceOpenId === s.id ? 'Masquer le mail' : 'Voir le mail'}
                </button>
                {s.status === 'pending' && (
                  <>
                    <button className="btn" disabled={!!busy} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                      {openId === s.id ? 'Fermer' : 'Valider'}
                    </button>
                    <button className="btn ghost" disabled={!!busy} onClick={() => dismiss(s)}>Rejeter</button>
                  </>
                )}
                {s.status !== 'pending' && <span className={`badge ${s.status === 'applied' ? 'ok' : 'plain'}`}>{s.status === 'applied' ? 'Validée' : 'Rejetée'}</span>}
              </div>
            </div>

            {sourceOpenId === s.id && <MailSource id={s.id} />}

            {openId === s.id && (
              <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--line)' }}>
                {s.kind === 'lead' && <LeadForm s={s} busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
                {s.kind === 'appointment' && <AppointmentForm s={s} opts={worksiteOpts} newWorksite={openWizard} busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
                {s.kind === 'worksite_note' && <NoteForm s={s} opts={worksiteOpts} newWorksite={openWizard} busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
                {(s.kind === 'payment_reminder' || s.kind === 'other') && <PlainForm busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
              </div>
            )}
          </div>
        ))}
      </div>

      {wizard && (
        <NewWorksiteWizard
          people={pick?.people ?? []}
          prefill={{ title: (wizard.s.summary ?? wizard.s.subject ?? '').replace(/^(re|tr|fwd?)\s*:\s*/i, '').slice(0, 120), description: [wizard.s.summary, wizard.s.subject ? `Mail : ${wizard.s.subject}` : null, wizard.s.fromAddress ? `De : ${wizard.s.fromAddress}` : null].filter(Boolean).join('\n') }}
          onClose={() => setWizard(null)}
          onCreated={(w) => { const cb = wizard.done; setWizard(null); reloadPick(); if (w) cb(w.id); }}
        />
      )}
    </>
  );
}

function MailSource({ id }: { id: string }) {
  const { data, loading, error } = useApi<{
    subject: string; from: string; to: string; receivedAt: string | null; text: string; html: string | null;
    attachments: { index: number; filename: string; contentType: string; size: number }[];
  }>(`/api/mail-suggestions/${id}/source`);
  if (loading) return <p className="muted" style={{ marginTop: '0.7rem' }}>Chargement du mail…</p>;
  if (error || !data) return <p className="state error" style={{ marginTop: '0.7rem' }}>{error ?? 'Mail introuvable'}</p>;
  const attachments: ReaderAttachment[] = data.attachments.map((a) => ({
    name: a.filename, size: a.size, type: a.contentType,
    onOpen: () => openAttachment(`/api/mail-suggestions/${id}/attachment/${a.index}`, a.filename, a.contentType),
  }));
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <MailReader subject={data.subject} from={data.from} to={data.to} date={data.receivedAt} html={data.html} text={data.text} attachments={attachments} />
    </div>
  );
}

function WorksiteChoice({ s, value, onChange, opts, newWorksite }: { s: Suggestion; value: string; onChange: (id: string) => void; opts: WsPickerOption[]; newWorksite: NewWorksite }) {
  return (
    <div className="field">
      <label>Chantier</label>
      <WorksitePicker value={value} onChange={onChange} options={opts} />
      {!value && (
        <div className="row" style={{ gap: '0.6rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '0.82rem' }}>Aucun chantier ne correspond ?</span>
          <button type="button" className="btn" onClick={() => newWorksite(s, onChange)}><Plus size={14} style={{ marginRight: 4 }} />Créer un nouveau chantier</button>
        </div>
      )}
    </div>
  );
}

function LeadForm({ s, busy, onSubmit }: { s: Suggestion; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [v, setV] = useState({
    title: s.summary ?? '', requesterName: s.extracted?.requesterName ?? '', requesterPhone: s.extracted?.requesterPhone ?? '',
    problemType: s.extracted?.problemType ?? '', urgent: s.extracted?.urgent ?? false, note: '',
  });
  return (
    <div className="grid" style={{ gap: '0.6rem' }}>
      <div className="field"><label>Titre de la piste</label><input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></div>
      <div className="row" style={{ gap: '0.6rem' }}>
        <div className="field" style={{ flex: 1 }}><label>Demandeur</label><input className="input" value={v.requesterName} onChange={(e) => setV({ ...v, requesterName: e.target.value })} /></div>
        <div className="field" style={{ flex: 1 }}><label>Téléphone</label><input className="input" value={v.requesterPhone} onChange={(e) => setV({ ...v, requesterPhone: e.target.value })} /></div>
      </div>
      <div className="row" style={{ gap: '0.6rem', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Type de problème</label>
          <select className="select" value={v.problemType} onChange={(e) => setV({ ...v, problemType: e.target.value })}>
            <option value="">—</option>
            {INTERVENTION_PROBLEM_TYPES.map((p) => <option key={p} value={p}>{INTERVENTION_PROBLEM_TYPE_LABEL[p]}</option>)}
          </select>
        </div>
        <label className="row" style={{ gap: '0.4rem', marginBottom: '0.6rem' }}>
          <input type="checkbox" checked={v.urgent} onChange={(e) => setV({ ...v, urgent: e.target.checked })} /> Urgent
        </label>
      </div>
      <button className="btn primary" disabled={busy || !v.title.trim()} onClick={() => onSubmit(v)}>
        {busy ? 'Création…' : 'Créer la piste Pipeline'}
      </button>
    </div>
  );
}

function AppointmentForm({ s, opts, newWorksite, busy, onSubmit }: { s: Suggestion; opts: WsPickerOption[]; newWorksite: NewWorksite; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [worksiteId, setWorksiteId] = useState(s.worksite?.id ?? '');
  const [v, setV] = useState({
    title: s.summary ?? 'Rendez-vous', startAt: toDatetimeLocal(s.extracted?.proposedDate ?? null), durationMin: 60, note: s.extracted?.proposedLocation ?? '',
  });
  return (
    <div className="grid" style={{ gap: '0.6rem' }}>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Valider ajoute ce rendez-vous au planning du chantier, statut <strong>« à confirmer »</strong> — comme un créneau proposé mais pas encore garanti, à toi de le confirmer ensuite dans Planning.
      </p>
      <WorksiteChoice s={s} value={worksiteId} onChange={setWorksiteId} opts={opts} newWorksite={newWorksite} />
      <div className="field"><label>Titre</label><input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></div>
      <div className="row" style={{ gap: '0.6rem' }}>
        <div className="field" style={{ flex: 1 }}><label>Date et heure</label><input className="input" type="datetime-local" value={v.startAt} onChange={(e) => setV({ ...v, startAt: e.target.value })} /></div>
        <div className="field" style={{ flex: 1 }}>
          <label>Durée</label>
          <select className="select" value={v.durationMin} onChange={(e) => setV({ ...v, durationMin: Number(e.target.value) })}>
            {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60}h${m % 60 ? m % 60 : ''}` : `${m} min`}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Note / lieu</label><textarea className="input" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <button className="btn primary" disabled={busy || !worksiteId || !v.startAt} onClick={() => onSubmit({ worksiteId, title: v.title, startAt: new Date(v.startAt).toISOString(), durationMin: v.durationMin, note: v.note })}>
        {busy ? 'Création…' : 'Ajouter au planning (à confirmer)'}
      </button>
      {!worksiteId && <p className="muted" style={{ fontSize: '0.78rem' }}>Choisis le chantier concerné pour activer la création.</p>}
    </div>
  );
}

function NoteForm({ s, opts, newWorksite, busy, onSubmit }: { s: Suggestion; opts: WsPickerOption[]; newWorksite: NewWorksite; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [worksiteId, setWorksiteId] = useState(s.worksite?.id ?? '');
  const [body, setBody] = useState(s.summary ?? '');
  const [mode, setMode] = useState<'note' | 'intervention'>('note');
  const tomorrow = new Date(Date.now() + 86400000);
  const [iv, setIv] = useState({ title: s.summary ?? 'Intervention', date: toDatetimeLocal(tomorrow.toISOString()).slice(0, 10), start: '08:30', end: '17:00' });
  const validIv = !!iv.date && !!iv.start && !!iv.end && iv.end > iv.start && !!iv.title.trim();
  return (
    <div className="grid" style={{ gap: '0.6rem' }}>
      <div className="row" style={{ gap: '0.4rem' }}>
        <button type="button" className={`btn ${mode === 'note' ? 'primary' : ''}`} onClick={() => setMode('note')}>Poster une note</button>
        <button type="button" className={`btn ${mode === 'intervention' ? 'primary' : ''}`} onClick={() => setMode('intervention')}>Créer une intervention</button>
      </div>
      <WorksiteChoice s={s} value={worksiteId} onChange={setWorksiteId} opts={opts} newWorksite={newWorksite} />
      {mode === 'note' ? (
        <>
          <div className="field"><label>Note de suivi</label><textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>Le mail (avec ses pièces jointes) et cette note sont classés dans l’onglet <strong>« Suivi mails »</strong> du chantier. Le bureau seul les voit : ni le fil de discussion, ni les équipes.</p>
          <button className="btn primary" disabled={busy || !worksiteId || !body.trim()} onClick={() => onSubmit({ worksiteId, body })}>
            {busy ? 'Enregistrement…' : 'Ajouter au suivi du chantier'}
          </button>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Valider ajoute cette intervention au planning du chantier, statut <strong>« à confirmer »</strong> : à toi de désigner l’équipe et de la confirmer ensuite dans Planning.
          </p>
          <div className="field"><label>Titre</label><input className="input" value={iv.title} onChange={(e) => setIv({ ...iv, title: e.target.value })} /></div>
          <div className="row" style={{ gap: '0.6rem' }}>
            <div className="field" style={{ flex: 1 }}><label>Date</label><input className="input" type="date" value={iv.date} onChange={(e) => setIv({ ...iv, date: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>De</label><input className="input" type="time" value={iv.start} onChange={(e) => setIv({ ...iv, start: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>À</label><input className="input" type="time" value={iv.end} onChange={(e) => setIv({ ...iv, end: e.target.value })} /></div>
          </div>
          <div className="field"><label>Mission (reprise du mail, modifiable)</label><textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>Le mail et la mission sont aussi classés dans l’onglet « Suivi mails » du chantier (bureau uniquement).</p>
          <button className="btn primary" disabled={busy || !worksiteId || !validIv} onClick={() => onSubmit({
            worksiteId, asIntervention: true, title: iv.title, body,
            startAt: new Date(`${iv.date}T${iv.start}:00`).toISOString(), endAt: new Date(`${iv.date}T${iv.end}:00`).toISOString(),
          })}>
            {busy ? 'Création…' : 'Ajouter au planning (à confirmer)'}
          </button>
        </>
      )}
      {!worksiteId && <p className="muted" style={{ fontSize: '0.78rem' }}>Choisis le chantier concerné pour activer la création.</p>}
      {s.worksite && <Link href={`/app/chantiers/${s.worksite.id}`} className="hint">Ouvrir le chantier pressenti →</Link>}
    </div>
  );
}

function PlainForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="grid" style={{ gap: '0.6rem' }}>
      <div className="field"><label>Note (facultatif)</label><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <button className="btn primary" disabled={busy} onClick={() => onSubmit({ note })}>{busy ? 'Enregistrement…' : 'Marquer comme pris en compte'}</button>
    </div>
  );
}
