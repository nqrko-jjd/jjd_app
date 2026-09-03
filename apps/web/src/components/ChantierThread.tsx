'use client';
import { useEffect, useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Msg {
  id: string; kind: string; body: string | null; fileUrl: string | null; thumbUrl: string | null;
  authorName: string | null; createdAt: string;
}
interface ThreadData {
  thread: { id: string; closedAt: string | null };
  messages: Msg[];
  participants: { id: string; displayName: string | null; firstName: string }[];
}

function time(iso: string) {
  return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ChantierThread({ worksiteId }: { worksiteId: string }) {
  const { data, loading, reload } = useApi<ThreadData>(`/api/worksites/${worksiteId}/thread`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView(); }, [data?.messages.length]);

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
  async function toggleClose() {
    const reopen = !!data?.thread.closedAt;
    if (!reopen && !confirm('Signaler le chantier comme terminé ?')) return;
    await api(`/api/worksites/${worksiteId}/thread/close`, { method: 'POST', body: { reopen } });
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
        <button className={`btn ${data.thread.closedAt ? '' : 'primary'}`} onClick={toggleClose}>
          {data.thread.closedAt ? 'Rouvrir' : 'Chantier terminé'}
        </button>
      </div>

      <div style={{ maxHeight: 460, overflowY: 'auto', padding: '1rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        {data.messages.length === 0 && <div className="muted">Aucun message. Lance la conversation ci-dessous.</div>}
        {data.messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
              {m.kind === 'status' ? '●' : m.authorName} · {time(m.createdAt)}
            </div>
            {m.kind === 'photo' && m.fileUrl ? (
              <a href={m.fileUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbUrl ?? m.fileUrl} alt="" style={{ maxWidth: 260, borderRadius: 8, border: '1px solid var(--line)' }} />
              </a>
            ) : m.kind === 'video' && m.fileUrl ? (
              <video src={m.fileUrl} controls preload="metadata" style={{ maxWidth: 280, borderRadius: 8, border: '1px solid var(--line)' }} />
            ) : m.kind === 'file' && m.fileUrl ? (
              <a href={m.fileUrl} target="_blank" rel="noreferrer" className="badge plain" style={{ fontSize: '0.8rem' }}>📎 {m.body || 'Fichier'}</a>
            ) : null}
            {m.body && m.kind !== 'file' && (
              <div style={m.kind === 'status'
                ? { fontStyle: 'italic', color: 'var(--ink-2)', fontSize: '0.85rem' }
                : { background: 'var(--surface-2)', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.9rem', alignSelf: 'flex-start', maxWidth: '80%' }}>
                {m.body}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="row" style={{ padding: '0.8rem 1.15rem', borderTop: '1px solid var(--line)', gap: '0.5rem' }}>
        <input
          className="input"
          placeholder="Écrire un message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          style={{ flex: 1 }}
        />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>📷</button>
        <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>Envoyer</button>
      </div>
    </div>
  );
}
