'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface WS {
  id: string; ref: string; title: string; status: string; statusLabel: string;
  priority: string; priorityLabel: string;
  building: { id: string; name: string } | null; manager: string | null;
  startedOn: string | null; endedOn: string | null; updatedAt: string;
}

const STATUS_DOT: Record<string, string> = {
  scheduled: 'gold', in_progress: 'ok', on_hold: 'blue', done: 'ok', to_invoice: 'gold',
  invoiced: 'grey', closed: 'grey', lead: 'grey', to_plan: 'grey', cancelled: 'crit',
};
const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

const STATUS_VIEWS: { key: string; label: string }[] = [
  { key: 'open', label: 'En cours' },
  { key: '', label: 'Toutes' },
  { key: 'done', label: 'Terminées' },
  { key: 'invoiced', label: 'Facturées' },
  { key: 'lead', label: 'Demandes' },
];

export default function PortalInterventions() {
  const { me, loading } = usePortalGuard();
  const router = useRouter();
  const [items, setItems] = useState<WS[] | null>(null);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!me) return;
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    portalApi<{ items: WS[] }>(`/interventions?${p}`).then((r) => setItems(r.items)).catch(() => {});
  }, [me, status, q]);

  if (loading || !me) return null;

  return (
    <PortalShell title="Interventions" subtitle="Toutes les interventions de votre portefeuille">
      <div className="p-filters" style={{ alignItems: 'center' }}>
        <div className="p-seg">
          {STATUS_VIEWS.map((v) => (
            <button key={v.key || 'all'} className={status === v.key ? 'on' : ''} onClick={() => setStatus(v.key)}>{v.label}</button>
          ))}
        </div>
        <input className="p-input" placeholder="Réf, objet…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!items ? <div className="p-empty">Chargement…</div> : items.length === 0 ? <div className="p-empty">Aucune intervention.</div> : (
        <div className="p-panel" style={{ padding: '0.4rem 0.5rem' }}>
          <div className="p-ilist">
            {items.map((w) => (
              <div key={w.id} className="p-irow" onClick={() => router.push(`/portail/chantier/${w.id}`)}>
                <span className="ico">⌂</span>
                <div className="body">
                  <div className="t">{w.title}</div>
                  <div className="s">{w.building?.name ?? ''}{w.building?.name ? ` · ${w.ref}` : w.ref}</div>
                </div>
                <div className="right">
                  <span className={`p-dot ${STATUS_DOT[w.status] ?? 'grey'}`}>{w.statusLabel}</span>
                  <div className="d">{fdate(w.updatedAt)}</div>
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
