'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Paperclip, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon } from 'lucide-react';
import { apiBlobUrl } from '@/lib/api';

/** « "Syndic Baltimo" <info@baltimo.be> » → nom + adresse. */
export function parseAddress(raw: string | null | undefined): { name: string; email: string } {
  const s = (raw ?? '').trim();
  const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(s);
  if (m) return { name: m[1]!.trim() || m[2]!, email: m[2]! };
  return { name: s.includes('@') ? s.split('@')[0]! : s, email: s.includes('@') ? s : '' };
}

const AVATAR_TONES = ['#2f6f5a', '#8a6d2f', '#3f5f8f', '#8f4f4f', '#5f4f8f', '#4f7f7f'];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const letters = name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const tone = AVATAR_TONES[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % AVATAR_TONES.length]!;
  return <span className="mx-avatar" style={{ width: size, height: size, background: tone, fontSize: size * 0.38 }} aria-hidden="true">{letters}</span>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export const fullDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** Date compacte de liste : l'heure aujourd'hui, « 12 oct. » cette année, sinon la date complète. */
export const listDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  return d.getFullYear() === now.getFullYear() ? d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }) : d.toLocaleDateString('fr-BE');
};

const INLINE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;
function iconFor(type: string, name: string) {
  if (/^image\//.test(type)) return ImageIcon;
  if (/pdf|word|text|rtf/.test(type) || /\.(pdf|docx?|odt|txt)$/i.test(name)) return FileText;
  if (/sheet|excel|csv/.test(type) || /\.(xlsx?|ods|csv)$/i.test(name)) return FileSpreadsheet;
  return FileIcon;
}

/** Ouvre une pièce jointe : PDF et images dans un nouvel onglet, le reste en téléchargement sous son vrai nom. */
export async function openAttachment(path: string, filename: string, type: string) {
  const preview = INLINE_TYPES.test(type) ? window.open('about:blank', '_blank') : null; // ouvert tout de suite pour ne pas être bloqué par le navigateur
  try {
    const url = await apiBlobUrl(path);
    if (preview) { preview.location.href = url; return; }
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) {
    preview?.close();
    throw e;
  }
}

export interface ReaderAttachment { name: string; size: number; type: string; available?: boolean; reason?: string | null; onOpen?: () => Promise<void> | void }

const FRAME_CSS = `html,body{margin:0}body{padding:18px 20px;font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;background:#fff;overflow-wrap:anywhere}
img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:.7em 0;padding-left:.9em;border-left:3px solid #d5dde5;color:#52606d}a{color:#1a6b4f}pre{white-space:pre-wrap}`;

/** Corps HTML d'un mail dans un cadre isolé : ni script, ni image distante (contenu déjà nettoyé côté serveur, protégé une seconde fois ici). */
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(240);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`, [html]);
  const measure = () => { const d = ref.current?.contentDocument; if (d) setH(Math.max(160, d.documentElement.scrollHeight + 2)); };
  useEffect(() => { setH(240); }, [html]);
  return <iframe ref={ref} title="Contenu du mail" className="mx-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={measure} />;
}

/** Lecture d'un mail façon Outlook : objet, expéditeur, destinataire, date, pièces jointes bien visibles, corps lisible. */
export function MailReader({ subject, from, to, date, html, text, attachments = [], children }: {
  subject: string | null; from: string | null; to?: string | null; date: string | null; html?: string | null; text?: string | null;
  attachments?: ReaderAttachment[]; children?: ReactNode;
}) {
  const sender = parseAddress(from);
  const [err, setErr] = useState<string | null>(null);
  async function open(a: ReaderAttachment) {
    setErr(null);
    try { await a.onOpen?.(); } catch (e) { setErr(`Impossible d’ouvrir « ${a.name} » : ${(e as Error).message}`); }
  }
  return (
    <article className="mx-reader">
      <header className="mx-head">
        <h2 className="mx-subject">{subject?.trim() || '(sans objet)'}</h2>
        <div className="mx-from">
          <Avatar name={sender.name || '?'} size={42} />
          <div className="mx-from-text">
            <div><strong>{sender.name || 'Expéditeur inconnu'}</strong>{sender.email && sender.email !== sender.name && <span className="mx-email"> &lt;{sender.email}&gt;</span>}</div>
            {to && <div className="mx-meta">À : {to}</div>}
            {date && <div className="mx-meta">{fullDate(date)}</div>}
          </div>
        </div>
      </header>

      {attachments.length > 0 && (
        <div className="mx-atts" aria-label="Pièces jointes">
          <div className="mx-atts-title"><Paperclip size={14} /> {attachments.length} pièce{attachments.length > 1 ? 's' : ''} jointe{attachments.length > 1 ? 's' : ''}</div>
          <div className="mx-att-list">
            {attachments.map((a, i) => {
              const Icon = iconFor(a.type, a.name);
              const usable = a.available !== false && !!a.onOpen;
              return (
                <button key={i} type="button" className="mx-att" disabled={!usable} title={usable ? `Ouvrir ${a.name}` : a.reason ?? 'Non conservée'} onClick={() => open(a)}>
                  <span className="mx-att-ic"><Icon size={18} strokeWidth={1.7} /></span>
                  <span className="mx-att-text"><span className="mx-att-name">{a.name}</span><span className="mx-att-size">{usable ? formatBytes(a.size) : (a.reason ?? 'non conservée')}</span></span>
                </button>
              );
            })}
          </div>
          {err && <p className="state error" role="alert" style={{ margin: '0.5rem 0 0' }}>{err}</p>}
        </div>
      )}

      <div className="mx-body">
        {html ? <HtmlBody html={html} /> : text ? <div className="mx-text">{text}</div> : <p className="muted" style={{ margin: 0, padding: '1rem' }}>Ce mail n’a pas de texte.</p>}
      </div>
      {children}
    </article>
  );
}
