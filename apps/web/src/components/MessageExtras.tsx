'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface Reaction { emoji: string; count: number; mine: boolean }

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const GIF_MARK = '[gif]';
const GIF_RE = /^\[gif\](https:\/\/media\d*\.giphy\.com\/\S+)$/;

/** Un message GIF = texte « [gif]https://media….giphy.com/… ». Renvoie l'URL si elle passe la regex stricte. */
export function gifUrl(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = GIF_RE.exec(body.trim());
  return m ? m[1]! : null;
}

export function GifImage({ url }: { url: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="GIF" loading="lazy" className="msg-gif-img" />;
}

/** Pastilles de réactions + bouton « ☺ + » avec petit popover. */
export function ReactionBar({ messageId, reactions, mine, onChanged }: { messageId: string; reactions?: Reaction[]; mine?: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function toggle(emoji: string) {
    const e = emoji.trim();
    if (!e || busy) return;
    setBusy(true);
    setOpen(false);
    setOther('');
    try {
      await api(`/api/messagerie/messages/${messageId}/reactions`, { method: 'POST', body: { emoji: e } });
      onChanged();
    } catch { /* silencieux : le prochain rechargement remet l'état exact */ }
    finally { setBusy(false); }
  }

  return (
    <div className={`msg-react-bar${mine ? ' mine' : ''}`} ref={wrapRef}>
      {(reactions ?? []).map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`msg-react-chip${r.mine ? ' on' : ''}`}
          aria-pressed={r.mine}
          aria-label={`Réaction ${r.emoji}, ${r.count}${r.mine ? ', la vôtre' : ''}`}
          onClick={() => toggle(r.emoji)}
        >
          <span>{r.emoji}</span><b>{r.count}</b>
        </button>
      ))}
      <button type="button" className="msg-react-add" aria-label="Réagir au message" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☺ +</button>
      {open && (
        <div className="msg-react-pop" role="group" aria-label="Choisir une réaction">
          <div className="msg-react-quick">
            {QUICK.map((e) => (
              <button key={e} type="button" aria-label={`Réagir avec ${e}`} onClick={() => toggle(e)}>{e}</button>
            ))}
          </div>
          <form className="msg-react-other" onSubmit={(ev) => { ev.preventDefault(); void toggle(other); }}>
            <input
              className="input"
              aria-label="Autre émoji"
              placeholder="Autre émoji"
              value={other}
              onChange={(ev) => setOther(Array.from(ev.target.value).slice(-4).join(''))}
            />
            <button type="submit" className="btn primary" disabled={!other.trim()}>OK</button>
          </form>
        </div>
      )}
    </div>
  );
}

type Gif = { id: string; preview: string; url: string };

/** Bouton « GIF » + sélecteur. Masqué si la clé Giphy n'est pas configurée côté serveur. */
export function GifButton({ onPick, disabled }: { onPick: (body: string) => void; disabled?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  async function search(term: string) {
    setLoading(true);
    try {
      const r = await api<{ enabled: boolean; gifs: Gif[] }>(`/api/gifs/search?q=${encodeURIComponent(term)}`);
      setEnabled(r.enabled);
      setGifs((r.gifs ?? []).filter((g) => gifUrl(`${GIF_MARK}${g.url}`)));
    } catch { setGifs([]); }
    setLoading(false);
  }
  useEffect(() => { void search(''); }, []);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { void search(q.trim()); }, 400);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!enabled) return null;
  return (
    <div className="msg-gif-wrap" ref={wrapRef}>
      <button type="button" className="btn ghost msg-gif-btn" aria-label="Envoyer un GIF" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>GIF</button>
      {open && (
        <div className="msg-gif-pop" role="dialog" aria-label="Choisir un GIF">
          <input className="input" autoFocus aria-label="Rechercher un GIF" placeholder="Rechercher un GIF…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="msg-gif-grid">
            {gifs.map((g) => (
              <button key={g.id} type="button" aria-label="Envoyer ce GIF" onClick={() => { setOpen(false); onPick(`${GIF_MARK}${g.url}`); }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.preview} alt="GIF" loading="lazy" />
              </button>
            ))}
          </div>
          {loading && <p className="muted msg-gif-note">Chargement…</p>}
          {!loading && gifs.length === 0 && <p className="muted msg-gif-note">Aucun résultat.</p>}
          <p className="muted msg-gif-note">Propulsé par GIPHY</p>
        </div>
      )}
    </div>
  );
}
