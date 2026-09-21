'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { portalApi, usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
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
  const { data, error, reload } = usePortalApi<{ items: Thread[] }>(me ? '/messages' : null);
  const items = data?.items ?? null;

  if (loading || !me) return null;

  async function open(t: Thread) {
    if (t.unread > 0) portalApi(`/messages/${t.threadId}/read`, { method: 'POST' }).catch(() => {});
    router.push(`/portail/chantier/${t.worksiteId}?discussion=1`);
  }

  return (
    <PortalShell title="Messagerie" subtitle="Votre échange privé avec JJD.">
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !items ? (
        <SkeletonRows rows={5} height={64} />
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Aucune conversation pour l’instant" text="Les échanges avec JJD Consult sont rattachés à chaque intervention. Ouvrez une intervention pour écrire à l’équipe." action={<Link href="/portail/interventions" className="btn primary">Voir les interventions</Link>} secondary={<Link href="/portail/demande" className="btn">Nouvelle demande</Link>} />
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
