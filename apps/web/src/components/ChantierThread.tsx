'use client';
import { useEffect, useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/lib/ui';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { useMentionInput, splitMentions } from '@/lib/useMentionInput';

interface Msg {
  id: string; kind: string; body: string | null; fileUrl: string | null; thumbUrl: string | null;
  authorName: string | null; authorId?: string | null; createdAt: string; sharedWithClient?: boolean;
  mentionedNames?: string[];
}
interface ThreadData {
  thread: { id: string; closedAt: string | null };
  messages: Msg[];
  participants: { id: string; displayName: string | null; firstName: string }[];
}
interface ClientThreadData {
  thread: { id: string; closedAt: string | null };
  messages: Msg[];
}

function time(iso: string) {
  return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ChantierThread({ worksiteId }: { worksiteId: string }) {
  const { user } = useAuth();
  const canImport = !!user && !['worker', 'client'].includes(user.role);
  const isOffice = user?.role === 'admin' || user?.role === 'office';
  const { data, loading, reload } = useApi<ThreadData>(`/api/worksites/${worksiteId}/thread`);
  const [text, setText] = useState('');
  const [clientText, setClientText] = useState('');
  const [busy, setBusy] = useState(false);
  const mention = useMentionInput(text, setText);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'chat' | 'client' | 'gallery'>('chat');
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const clientEndRef = useRef<HTMLDivElement>(null);
  const media = (data?.messages ?? []).filter((m) => (m.kind === 'photo' || m.kind === 'video') && m.fileUrl);
  const { data: clientData, reload: reloadClient } = useApi<ClientThreadData>(
    isOffice && tab === 'client' ? `/api/worksites/${worksiteId}/thread/client` : null,
  );

  useEffect(() => { endRef.current?.scrollIntoView(); }, [data?.messages.length]);
  useEffect(() => { clientEndRef.current?.scrollIntoView(); }, [clientData?.messages.length]);

  async function sendClient() {
    if (!clientText.trim()) return;
    setBusy(true);
    await api(`/api/worksites/${worksiteId}/thread/client/messages`, { method: 'POST', body: { body: clientText.trim() } });
    setClientText('');
    setBusy(false);
    reloadClient();
  }
  async function toggleShare(m: Msg) {
    await api(`/api/worksites/${worksiteId}/thread/messages/${m.id}/share`, { method: 'PATCH', body: { shared: !m.sharedWithClient } });
    reload();
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    await api(`/api/worksites/${worksiteId}/thread/messages`, { method: 'POST', body: { body: text.trim() } });
    setText('');
    setBusy(false);
    reload();
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', f);
      await apiUpload(`/api/worksites/${worksiteId}/thread/photos`, fd);
    }
    setBusy(false);
    reload();
  }
  const voice = useVoiceRecorder(async (blob) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, `note-vocale.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
      await apiUpload(`/api/worksites/${worksiteId}/thread/voice`, fd);
      reload();
    } finally {
      setBusy(false);
    }
  });
  async function toggleClose() {
    const reopen = !!data?.thread.closedAt;
    if (!reopen && !confirm('Signaler le chantier comme terminé ?')) return;
    await api(`/api/worksites/${worksiteId}/thread/close`, { method: 'POST', body: { reopen } });
    reload();
  }
  async function importWhatsapp(files: FileList | null) {
    const zip = files?.[0];
    if (!zip) return;
    if (!confirm('Importer cet export WhatsApp ? Les messages iront dans le chat, les photos/vidéos dans les pièces jointes. Un import précédent pour ce chantier serait remplacé.')) {
      if (zipRef.current) zipRef.current.value = '';
      return;
    }
    setBusy(true);
    setImportMsg('Import en cours… (peut prendre une minute selon le nombre de photos)');
    try {
      const fd = new FormData();
      fd.append('zip', zip);
      const r = await apiUpload<{ imported: { texts: number; photos: number; videos: number; audios: number; files: number; skipped: number }; warnings: string[] }>(
        `/api/worksites/${worksiteId}/thread/import-whatsapp`, fd,
      );
      const { imported: im, warnings } = r;
      setImportMsg(
        `Importé : ${im.texts} message(s), ${im.photos} photo(s), ${im.videos} vidéo(s), ${im.audios} note(s) vocale(s), ${im.files} fichier(s)`
        + (im.skipped ? ` · ${im.skipped} média(s) introuvable(s)` : '')
        + (warnings.length ? ` — ${warnings.slice(0, 3).join(' ; ')}${warnings.length > 3 ? '…' : ''}` : ''),
      );
    } catch (e) {
      setImportMsg(`Échec de l’import : ${(e as Error).message}`);
    }
    setBusy(false);
    if (zipRef.current) zipRef.current.value = '';
    reload();
  }

  if (loading) return <div className="card card-pad muted">Chargement du fil…</div>;
  if (!data) return null;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="modal-head" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <strong>Fil de chantier</strong>{' '}
          <span className="muted" style={{ fontSize: '0.8rem' }}>{data.participants.length} participant(s)</span>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          {canImport && (
            <>
              <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => importWhatsapp(e.target.files)} />
              <button className="btn" onClick={() => zipRef.current?.click()} disabled={busy} title="Importer un export WhatsApp (.zip) : chat + photos">
                Importer WhatsApp
              </button>
            </>
          )}
          <button className={`btn ${data.thread.closedAt ? '' : 'primary'}`} onClick={toggleClose}>
            {data.thread.closedAt ? 'Rouvrir' : 'Chantier terminé'}
          </button>
        </div>
      </div>
      {importMsg && (
        <div className="muted" style={{ padding: '0.5rem 1.15rem', fontSize: '0.82rem', borderBottom: '1px solid var(--line)' }}>
          {importMsg}
        </div>
      )}

      <div className="thread-tabs">
        <button type="button" className={`thread-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>💬 Discussion</button>
        {isOffice && (
          <button type="button" className={`thread-tab${tab === 'client' ? ' active' : ''}`} onClick={() => setTab('client')}>👤 Client</button>
        )}
        <button type="button" className={`thread-tab${tab === 'gallery' ? ' active' : ''}`} onClick={() => setTab('gallery')}>
          🖼️ Galerie{media.length ? ` (${media.length})` : ''}
        </button>
      </div>

      {tab === 'gallery' ? (
        media.length === 0 ? (
          <div className="muted" style={{ padding: '1rem 1.15rem' }}>Aucune photo ni vidéo pour l’instant.</div>
        ) : (
          <div className="thread-gallery">
            {media.map((m) => (
              <div key={m.id} style={{ position: 'relative' }}>
                <a href={m.fileUrl!} target="_blank" rel="noreferrer" title={`${m.authorName ?? ''} · ${time(m.createdAt)}${m.body ? ` · ${m.body}` : ''}`}>
                  {m.kind === 'photo' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumbUrl ?? m.fileUrl!} alt="" />
                  ) : (
                    <video src={m.fileUrl!} preload="metadata" muted />
                  )}
                </a>
                {isOffice && (
                  <button
                    type="button"
                    className={`badge ${m.sharedWithClient ? 'ok' : 'plain'}`}
                    style={{ position: 'absolute', bottom: 4, left: 4, right: 4, fontSize: '0.68rem', cursor: 'pointer' }}
                    title={m.sharedWithClient ? 'Visible du client — cliquer pour retirer' : 'Partager cette photo avec le client'}
                    onClick={() => toggleShare(m)}
                  >
                    {m.sharedWithClient ? '👤 Partagée' : '👤 Partager'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === 'client' ? (
        <div style={{ maxHeight: 460, overflowY: 'auto', padding: '1rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div className="muted" style={{ fontSize: '0.78rem' }}>Conversation avec le client — visible dans son portail.</div>
          {(clientData?.messages.length ?? 0) === 0 && <div className="muted">Aucun message échangé avec le client.</div>}
          {(clientData?.messages ?? []).map((m) => (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: m.authorId ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>{m.authorName} · {time(m.createdAt)}</div>
              {m.body && (
                <div style={{ background: m.authorId ? 'var(--primary-soft)' : 'var(--surface-2)', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.9rem', maxWidth: '80%' }}>
                  {m.body}
                </div>
              )}
            </div>
          ))}
          <div ref={clientEndRef} />
        </div>
      ) : (
      <div style={{ maxHeight: 460, overflowY: 'auto', padding: '1rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {data.messages.length === 0 && <div className="muted">Aucun message. Lance la conversation ci-dessous.</div>}
        {data.messages.map((m) => {
          if (m.kind === 'status') {
            return (
              <div key={m.id} style={{ textAlign: 'center', margin: '0.3rem 0' }}>
                <span className="chip">● {m.body} · {time(m.createdAt)}</span>
              </div>
            );
          }
          const mine = !!m.authorId && m.authorId === user?.id;
          return (
            <div key={m.id} style={{ display: 'flex', gap: '0.5rem', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
              {!mine && <Avatar label={m.authorName ?? '?'} size={26} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>{mine ? 'Toi' : m.authorName} · {time(m.createdAt)}</div>
                {m.kind === 'photo' && m.fileUrl ? (
                  <a href={m.fileUrl} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.thumbUrl ?? m.fileUrl} alt="" style={{ maxWidth: 260, borderRadius: 10, border: '1px solid var(--line)' }} />
                  </a>
                ) : m.kind === 'video' && m.fileUrl ? (
                  <video src={m.fileUrl} controls preload="metadata" style={{ maxWidth: 280, borderRadius: 10, border: '1px solid var(--line)' }} />
                ) : m.kind === 'audio' && m.fileUrl ? (
                  <audio src={m.fileUrl} controls preload="metadata" style={{ maxWidth: 260 }} />
                ) : m.kind === 'file' && m.fileUrl ? (
                  <a href={m.fileUrl} target="_blank" rel="noreferrer" className="badge plain" style={{ fontSize: '0.8rem' }}>📎 {m.body || 'Fichier'}</a>
                ) : null}
                {m.body && m.kind !== 'file' && (
                  <div style={{
                    background: mine ? 'var(--primary-soft)' : 'var(--surface-2)',
                    borderRadius: 14, padding: '0.55rem 0.8rem', fontSize: '0.9rem',
                  }}>
                    {splitMentions(m.body, m.mentionedNames ?? []).map((seg, i) => (
                      seg.mention ? <span key={i} className="mention-tag">{seg.text}</span> : <span key={i}>{seg.text}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      )}

      {tab === 'client' && (
        <div className="row" style={{ padding: '0.8rem 1.15rem', borderTop: '1px solid var(--line)', gap: '0.5rem' }}>
          <input
            className="input"
            placeholder="Répondre au client…"
            value={clientText}
            onChange={(e) => setClientText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendClient())}
            style={{ flex: 1 }}
          />
          <button className="btn primary" onClick={sendClient} disabled={busy || !clientText.trim()}>Envoyer</button>
        </div>
      )}

      {tab === 'chat' && (
        <div className="row" style={{ padding: '0.8rem 1.15rem', borderTop: '1px solid var(--line)', gap: '0.5rem', position: 'relative' }}>
          {mention.open && (
            <div className="mention-menu" style={{ bottom: '100%', left: '1.15rem' }}>
              {mention.options.map((c) => (
                <button key={c.id} type="button" onClick={() => mention.pick(c)}>@{c.name}</button>
              ))}
            </div>
          )}
          <input
            className="input"
            placeholder="Écrire un message… (@ pour mentionner)"
            value={text}
            onChange={(e) => mention.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && mention.open) { mention.close(); return; }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (mention.open) mention.pick(mention.options[0]!);
                else send();
              }
            }}
            style={{ flex: 1 }}
          />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>📷</button>
          <button
            type="button"
            className={`btn ${voice.recording ? 'primary' : ''}`}
            onClick={() => (voice.recording ? voice.stop() : voice.start())}
            disabled={busy && !voice.recording}
            title={voice.recording ? 'Arrêter et envoyer' : 'Enregistrer une note vocale'}
          >
            {voice.recording ? '⏹️' : '🎤'}
          </button>
          <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>Envoyer</button>
        </div>
      )}
    </div>
  );
}
