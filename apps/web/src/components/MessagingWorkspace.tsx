'use client';
import { SkeletonRows } from '@/components/States';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { api, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/lib/ui';
import { Search, Paperclip, Send, Building2, ArrowLeft, Mic, Square } from 'lucide-react';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { useMentionInput, splitMentions } from '@/lib/useMentionInput';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { Bell, BellOff } from 'lucide-react';

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
  mentionedNames?: string[];
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

export default function MessagingWorkspace({worksiteId, compact=false, active=true}: {worksiteId?: string; compact?:boolean; active?:boolean}) {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <MessagerieInner worksiteId={worksiteId} compact={compact} active={active} />
    </Suspense>
  );
}

function MessagerieInner({worksiteId, compact=false, active=true}: {worksiteId?: string; compact?:boolean; active?:boolean}) {
  const { user } = useAuth();
  const isOffice = user?.role === 'admin' || user?.role === 'office';
  const sp = useSearchParams();
  const [audience, setAudience] = useState<Audience>('internal');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tab, setTab] = useState<'chat' | 'gallery'>('chat');
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const draftKey = `${audience}:${selected?.kind==='worksite'?selected.worksiteId:selected?.kind||'none'}`;
  const text = drafts[draftKey] || '';
  const setText = (value:string|((previous:string)=>string)) => setDrafts(previous=>({...previous,[draftKey]:typeof value==='function'?value(previous[draftKey]||''):value}));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const mention = useMentionInput(text, setText);
  const push = usePushNotifications();
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const workspaceRef=useRef<HTMLDivElement>(null);
  const bodyRef=useRef<HTMLDivElement>(null);
  const composerRef=useRef<HTMLTextAreaElement>(null);
  const nearBottom=useRef(true);
  const lastScrollThread=useRef('');
  const [newBelow,setNewBelow]=useState(false);

  useEffect(()=>{
    if(worksiteId||compact)return;
    const update=()=>{
      const el=workspaceRef.current;if(!el)return;
      const viewport=window.visualViewport;
      const bottom=(viewport?.height||window.innerHeight)+(viewport?.offsetTop||0);
      const nav=document.querySelector('.bottom-tabs');
      const navRect=nav?.getBoundingClientRect();
      const limit=navRect&&navRect.height>0?Math.min(bottom,navRect.top):bottom;
      el.style.height=`${Math.max(180,limit-el.getBoundingClientRect().top-8)}px`;
    };
    update();window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    return()=>{window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
  },[worksiteId,compact]);

  useEffect(()=>{const el=composerRef.current;if(el){el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,144)}px`;}},[text,tab]);

  const { data: listData, reload: reloadList } = useApi<{ items: ThreadItem[] }>(
    active ? `/api/messagerie/threads?audience=${audience}${filter === 'archived' ? '&archived=1' : ''}` : null,
  );
  const items = listData?.items ?? [];

  // deep-link : /app/messagerie?worksite=<id>&audience=internal
  const requestedWorksite = worksiteId || sp.get('worksite');
  const requestedAudience = worksiteId ? 'internal' : sp.get('audience');
  useEffect(() => {
    const wsId = requestedWorksite;
    if (wsId) {
      setAudience(requestedAudience === 'client' ? 'client' : 'internal');
      setSelected({ kind: 'worksite', worksiteId: wsId, threadId: wsId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedWorksite, requestedAudience]);

  const generalPath = active && selected?.kind === 'general' ? '/api/messagerie/general' : null;
  const worksitePath = active && selected?.kind === 'worksite'
    ? (audience === 'client' ? `/api/worksites/${selected.worksiteId}/thread/client` : `/api/worksites/${selected.worksiteId}/thread`)
    : null;
  const { data: genData, reload: reloadGen, error:genError, loading:genLoading } = useApi<{ thread: { id: string }; messages: Msg[] }>(generalPath);
  const { data: wsData, reload: reloadWs, error:wsError, loading:wsLoading } = useApi<{ thread: { id: string }; messages: Msg[]; readableBy?: { id: string; name: string }[] }>(worksitePath);
  const conversationError=selected?.kind==='general'?genError:wsError;
  const conversationLoading=selected?.kind==='general'?genLoading:wsLoading;
  const convo = selected?.kind === 'general' ? genData : wsData;
  const reloadConvo = selected?.kind === 'general' ? reloadGen : reloadWs;
  const messages = convo?.messages ?? [];
  const media = messages.filter((m) => (m.kind === 'photo' || m.kind === 'video') && m.fileUrl);

  // rafraîchissement léger — pas de push temps réel, on repasse régulièrement
  useEffect(() => {
    if(!active)return;
    const t = setInterval(() => { reloadList(); if (selected) reloadConvo(); }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, audience, filter, active]);

  function latest(){const el=bodyRef.current;if(el)el.scrollTop=el.scrollHeight;nearBottom.current=true;setNewBelow(false);}
  useEffect(() => {
    if(!messages.length||tab!=='chat')return;
    if(lastScrollThread.current!==draftKey||nearBottom.current){latest();lastScrollThread.current=draftKey;}
    else setNewBelow(true);
  }, [messages.length,draftKey,tab]);

  // marque comme lu à l'ouverture / dès qu'un nouveau message arrive pendant la lecture
  useEffect(() => {
    if (!active || !selected || !convo?.thread?.id) return;
    api('/api/messagerie/read', { method: 'POST', body: { threadId: convo.thread.id, audience } }).then(reloadList).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, convo?.thread?.id, messages.length, active, audience]);

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
    if (selected?.kind !== 'worksite' || sharing) return;
    setSharing(true);
    setActionError(null);
    try {
      await api(`/api/worksites/${selected.worksiteId}/thread/messages/${m.id}/share`, { method: 'PATCH', body: { shared: !m.sharedWithClient } });
      reloadConvo();
    } catch (e) { setActionError((e as Error).message); }
    finally {setSharing(false);}
  }

  async function send() {
    if (!text.trim() || !selected || busy) return;
    setActionError(null);
    setBusy(true);
    try {
      if (selected?.kind === 'general') await api('/api/messagerie/general/messages', { method: 'POST', body: { body: text.trim() } });
      else if (selected?.kind === 'worksite' && audience === 'client') await api(`/api/worksites/${selected.worksiteId}/thread/client/messages`, { method: 'POST', body: { body: text.trim() } });
      else if (selected?.kind === 'worksite') await api(`/api/worksites/${selected.worksiteId}/thread/messages`, { method: 'POST', body: { body: text.trim() } });
      setText('');
      nearBottom.current=true;
      reloadConvo();
      reloadList();
    } catch (e) {
      setActionError((e as Error).message);
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
    } catch (e) {
      setActionError((e as Error).message);
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
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  });

  const selectedItem = items.find((it) => (selected?.kind === 'general' ? it.kind === 'general' : it.worksiteId === (selected as { worksiteId?: string })?.worksiteId));
  // qui peut lire ce fil, à la place du générique "Équipe interne" — n'a de sens que pour un
  // chantier en interne (le fil général et l'onglet Client gardent leur sous-titre habituel)
  const readableByLabel = selected?.kind === 'worksite' && audience === 'internal' && wsData?.readableBy
    ? wsData.readableBy.map((p) => p.name).join(', ')
    : null;

  return (
    <div ref={workspaceRef} className={worksiteId?'msg-workspace embedded':'msg-workspace full'}>
      {actionError && <div className="card card-pad" role="alert" style={{borderColor:'var(--crit)',marginBottom:'1rem'}}>{actionError}</div>}
      {worksiteId && <div className="worksite-discussion-head">
        <div><h3>Discussion du chantier</h3><p>Le même fil que dans la messagerie. Les photos restent internes tant que vous ne les partagez pas.</p></div>
        <Link className="btn" href={`/app/messagerie?worksite=${worksiteId}&audience=${audience}`}>Ouvrir la messagerie</Link>
      </div>}
      {worksiteId && isOffice && <div className="msg-audience-tabs worksite-discussion-tabs">
        <button className={audience==='internal'?'active':''} onClick={()=>{setAudience('internal');setTab('chat');}}>Équipe interne</button>
        <button className={audience==='client'?'active':''} onClick={()=>{setAudience('client');setTab('chat');}}>Échanges client</button>
      </div>}

      <div className={`msg-layout${selected ? ' has-selection' : ''}${worksiteId?' msg-embedded':''}`}>
        {!worksiteId && <aside className="msg-list">
          <div className="msg-list-heading"><h1>Discussions</h1>{push.supported&&<button type="button" className="btn ghost" disabled={push.busy} onClick={()=>push.enabled?push.disable():push.enable()} aria-label={push.enabled?'Désactiver les notifications':'Activer les notifications'}>{push.enabled?<Bell size={20}/>:<BellOff size={20}/>}</button>}</div>
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
        </aside>}

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
                {!worksiteId && <button type="button" className="btn ghost msg-back" onClick={() => setSelected(null)} aria-label="Retour aux conversations">
                  <ArrowLeft size={17} strokeWidth={2} />
                </button>}
                <Avatar label={selectedItem?.kind === 'general' ? 'JJD' : refDigits(selectedItem?.ref ?? null)} size={36} raw={selectedItem?.kind === 'worksite'} />
                <div style={{ minWidth: 0 }}>
                  <strong>{selectedItem?.title || 'Discussion du chantier'}</strong>
                  <div className="muted" style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={readableByLabel ?? undefined}>
                    {readableByLabel ?? selectedItem?.sub}
                  </div>
                </div>
                {!worksiteId && selected.kind === 'worksite' && (
                  <Link href={`/app/chantiers/${selected.worksiteId}`} className="btn ghost" style={{ marginLeft: 'auto' }} title="Ouvrir le chantier">
                    <Building2 size={16} strokeWidth={2} />
                  </Link>
                )}
              </div>

              <p className={`msg-privacy-note${audience==='client'?' client':''}`}>{audience==='internal'?'Interne · les messages ne sont pas visibles par le client. Seuls les photos et vidéos partagés le seront.':'Client · les messages écrits ici et les médias partagés sont visibles dans le portail client.'}</p>
              <div className="thread-tabs">
                <button type="button" className={`thread-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>💬 Discussion</button>
                <button type="button" className={`thread-tab${tab === 'gallery' ? ' active' : ''}`} onClick={() => setTab('gallery')}>
                  🖼️ Galerie{media.length ? ` (${media.length})` : ''}
                </button>
              </div>
              {conversationError && <p role="alert" className="card card-pad">{conversationError}<button className="btn" onClick={reloadConvo}>Réessayer</button></p>}

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
                            className={`btn msg-share-button ${m.sharedWithClient ? 'shared' : ''}`}
                            title={m.sharedWithClient ? 'Visible du client — cliquer pour retirer' : 'Partager cette photo avec le client'}
                            disabled={sharing}
                            onClick={() => toggleShare(m)}
                          >
                            {m.sharedWithClient ? 'Visible du client · Retirer' : 'Partager avec le client'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : (
              <>
              <div className="msg-body" ref={bodyRef} onScroll={()=>{const el=bodyRef.current;if(el){nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<90;if(nearBottom.current)setNewBelow(false);}}}>
                {messages.length === 0 && <p className="muted" style={{ margin: 'auto' }}>{conversationLoading?'Chargement de la conversation…':conversationError?'Conversation indisponible.':'Aucun message. Lancez la conversation ci-dessous.'}</p>}
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
                        {isOffice && audience==='internal' && selected.kind==='worksite' && (m.kind==='photo'||m.kind==='video') && <button type="button" disabled={sharing} className={`btn msg-share-button ${m.sharedWithClient?'shared':''}`} onClick={()=>toggleShare(m)}>{m.sharedWithClient?'Visible du client · Retirer':'Partager avec le client'}</button>}
                        {m.body && m.kind !== 'file' && (
                          <div className={`msg-bubble${mine ? ' mine' : ''}`}>
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
              {newBelow&&<button className="msg-new-messages" onClick={latest}>Nouveaux messages · Revenir en bas</button>}

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
                {mention.open && (
                  <div className="mention-menu">
                    {mention.options.map((c) => (
                      <button key={c.id} type="button" onClick={() => mention.pick(c)}>@{c.name}</button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  rows={1}
                  aria-label="Votre message"
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Écrire un message… (@ pour mentionner)"
                  value={text}
                  onChange={(e) => mention.onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && mention.open) { mention.close(); return; }
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                      e.preventDefault();
                      if (mention.open) mention.pick(mention.options[0]!);
                      else send();
                    }
                  }}
                />
                <button type="button" className="btn primary msg-send" aria-label="Envoyer le message" onClick={send} disabled={busy || !text.trim()}>
                  <Send size={16} strokeWidth={2} />
                </button>
              </div>
              </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
