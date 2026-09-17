'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHead, Avatar } from '@/lib/ui';
import { Search, Paperclip, Send, Building2, ArrowLeft, Mic, Square } from 'lucide-react';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';

interface ThreadItem {
  id: string; kind: 'general' | 'worksite'; title: string; sub: string; worksiteId: string | null; ref: string | null;
  lastMessage: string; lastAt: string | null; unread: number; pinned: boolean;
}

/** "R-556" -> "556" : le numéro seul, plus lisible dans le petit cercle de la liste. */
function refDigits(ref: string | null) {
  return ref?.replace(/^R-/i, '') ?? '';
}
interface Msg {
  id: string; kind: string; body: string | null; fileUrl: string | null; thumbUrl: string | null;
  authorName: string | null; authorId?: string | null; createdAt: string; sharedWithClient?: boolean;
}

type Audience = 'internal' | 'client';
type Selection = { kind: 'general' } | { kind: 'worksite'; worksiteId: string; threadId: string };

function timeShort(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' });
}
function timeFull(iso: string) {
  return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function MessageriePage() {
  return (
    <Suspense fallback={<div className="empty">Chargement…</div>}>
      <MessagerieInner />
    </Suspense>
  );
}

function MessagerieInner() {
  const { user } = useAuth();
  const isOffice = user?.role === 'admin' || user?.role === 'office';
  const sp = useSearchParams();
  const [audience, setAudience] = useState<Audience>('internal');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tab, setTab] = useState<'chat' | 'gallery'>('chat');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: listData, reload: reloadList } = useApi<{ items: ThreadItem[] }>(
    `/api/messagerie/threads?audience=${audience}${filter === 'archived' ? '&archived=1' : ''}`,
  );
  const items = listData?.items ?? [];

  // deep-link : /app/messagerie?worksite=<id>&audience=internal
  useEffect(() => {
    const wsId = sp.get('worksite');
    if (wsId) {
      setAudience(sp.get('audience') === 'client' ? 'client' : 'internal');
      setSelected({ kind: 'worksite', worksiteId: wsId, threadId: wsId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generalPath = selected?.kind === 'general' ? '/api/messagerie/general' : null;
  const worksitePath = selected?.kind === 'worksite'
    ? (audience === 'client' ? `/api/worksites/${selected.worksiteId}/thread/client` : `/api/worksites/${selected.worksiteId}/thread`)
    : null;
  const { data: genData, reload: reloadGen } = useApi<{ thread: { id: string }; messages: Msg[] }>(generalPath);
  const { data: wsData, reload: reloadWs } = useApi<{ thread: { id: string }; messages: Msg[] }>(worksitePath);
  const convo = selected?.kind === 'general' ? genData : wsData;
  const reloadConvo = selected?.kind === 'general' ? reloadGen : reloadWs;
  const messages = convo?.messages ?? [];
  const media = messages.filter((m) => (m.kind === 'photo' || m.kind === 'video') && m.fileUrl);

  // rafraîchissement léger — pas de push temps réel, on repasse régulièrement
  useEffect(() => {
    const t = setInterval(() => { reloadList(); if (selected) reloadConvo(); }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, audience, filter]);

  useEffect(() => { endRef.current?.scrollIntoView(); }, [messages.length]);

  // marque comme lu à l'ouverture / dès qu'un nouveau message arrive pendant la lecture
  useEffect(() => {
    if (!selected || !convo?.thread?.id) return;
    api('/api/messagerie/read', { method: 'POST', body: { threadId: convo.thread.id, audience } }).then(reloadList).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, convo?.thread?.id, messages.length]);

  const q = search.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (filter === 'unread' && it.unread === 0) return false;
    if (q && !it.title.toLowerCase().includes(q) && !it.lastMessage.toLowerCase().includes(q)) return false;
    return true;
  });
  const totalUnread = items.reduce((s, it) => s + it.unread, 0);

  function select(it: ThreadItem) {
    setSelected(it.kind === 'general' ? { kind: 'general' } : { kind: 'worksite', worksiteId: it.worksiteId!, threadId: it.id });
    setTab('chat');
  }

  async function toggleShare(m: Msg) {
    if (selected?.kind !== 'worksite') return;
    await api(`/api/worksites/${selected.worksiteId}/thread/messages/${m.id}/share`, { method: 'PATCH', body: { shared: !m.sharedWithClient } });
    reloadConvo();
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (selected?.kind === 'general') await api('/api/messagerie/general/messages', { method: 'POST', body: { body: text.trim() } });
      else if (selected?.kind === 'worksite' && audience === 'client') await api(`/api/worksites/${selected.worksiteId}/thread/client/messages`, { method: 'POST', body: { body: text.trim() } });
      else if (selected?.kind === 'worksite') await api(`/api/worksites/${selected.worksiteId}/thread/messages`, { method: 'POST', body: { body: text.trim() } });
      setText('');
      reloadConvo();
      reloadList();
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(files: FileList | null) {
    if (!files?.length || !selected || audience === 'client') return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', files[0]!);
      const path = selected.kind === 'general' ? '/api/messagerie/general/photos' : `/api/worksites/${selected.worksiteId}/thread/photos`;
      await apiUpload(path, fd);
      reloadConvo();
      reloadList();
    } finally {
      setBusy(false);
    }
  }

  const voice = useVoiceRecorder(async (blob) => {
    if (!selected || audience === 'client') return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, `note-vocale.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
      const path = selected.kind === 'general' ? '/api/messagerie/general/voice' : `/api/worksites/${selected.worksiteId}/thread/voice`;
      await apiUpload(path, fd);
      reloadConvo();
      reloadList();
    } finally {
      setBusy(false);
    }
  });

  const selectedItem = items.find((it) => (selected?.kind === 'general' ? it.kind === 'general' : it.worksiteId === (selected as { worksiteId?: string })?.worksiteId));

  return (
    <>
      <PageHead eyebrow="Rester en lien" title="Messagerie" sub="Toute l’équipe. Chaque chantier. Un même endroit." />

      <div className={`msg-layout${selected ? ' has-selection' : ''}`}>
        <aside className="msg-list">
          {isOffice && (
            <div className="msg-audience-tabs">
              <button className={audience === 'internal' ? 'active' : ''} onClick={() => { setAudience('internal'); setSelected(null); }}>Équipe interne</button>
              <button className={audience === 'client' ? 'active' : ''} onClick={() => { setAudience('client'); setSelected(null); }}>Clients</button>
            </div>
          )}
          <label className="plan-search" style={{ margin: '0 0 0.7rem', maxWidth: 'none' }}>
            <Search size={15} strokeWidth={2} />
            <input placeholder="Rechercher une conversation" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="msg-filter-chips">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => { setFilter('all'); setSelected(null); }}>Toutes</button>
            <button className={filter === 'unread' ? 'on' : ''} onClick={() => { setFilter('unread'); setSelected(null); }}>Non lus{totalUnread ? ` · ${totalUnread}` : ''}</button>
            <button className={filter === 'archived' ? 'on' : ''} onClick={() => { setFilter('archived'); setSelected(null); }}>Archivés</button>
          </div>
          <div className="msg-list-items">
            {filtered.length === 0 && (
              <p className="muted" style={{ padding: '1rem' }}>
                {filter === 'archived' ? 'Aucune conversation archivée.' : 'Aucune conversation.'}
              </p>
            )}
            {filtered.map((it) => {
              const active = selectedItem?.id === it.id;
              return (
                <button key={it.id} type="button" className={`msg-row${active ? ' active' : ''}`} onClick={() => select(it)}>
                  <Avatar label={it.kind === 'general' ? 'JJD' : refDigits(it.ref)} size={38} raw={it.kind === 'worksite'} />
                  <div className="msg-row-body">
                    <div className="msg-row-top">
                      <strong>{it.pinned && '📌 '}{it.title}</strong>
                      {it.lastAt && <span className="msg-row-time">{timeShort(it.lastAt)}</span>}
                    </div>
                    <div className="msg-row-bottom">
                      <span className="msg-row-preview">{it.lastMessage || it.sub}</span>
                      {it.unread > 0 && <span className="msg-unread-dot">{it.unread}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {audience === 'internal' && <p className="hint" style={{ padding: '0.7rem 1rem 0' }}>Les clients ne voient pas ces conversations.</p>}
          {audience === 'client' && <p className="hint" style={{ padding: '0.7rem 1rem 0' }}>Les échanges clients restent séparés des fils internes.</p>}
        </aside>

        <section className="msg-pane">
          {!selected ? (
            <div className="msg-empty">
              <div className="msg-empty-mark">J</div>
              <h2>Le bon échange.<br />Au bon endroit.</h2>
              <p>Un fil pour toute l’équipe,<br />un espace pour chaque chantier.</p>
              <p className="muted">Choisissez une conversation pour commencer.</p>
            </div>
          ) : (
            <>
              <div className="msg-pane-head">
                <button type="button" className="btn ghost msg-back" onClick={() => setSelected(null)} aria-label="Retour aux conversations">
                  <ArrowLeft size={17} strokeWidth={2} />
                </button>
                <Avatar label={selectedItem?.kind === 'general' ? 'JJD' : refDigits(selectedItem?.ref ?? null)} size={36} raw={selectedItem?.kind === 'worksite'} />
                <div>
                  <strong>{selectedItem?.title}</strong>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>{selectedItem?.sub}</div>
                </div>
                {selected.kind === 'worksite' && (
                  <Link href={`/app/chantiers/${selected.worksiteId}`} className="btn ghost" style={{ marginLeft: 'auto' }} title="Ouvrir le chantier">
                    <Building2 size={16} strokeWidth={2} />
                  </Link>
                )}
              </div>

              <div className="thread-tabs">
                <button type="button" className={`thread-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>💬 Discussion</button>
                <button type="button" className={`thread-tab${tab === 'gallery' ? ' active' : ''}`} onClick={() => setTab('gallery')}>
                  🖼️ Galerie{media.length ? ` (${media.length})` : ''}
                </button>
              </div>

              {tab === 'gallery' ? (
                media.length === 0 ? (
                  <div className="msg-gallery"><p className="muted">Aucune photo ni vidéo pour l’instant.</p></div>
                ) : (
                  <div className="msg-gallery">
                    {media.map((m) => (
                      <div key={m.id} style={{ position: 'relative' }}>
                        <a href={m.fileUrl!} target="_blank" rel="noreferrer" title={`${m.authorName ?? ''} · ${timeFull(m.createdAt)}${m.body ? ` · ${m.body}` : ''}`}>
                          {m.kind === 'photo' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.thumbUrl ?? m.fileUrl!} alt="" />
                          ) : (
                            <video src={m.fileUrl!} preload="metadata" muted />
                          )}
                        </a>
                        {isOffice && audience === 'internal' && (
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
              ) : (
              <>
              <div className="msg-body">
                {messages.length === 0 && <p className="muted" style={{ margin: 'auto' }}>Aucun message. Lancez la conversation ci-dessous.</p>}
                {messages.map((m) => {
                  if (m.kind === 'status') {
                    return <div key={m.id} className="msg-status"><span>● {m.body} · {timeFull(m.createdAt)}</span></div>;
                  }
                  const mine = audience === 'client' ? !!m.authorId : m.authorId === user?.id;
                  return (
                    <div key={m.id} className={`msg-bubble-row${mine ? ' mine' : ''}`}>
                      {!mine && <Avatar label={m.authorName ?? '?'} size={26} />}
                      <div className="msg-bubble-col">
                        <div className="msg-bubble-meta">{mine ? 'Toi' : m.authorName} · {timeFull(m.createdAt)}</div>
                        {m.kind === 'photo' && m.fileUrl ? (
                          <a href={m.fileUrl} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.thumbUrl ?? m.fileUrl} alt="" className="msg-bubble-img" />
                          </a>
                        ) : m.kind === 'video' && m.fileUrl ? (
                          <video src={m.fileUrl} controls preload="metadata" className="msg-bubble-img" />
                        ) : m.kind === 'audio' && m.fileUrl ? (
                          <audio src={m.fileUrl} controls preload="metadata" style={{ maxWidth: 260 }} />
                        ) : m.kind === 'file' && m.fileUrl ? (
                          <a href={m.fileUrl} target="_blank" rel="noreferrer" className="badge plain" style={{ fontSize: '0.8rem' }}>📎 {m.body || 'Fichier'}</a>
                        ) : null}
                        {m.body && m.kind !== 'file' && <div className={`msg-bubble${mine ? ' mine' : ''}`}>{m.body}</div>}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <div className="msg-composer">
                {audience === 'internal' && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadPhoto(e.target.files)} />
                    <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy} title="Joindre une photo">
                      <Paperclip size={17} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className={`btn ${voice.recording ? 'primary' : 'ghost'}`}
                      onClick={() => (voice.recording ? voice.stop() : voice.start())}
                      disabled={busy && !voice.recording}
                      title={voice.recording ? 'Arrêter et envoyer' : 'Enregistrer une note vocale'}
                    >
                      {voice.recording ? <Square size={17} strokeWidth={2} /> : <Mic size={17} strokeWidth={2} />}
                    </button>
                  </>
                )}
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Écrire un message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                />
                <button type="button" className="btn primary msg-send" onClick={send} disabled={busy || !text.trim()}>
                  <Send size={16} strokeWidth={2} />
                </button>
              </div>
              </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
