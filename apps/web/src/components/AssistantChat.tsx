'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface DraftAction { kind: 'devis' | 'planning' | 'task'; id: string; label: string; href: string }
interface Turn { message: ChatMessage; actions?: DraftAction[] }

const KIND_ICON: Record<DraftAction['kind'], string> = { devis: '▧', planning: '▦', task: '☑' };

export function AssistantChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setErr(null);
    const history = [...turns.map((t) => t.message), { role: 'user' as const, content: text }];
    setTurns((t) => [...t, { message: { role: 'user', content: text } }]);
    setBusy(true);
    try {
      const r = await api<{ reply: string; actions: DraftAction[] }>('/api/assistant/chat', {
        method: 'POST',
        body: { messages: history },
      });
      setTurns((t) => [...t, { message: { role: 'assistant', content: r.reply }, actions: r.actions }]);
    } catch (e) {
      setErr((e as Error).message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="assistant-panel">
        <div className="modal-head">
          <h2>Assistant IA</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="assistant-body">
          {turns.length === 0 && (
            <div className="empty" style={{ padding: '1.5rem 1rem' }}>
              Demande-moi de préparer un brouillon de devis, un créneau de planning ou une tâche.
              Tout reste à valider par toi avant d&apos;être finalisé.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`assistant-msg ${t.message.role}`}>
              <div className="assistant-bubble">{t.message.content}</div>
              {t.actions && t.actions.length > 0 && (
                <div className="assistant-actions">
                  {t.actions.map((a) => (
                    <Link key={a.id} href={a.href} className="card card-pad assistant-action">
                      <span className="ic">{KIND_ICON[a.kind]}</span> {a.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="assistant-msg assistant"><div className="assistant-bubble muted">…</div></div>}
          {err && <div className="badge crit" style={{ margin: '0.5rem 1rem' }}>{err}</div>}
          <div ref={bottomRef} />
        </div>

        <div className="assistant-input">
          <textarea
            className="input"
            rows={2}
            placeholder="Écris ta demande…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn primary" disabled={busy || !input.trim()} onClick={send}>Envoyer</button>
        </div>
      </div>
    </>
  );
}
