'use client';
import { tr } from '@/lib/ui-language';
import {useState} from 'react';
import Link from 'next/link';
import {useApi} from '@/lib/use-api';
import {ErrorState,SkeletonRows,EmptyState} from '@/components/States';
import {OperationsChart} from './OperationsChart';
interface Month {month:string;revenue:number;expenses:number;result:number;invoiced:number;collected:number;hours:number;labourCost:number;expenseBreakdown?:{purchases:number;payroll:number;other:number}}
const metrics={operations:'Évolution de l’exploitation',revenue:'CA net enregistré',expenses:'Charges enregistrées',hours:'Heures pointées'};
export function DashboardExplorer({monthly}:{monthly?:Month[]}){
 const {data:fetched,error,loading,reload}=useApi<{monthly:Month[]}>(monthly ? null : '/api/finance/analytics?months=24');
 const data=monthly ? {monthly} : fetched;
 const [metric,setMetric]=useState<keyof typeof metrics>('operations'),[period,setPeriod]=useState(12),[mode,setMode]=useState('bars'),[compare,setCompare]=useState(false),[focus,setFocus]=useState<number|null>(null),[table,setTable]=useState(false);
 const rows=data?.monthly.slice(-(monthly ? monthly.length : period))??[];
 const label=(month:string)=>new Date(`${month}-01T12:00:00Z`).toLocaleDateString('fr-BE',{month:'short',year:'2-digit'});
 const value=(m:Month)=>metric==='expenses'?m.expenses:metric==='hours'?m.hours:m.revenue;
 const format=(n:number)=>metric==='hours'?`${n.toLocaleString('fr-BE',{maximumFractionDigits:1})} h`:`${n.toLocaleString('fr-BE',{maximumFractionDigits:0})} €`;
 const previous=(m:Month)=>data?.monthly.find(p=>p.month===`${Number(m.month.slice(0,4))-1}${m.month.slice(4)}`);
 const points=rows.map(value);const prev=rows.map(m=>previous(m));const vals=[...points,...(compare?prev.filter((m):m is Month=>!!m).map(value):[])];
 const max=Math.max(1,...vals)*1.1,min=Math.min(0,...vals)*1.1;const y=(n:number)=>240-(n-min)/(max-min)*210;const step=770/Math.max(1,rows.length);const selected=focus===null?null:rows[Math.min(focus,rows.length-1)];
 return <section className="panel dashboard-explorer"><div className="dashboard-chart-head"><div><h2>{metrics[metric]}</h2><span className="muted">{metric==='hours'?'Pointages soumis et approuvés':'Grand livre · montants HT'} · mois courant provisoire</span></div><label className="operations-indicator">Indicateur<select value={metric} onChange={e=>{setMetric(e.target.value as keyof typeof metrics);setFocus(null)}}>{Object.entries(metrics).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
 {loading&&<SkeletonRows/>}{error&&<ErrorState message={error} onRetry={reload}/>}
 {data&&rows.every(m=>m.revenue===0&&m.expenses===0&&m.hours===0)&&<EmptyState title="Aucune donnée enregistrée sur cette période" text="Les graphiques apparaîtront avec vos écritures et pointages."/>}
 {data&&(metric==='operations'?<OperationsChart rangeMonths={monthly?.length} data={data.monthly.map(m=>({month:label(m.month),ca:m.revenue,other:0,buy:m.expenseBreakdown?.purchases??0,labor:m.expenseBreakdown?.payroll??0,charges:m.expenseBreakdown?.other??m.expenses}))}/>:<>
 <div className="dashboard-chart-total"><div><span className="eyebrow">Total sur la période</span><strong>{format(points.reduce((a,n)=>a+n,0))}</strong></div><div className="dashboard-chart-options">{!monthly&&<label className="operations-indicator">Période<select value={period} onChange={e=>{setPeriod(Number(e.target.value));setFocus(null)}}><option value={3}>3 mois</option><option value={6}>{tr("6 mois")}</option><option value={12}>{tr("12 mois")}</option></select></label>}<div className="dashboard-segment"><button className={mode==='bars'?'active':''} onClick={()=>setMode('bars')}>Barres</button><button className={mode==='lines'?'active':''} onClick={()=>setMode('lines')}>Courbes</button></div>{!monthly&&<label className="dashboard-comparison"><input type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/>Année précédente</label>}</div></div>
 <div className="operations-canvas"><svg viewBox="0 0 850 285" role="img" aria-label={`${metrics[metric]}. Tableau accessible en dessous.`}>{[min,(min+max)/2,max].map(n=><g key={n}><line x1="60" x2="830" y1={y(n)} y2={y(n)} stroke="var(--line)"/><text x="52" y={y(n)+4} textAnchor="end" fontSize="12" fill="var(--ink-3)">{Math.round(n/1000)} k</text></g>)}<line x1="60" x2="830" y1={y(0)} y2={y(0)} stroke="var(--ink-3)"/>
 {mode==='bars'?points.map((n,i)=><rect key={i} x={60+(i+.2)*step} y={Math.min(y(0),y(n))} width={step*.6} height={Math.abs(y(0)-y(n))} rx="3" fill="#237461"/>):<polyline points={points.map((n,i)=>`${60+(i+.5)*step},${y(n)}`).join(' ')} stroke="#237461" strokeWidth="3" fill="none"/>}
 {compare&&prev.map((m,i)=>m&&i>0&&prev[i-1]?<line key={i} x1={60+(i-.5)*step} y1={y(value(prev[i-1]!))} x2={60+(i+.5)*step} y2={y(value(m))} stroke="#9aa69d" strokeWidth="2" strokeDasharray="5 4"/>:null)}
 {rows.map((m,i)=><g key={m.month}><text x={60+(i+.5)*step} y="270" textAnchor="middle" fontSize="12" fill="var(--ink-3)">{label(m.month)}</text><rect x={60+i*step} y="15" width={step} height="230" fill="transparent" role="button" tabIndex={0} aria-label={`${label(m.month)}, ${format(value(m))}`} onMouseEnter={()=>setFocus(i)} onFocus={()=>setFocus(i)} onClick={()=>setFocus(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')setFocus(i)}}/></g>)}</svg></div>
 <div className="dashboard-chart-detail" aria-live="polite">{selected?<><strong>{label(selected.month)} : {format(value(selected))}</strong>{compare&&<span>Année précédente : {previous(selected)?format(value(previous(selected)!)):'Non disponible'}</span>}</>:<span>Touchez un mois pour lire les valeurs.{compare?' Trait gris : année précédente.':''}</span>}</div>
 <div className="dashboard-chart-foot"><p className="muted">{metric==='hours'?'Heures effectives sur chantier. Distinctes des journées rémunérées.':'Écritures enregistrées par date de pièce, notes de crédit incluses. Ces montants ne représentent pas les mouvements bancaires.'}</p><div><button className="btn" onClick={()=>setTable(!table)}>{table?'Masquer':'Voir'} les données</button><Link className="btn" href={metric==='hours'?'/app/pointage':'/app/finances/grand-livre'}>Ouvrir le détail</Link></div></div>
 {table&&<div className="tbl-wrap"><table className="tbl"><thead><tr><th>{tr("Mois")}</th><th>{metrics[metric]}</th>{compare&&<th>Année précédente</th>}</tr></thead><tbody>{rows.map(m=><tr key={m.month}><td>{label(m.month)}</td><td>{format(value(m))}</td>{compare&&<td>{previous(m)?format(value(previous(m)!)):'Non disponible'}</td>}</tr>)}</tbody></table></div>}
 </>)}
 </section>
}
