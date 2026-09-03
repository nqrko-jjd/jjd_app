'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { portalApi, usePortalGuard } from '@/lib/portal';
import { PortalShell } from '../PortalShell';

interface Evt {
  id: string; startAt: string; endAt: string; allDay: boolean; title: string | null;
  worksiteId: string | null; worksiteRef: string | null; worksiteTitle: string | null;
  building: string | null; team: string | null; people: string[];
}

export default function PortalPlanning() {
  const { me, loading } = usePortalGuard();
  const [items, setItems] = useState<Evt[] | null>(null);

  useEffect(() => {
    if (me) portalApi<{ items: Evt[] }>('/planning').then((r) => setItems(r.items)).catch(() => {});
  }, [me]);

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
      {!items ? <div className="p-empty">Chargement…</div> : byDay.length === 0 ? <div className="p-empty">Aucune intervention programmée.</div> : (
        <div className="p-list">
          {byDay.map(([day, evts]) => (
            <div key={day} className="p-panel">
              <h3 style={{ marginBottom: '0.7rem', textTransform: 'capitalize' }}>
                {new Date(day).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
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
          ))}
        </div>
      )}
    </PortalShell>
  );
}
