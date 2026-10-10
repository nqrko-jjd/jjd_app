'use client';
import { tr } from '@/lib/ui-language';
import { useEffect, useMemo, useState } from 'react';
import { Mail, Paperclip, Plus, Search, StickyNote, Trash2, ArrowLeft, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { Avatar, MailReader, fullDate, listDate, openAttachment, parseAddress, type ReaderAttachment } from '@/components/MailReader';

interface Row { id: string; kind: 'mail' | 'note'; subject: string | null; fromAddress: string | null; at: string; snippet: string; hasNote: boolean; attachmentCount: number }
interface Detail {
  id: string; kind: 'mail' | 'note'; subject: string | null; fromAddress: string | null; toAddress: string | null; at: string;
  bodyText: string | null; bodyHtml: string | null; note: string | null;
  attachments: { index: number; filename: string; contentType: string; size: number; available: boolean; skipped: string | null }[];
}

/** Onglet « Suivi mails » d'un chantier : les mails rattachés et les notes de suivi, lisibles comme dans Outlook. Réservé au bureau. */
export function WorksiteMails({ worksiteId, onChanged }: { worksiteId: string; onChanged?: () => void }) {
  const base = `/api/worksites/${worksiteId}/mails`;
  const { data, loading, error, reload } = useApi<{ items: Row[] }>(base);
  const [sel, setSel] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState('');

  const items = data?.items ?? [];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((m) => [m.subject, m.fromAddress, m.snippet].some((x) => (x ?? '').toLowerCase().includes(s))) : items;
  }, [items, q]);
  // sur grand écran, le plus récent s'ouvre tout seul ; sur mobile on garde la liste d'abord
  useEffect(() => {
    if (!sel && !composing && shown.length && typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches) setSel(shown[0]!.id);
  }, [shown, sel, composing]);

  const refresh = () => { reload(); onChanged?.(); };
  const reading = !!sel || composing;

  return (
    <section className="mx-wrap">
      <div className="mx-toolbar">
        <div>
          <div className="section-title" style={{ margin: 0 }}>Suivi des mails</div>
          <div className="mx-sub"><Lock size={12} /> Visible du bureau uniquement — jamais des chefs de chantier ni des ouvriers.</div>
        </div>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <label className="mx-search"><Search size={15} /><input className="input" placeholder={tr("Rechercher…")} aria-label="Rechercher dans les mails" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn primary" onClick={() => { setComposing(true); setSel(null); }}><Plus size={15} style={{ marginRight: 4 }} />{tr("Ajouter une note")}</button>
        </div>
      </div>

      {loading && <SkeletonRows rows={4} height={64} />}
      {error && !data && <ErrorState message={error} onRetry={reload} />}
      {data && items.length === 0 && !composing && (
        <EmptyState
          icon={Mail}
          title="Aucun mail suivi pour l’instant"
          text="Quand tu valides une suggestion de la Boîte IA pour ce chantier, le mail (avec ses pièces jointes) et ta note apparaissent ici. Tu peux aussi ajouter une note à la main."
          action={<button className="btn primary" onClick={() => setComposing(true)}>Ajouter une note</button>}
        />
      )}

      {data && (items.length > 0 || composing) && (
        <div className={`mx${reading ? ' reading' : ''}`}>
          <div className="mx-list" role="list">
            {shown.length === 0 && <p className="muted" style={{ padding: '1rem' }}>Aucun résultat pour « {q} ».</p>}
            {shown.map((m) => {
              const who = m.kind === 'note' ? 'Note de suivi' : parseAddress(m.fromAddress).name || 'Expéditeur inconnu';
              return (
                <button key={m.id} type="button" role="listitem" className={`mx-item${sel === m.id ? ' on' : ''}`} onClick={() => { setSel(m.id); setComposing(false); }}>
                  {m.kind === 'note' ? <span className="mx-avatar mx-avatar-note" aria-hidden="true"><StickyNote size={17} /></span> : <Avatar name={who} />}
                  <span className="mx-item-main">
                    <span className="mx-item-top"><strong className="mx-item-who">{who}</strong><span className="mx-item-date">{listDate(m.at)}</span></span>
                    <span className="mx-item-subject">{m.subject?.trim() || (m.kind === 'note' ? m.snippet.slice(0, 70) : '(sans objet)')}</span>
                    <span className="mx-item-snippet">{m.kind === 'note' ? 'Note' : m.snippet || '—'}</span>
                    {(m.attachmentCount > 0 || (m.hasNote && m.kind === 'mail')) && (
                      <span className="mx-item-tags">
                        {m.attachmentCount > 0 && <span className="mx-tag"><Paperclip size={11} /> {m.attachmentCount}</span>}
                        {m.hasNote && m.kind === 'mail' && <span className="mx-tag mx-tag-note"><StickyNote size={11} /> note</span>}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mx-pane">
            <button type="button" className="btn ghost mx-back" onClick={() => { setSel(null); setComposing(false); }}><ArrowLeft size={15} style={{ marginRight: 4 }} />Retour à la liste</button>
            {composing
              ? <NoteComposer base={base} onCancel={() => setComposing(false)} onSaved={(id) => { setComposing(false); setSel(id); refresh(); }} />
              : sel
                ? <MailDetail key={sel} base={base} id={sel} onGone={() => { setSel(null); refresh(); }} onSaved={refresh} />
                : <p className="muted" style={{ padding: '2rem', textAlign: 'center' }}>Choisis un mail dans la liste pour le lire.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function NoteComposer({ base, onCancel, onSaved }: { base: string; onCancel: () => void; onSaved: (id: string) => void }) {
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { const r = await api<{ id: string }>(base, { method: 'POST', body: { note, subject: subject || undefined } }); onSaved(r.id); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="mx-reader">
      <header className="mx-head"><h2 className="mx-subject">Nouvelle note de suivi</h2><div className="mx-meta">Appel, décision, information à garder : visible du bureau seulement.</div></header>
      <div className="mx-compose">
        <div className="field"><label>Objet (facultatif)</label><input className="input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. Appel du syndic" /></div>
        <div className="field"><label>Note</label><textarea className="input" rows={7} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ce qui a été dit ou décidé…" /></div>
        {err && <p className="state error" role="alert">{err}</p>}
        <div className="row" style={{ gap: '0.5rem' }}>
          <button className="btn primary" disabled={busy || !note.trim()} onClick={save}>{busy ? tr("Enregistrement…") : 'Enregistrer la note'}</button>
          <button className="btn ghost" onClick={onCancel}>{tr("Annuler")}</button>
        </div>
      </div>
    </div>
  );
}

function MailDetail({ base, id, onGone, onSaved }: { base: string; id: string; onGone: () => void; onSaved: () => void }) {
  const { data, loading, error, reload } = useApi<Detail>(`${base}/${id}`);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setNote(data.note ?? ''); }, [data]);
  if (loading && !data) return <SkeletonRows rows={5} height={40} />;
  if (error || !data) return <ErrorState message={error ?? 'Introuvable'} onRetry={reload} />;
  const d = data;
  const dirty = (note ?? '') !== (d.note ?? '');

  async function saveNote() {
    setBusy(true); setErr(null);
    try { await api(`${base}/${id}`, { method: 'PATCH', body: { note: note ?? '' } }); reload(); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(d.kind === 'note' ? 'Supprimer cette note ?' : 'Retirer ce mail du suivi du chantier ? Il reste dans ta boîte mail.')) return;
    setBusy(true);
    try { await api(`${base}/${id}`, { method: 'DELETE' }); onGone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  const attachments: ReaderAttachment[] = d.attachments.map((a) => ({
    name: a.filename, size: a.size, type: a.contentType, available: a.available, reason: a.skipped,
    onOpen: () => openAttachment(`${base}/${id}/attachments/${a.index}`, a.filename, a.contentType),
  }));

  const noteBox = (
    <section className="mx-note">
      <div className="mx-note-head"><StickyNote size={15} /> {d.kind === 'note' ? 'Note' : tr("Note de suivi")}<span className="mx-note-lock"><Lock size={11} /> {tr("bureau uniquement")}</span></div>
      <textarea className="input" rows={d.kind === 'note' ? 8 : 3} value={note ?? ''} onChange={(e) => setNote(e.target.value)} placeholder={tr("Ajouter une note de suivi sur ce mail…")} />
      {err && <p className="state error" role="alert" style={{ margin: '0.4rem 0 0' }}>{err}</p>}
      <div className="row" style={{ gap: '0.5rem', marginTop: '0.5rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy || !dirty || (d.kind === 'note' && !(note ?? '').trim())} onClick={saveNote}>{busy ? tr("Enregistrement…") : dirty ? 'Enregistrer la note' : tr("Enregistrée")}</button>
        <button className="btn ghost" disabled={busy} onClick={remove}><Trash2 size={14} style={{ marginRight: 4 }} />{d.kind === 'note' ? 'Supprimer la note' : 'Retirer du suivi'}</button>
      </div>
    </section>
  );

  if (d.kind === 'note') {
    return (
      <article className="mx-reader">
        <header className="mx-head"><h2 className="mx-subject">{d.subject?.trim() || 'Note de suivi'}</h2><div className="mx-meta">{fullDate(d.at)}</div></header>
        {noteBox}
      </article>
    );
  }
  return <MailReader subject={d.subject} from={d.fromAddress} to={d.toAddress} date={d.at} html={d.bodyHtml} text={d.bodyText} attachments={attachments}>{noteBox}</MailReader>;
}
