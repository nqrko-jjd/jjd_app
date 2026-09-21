'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { usePortalApi, usePortalGuard } from '@/lib/portal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { PortalShell } from '../PortalShell';

interface Evt {
  id: string; startAt: string; endAt: string; allDay: boolean; title: string | null;
  worksiteId: string | null; worksiteRef: string | null; worksiteTitle: string | null;
  building: string | null; team: string | null; people: string[];
}

export default function PortalPlanning() {
  const { me, loading } = usePortalGuard();
  const { data, error, reload } = usePortalApi<{ items: Evt[] }>(me ? '/planning' : null);
  const items = data?.items ?? null;

  const byDay = useMemo(() => {
    const m = new Map<string, Evt[]>();
    for (const e of items ?? []) {
      const k = new Date(e.startAt).toISOString().slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (loading || !me) return null;

  return (
    <PortalShell title="Planning" subtitle="Les interventions programmées sur votre portefeuille">
      {error ? <ErrorState message={error} onRetry={reload} /> : !items ? <SkeletonRows rows={4} height={110} /> : byDay.length === 0 ? <EmptyState icon={CalendarDays} title="Rien de programmé ces deux prochaines semaines" text="Dès qu’une intervention est planifiée sur votre portefeuille, elle apparaît ici jour par jour." action={<Link href="/portail/demande" className="btn primary">Nouvelle demande</Link>} secondary={<Link href="/portail/interventions" className="btn">Voir les interventions</Link>} /> : (
        <div className="p-list">
          {byDay.map(([day, evts]) => (
            <div key={day} className="p-panel">
              <h3 style={{ marginBottom: '0.7rem', textTransform: 'capitalize' }}>
                {new Date(day).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
                {evts.length > 6 && <span className="p-note" style={{ fontWeight: 400, marginLeft: '0.5rem' }}>({evts.length})</span>}
              </h3>
              <div className="plan-day-events">
                {evts.map((e) => (
                  <div key={e.id} className="p-doc-row">
                    <span className="p-note" style={{ width: 52, fontVariantNumeric: 'tabular-nums' }}>
                      {e.allDay ? 'Jour.' : new Date(e.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {e.building ?? e.worksiteRef}{e.title ? ` — ${e.title}` : e.worksiteTitle ? ` — ${e.worksiteTitle}` : ''}
                      </div>
                      <div className="p-note">
                        {[e.team, e.people.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'Équipe JJD'}
                      </div>
                    </div>
                    {e.worksiteId && <Link href={`/portail/chantier/${e.worksiteId}`} className="p-note" style={{ fontSize: '0.78rem' }}>voir →</Link>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
