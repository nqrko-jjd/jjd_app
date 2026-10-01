'use client';
import { SkeletonRows, EmptyState } from '@/components/States';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl } from '@/lib/api';
import { PageHead, formatDateBE } from '@/lib/ui';
import { WorksitePicker, type WsPickerOption } from '@/components/WorksitePicker';
import { INTERVENTION_PROBLEM_TYPES, INTERVENTION_PROBLEM_TYPE_LABEL } from '@jjd/shared';
import { Mail, Sparkles, Paperclip } from 'lucide-react';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

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
type Picker = { worksites: { id: string; name: string; city?: string | null }[] };

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
  const { data: pick } = useApi<Picker>('/api/meta/pickers');
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
                {s.kind === 'appointment' && <AppointmentForm s={s} opts={worksiteOpts} busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
                {s.kind === 'worksite_note' && <NoteForm s={s} opts={worksiteOpts} busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
                {(s.kind === 'payment_reminder' || s.kind === 'other') && <PlainForm busy={busy === s.id} onSubmit={(b) => apply(s, b)} />}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function MailSource({ id }: { id: string }) {
  const { data, loading, error } = useApi<{
    subject: string; from: string; receivedAt: string | null; text: string;
    attachments: { index: number; filename: string; contentType: string; size: number }[];
  }>(`/api/mail-suggestions/${id}/source`);
  const [openErr, setOpenErr] = useState<string | null>(null);

  async function openAttachment(index: number) {
    setOpenErr(null);
    try {
      const url = await apiBlobUrl(`/api/mail-suggestions/${id}/attachment/${index}`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setOpenErr((e as Error).message);
    }
  }

  return (
    <div style={{ marginTop: '0.7rem', padding: '0.7rem 0.9rem', background: 'var(--surface-2)', borderRadius: 8, fontSize: '0.84rem' }}>
      {loading && 'Chargement du mail…'}
      {error && <span className="state error">{error}</span>}
      {data && (
        <>
          <div className="muted" style={{ marginBottom: '0.5rem' }}>{data.from} · {formatDateBE(data.receivedAt)} · {data.subject}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 320, overflowY: 'auto', margin: 0 }}>{data.text}</pre>
          {data.attachments.length > 0 && (
            <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid var(--line)' }}>
              {data.attachments.map((a) => (
                <button key={a.index} type="button" className="btn ghost" style={{ fontSize: '0.78rem' }} onClick={() => openAttachment(a.index)}>
                  <Paperclip size={13} style={{ marginRight: 4 }} />{a.filename} <span className="muted">({formatSize(a.size)})</span>
                </button>
              ))}
            </div>
          )}
          {openErr && <p className="state error" style={{ marginTop: '0.4rem' }}>{openErr}</p>}
        </>
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

function AppointmentForm({ s, opts, busy, onSubmit }: { s: Suggestion; opts: WsPickerOption[]; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [worksiteId, setWorksiteId] = useState(s.worksite?.id ?? '');
  const [v, setV] = useState({
    title: s.summary ?? 'Rendez-vous', startAt: toDatetimeLocal(s.extracted?.proposedDate ?? null), durationMin: 60, note: s.extracted?.proposedLocation ?? '',
  });
  return (
    <div className="grid" style={{ gap: '0.6rem' }}>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Valider ajoute ce rendez-vous au planning du chantier, statut <strong>« à confirmer »</strong> — comme un créneau proposé mais pas encore garanti, à toi de le confirmer ensuite dans Planning.
      </p>
      <div className="field"><label>Chantier</label><WorksitePicker value={worksiteId} onChange={setWorksiteId} options={opts} /></div>
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

function NoteForm({ s, opts, busy, onSubmit }: { s: Suggestion; opts: WsPickerOption[]; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [worksiteId, setWorksiteId] = useState(s.worksite?.id ?? '');
  const [body, setBody] = useState(s.summary ?? '');
  return (
    <div className="grid" style={{ gap: '0.6rem' }}>
      <div className="field"><label>Chantier</label><WorksitePicker value={worksiteId} onChange={setWorksiteId} options={opts} /></div>
      <div className="field"><label>Note (postée dans le fil interne du chantier)</label><textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <button className="btn primary" disabled={busy || !worksiteId || !body.trim()} onClick={() => onSubmit({ worksiteId, body })}>
        {busy ? 'Envoi…' : 'Poster dans le fil du chantier'}
      </button>
      {!worksiteId && <p className="muted" style={{ fontSize: '0.78rem' }}>Choisis le chantier concerné pour activer l’envoi.</p>}
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
