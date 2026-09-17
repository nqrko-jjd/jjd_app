'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface Thread {
  threadId: string; worksiteId: string; ref: string; title: string;
  lastMessage: string; lastAt: string | null; unread: number;
}

function fdate(s: string | null) {
  if (!s) return '';
  const d = new Date(s);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' });
}

export default function PortalMessagesPage() {
  const { me, loading } = usePortalGuard();
  const router = useRouter();
  const [items, setItems] = useState<Thread[] | null>(null);

  useEffect(() => {
    if (me) portalApi<{ items: Thread[] }>('/messages').then((r) => setItems(r.items)).catch(() => {});
  }, [me]);

  if (loading || !me) return null;

  async function open(t: Thread) {
    if (t.unread > 0) portalApi(`/messages/${t.threadId}/read`, { method: 'POST' }).catch(() => {});
    router.push(`/portail/chantier/${t.worksiteId}?discussion=1`);
  }

  return (
    <PortalShell title="Messagerie" subtitle="Votre échange privé avec JJD.">
      {!items ? (
        <div className="p-empty">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="p-empty">Aucune conversation pour l’instant.</div>
      ) : (
        <div className="p-panel" style={{ padding: '0.4rem 0.5rem' }}>
          <div className="p-ilist">
            {items.map((t) => (
              <div key={t.threadId} className="p-irow" onClick={() => open(t)}>
                <span className="ico">C</span>
                <div className="body">
                  <div className="t">{t.title}</div>
                  <div className="s">{t.ref}{t.lastMessage ? ` — ${t.lastMessage}` : ''}</div>
                </div>
                <div className="right">
                  {t.unread > 0 && <span className="p-tag gold">{t.unread}</span>}
                  <div className="d">{fdate(t.lastAt)}</div>
                </div>
                <span className="chev">→</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
