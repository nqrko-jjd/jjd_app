'use client';
import { vehicleName } from '@/lib/vehicle';
import Link from 'next/link';
import { useMemo } from 'react';
import { CalendarDays, Package, ClipboardCheck, ArrowRight } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { ErrorState, SkeletonRows } from './States';
import type { PlanningEv } from './planningTypes';

interface StockAlert { id: string; name: string; qty: number; minQty: number | null; unit: string; low: boolean }
/** Original mockup's operational priorities, using existing endpoints and permissions.
 * Read only: opening a priority never confirms an assignment or changes a quantity. */
export function OperationalControl() {
  const window = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 14);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);
  const plan = useApi<{ items: PlanningEv[] }>(`/api/planning?from=${window.from}&to=${window.to}`);
  const stock = useApi<{ items: StockAlert[] }>('/api/stock/items');
  const reports = useApi<{ items: { id: string }[] }>('/api/reports/review-queue');
  const departures = (plan.data?.items ?? []).filter(e => e.status === 'tentative').sort((a,b) => a.startAt.localeCompare(b.startAt));
  const shortages = (stock.data?.items ?? []).filter(i => i.low);
  return <section className="operational-control" aria-label="Contrôle et préparation">
    <div className="operational-heading"><div><span className="eyebrow">Les prochains départs</span><h2>Contrôle & préparation</h2></div><Link href="/app/planning" className="btn">Ouvrir le planning <ArrowRight size={15}/></Link></div>
    <div className="operational-stats">
      <button type="button" onClick={()=>document.getElementById('departures')?.scrollIntoView({block:'start'})}><CalendarDays size={20}/><span><strong>{plan.data ? departures.length : '—'}</strong><small>Affectations à confirmer · 14 jours</small></span></button>
      <button type="button" onClick={()=>document.getElementById('shortages')?.scrollIntoView({block:'start'})}><Package size={20}/><span><strong>{stock.data ? shortages.length : '—'}</strong><small>Articles sous le seuil</small></span></button>
      <Link href="/app/rapports"><ClipboardCheck size={20}/><span><strong>{reports.data ? reports.data.items.length : '—'}</strong><small>Rapports à examiner</small></span></Link>
    </div>
    {reports.error && <ErrorState message={reports.error} onRetry={reports.reload}/>}
    <div className="operational-columns">
      <section className="card" id="departures"><header><h3>Départs à confirmer</h3><span className="muted">14 prochains jours</span></header>
        {plan.loading && !plan.data ? <SkeletonRows rows={3} height={68}/> : plan.error ? <ErrorState message={plan.error} onRetry={plan.reload}/> : departures.length === 0 ? <p className="operational-empty">Aucune affectation provisoire sur cette période.</p> : departures.slice(0,6).map(e => <Link className="operational-departure" href="/app/planning" key={e.id}><div className="operational-date"><strong>{new Date(e.startAt).toLocaleDateString('fr-BE',{weekday:'short',day:'numeric',month:'short'})}</strong><small>{e.allDay ? 'Journée' : `${new Date(e.startAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})}–${new Date(e.endAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})}`}</small></div><div><strong>{e.worksite.ref} · {e.worksite.title}</strong><small>{e.assignments.map(a=>a.person.displayName || a.person.firstName).join(' · ') || 'Équipe à composer'}</small><small>{e.vehicles.map(v=>vehicleName(v.vehicle)).filter(Boolean).join(' · ') || 'Véhicule à vérifier'}</small></div><ArrowRight size={16}/></Link>)}
        {departures.length > 6 && <Link className="operational-more" href="/app/planning">Voir les {departures.length} affectations dans le planning →</Link>}
      </section>
      <section className="card" id="shortages"><header><h3>Matériaux à préparer</h3><Link href="/app/stock" className="muted">Stock →</Link></header>
        {stock.loading && !stock.data ? <SkeletonRows rows={3} height={68}/> : stock.error ? <ErrorState message={stock.error} onRetry={stock.reload}/> : shortages.length === 0 ? <p className="operational-empty">Aucun article actif sous son seuil de stock.</p> : shortages.slice(0,6).map(i => <Link className="operational-stock" href={`/app/stock/${i.id}`} key={i.id}><div><strong>{i.name}</strong><small>{i.qty} {i.unit} disponibles · seuil {i.minQty}</small></div><span>Prévoir {Math.max(0,(i.minQty ?? 0)-i.qty)} <ArrowRight size={15}/></span></Link>)}
        {shortages.length > 6 && <Link className="operational-more" href="/app/stock">Voir le stock →</Link>}
      </section>
    </div>
  </section>;
}
