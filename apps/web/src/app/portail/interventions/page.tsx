'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
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
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const { data, error, reload } = usePortalApi<{ items: WS[] }>(me ? `/interventions?${params}` : null);
  const items = data?.items ?? null;

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

      {error ? <ErrorState message={error} onRetry={reload} /> : !items ? <SkeletonRows rows={6} height={64} /> : items.length === 0 ? <EmptyState icon={ClipboardList} title={q || status !== 'open' ? 'Aucune intervention ne correspond' : 'Aucune intervention en cours'} text={q || status !== 'open' ? 'Modifiez le filtre ou la recherche pour élargir la liste.' : 'Vous n’avez pas d’intervention en cours. Signalez un besoin et JJD Consult revient vers vous.'} action={<Link href="/portail/demande" className="btn primary">Nouvelle demande</Link>} secondary={q || status !== 'open' ? <button type="button" className="btn" onClick={() => { setStatus(''); setQ(''); }}>Toutes les interventions</button> : undefined} /> : (
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
