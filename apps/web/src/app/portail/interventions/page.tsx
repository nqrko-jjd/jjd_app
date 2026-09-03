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
const PRIO_DOT: Record<string, string> = { urgent: 'crit', high: 'crit', normal: 'gold', low: 'grey' };
const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

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
      <div className="p-filters">
        <input className="p-input" placeholder="Réf, objet…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="p-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">En cours</option>
          <option value="">Toutes</option>
          <option value="done">Terminées</option>
          <option value="invoiced">Facturées</option>
          <option value="lead">Demandes</option>
        </select>
      </div>

      {!items ? <div className="p-empty">Chargement…</div> : items.length === 0 ? <div className="p-empty">Aucune intervention.</div> : (
        <div className="p-panel" style={{ padding: '0.4rem 1rem' }}>
          <table className="p-tbl">
            <thead><tr><th>Réf</th><th>{me.isSyndic ? 'Immeuble' : 'Objet'}</th><th>Statut</th><th>Priorité</th><th>Technicien</th><th>Maj</th></tr></thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} onClick={() => router.push(`/portail/chantier/${w.id}`)} style={{ cursor: 'pointer' }}>
                  <td className="p-note" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{w.ref}</td>
                  <td>{w.building?.name ?? w.title}</td>
                  <td><span className={`p-dot ${STATUS_DOT[w.status] ?? 'grey'}`}>{w.statusLabel}</span></td>
                  <td>{w.priority === 'normal' || w.priority === 'low' ? <span className="p-note">—</span> : <span className={`p-dot ${PRIO_DOT[w.priority] ?? 'gold'}`}>{w.priorityLabel}</span>}</td>
                  <td>{w.manager ?? '—'}</td>
                  <td className="p-note">{fdate(w.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalShell>
  );
}
