import type { ReactNode } from 'react';
const money = (n: number) => n.toLocaleString('fr-BE', {style:'currency',currency:'EUR',maximumFractionDigits:0});
export function WorksiteProfitability({ quoted, invoiced, paid, totalCost, costs, children }: { quoted:number; invoiced:number; paid:number; totalCost:number; costs:{label:string;amount:number}[]; children?:ReactNode }) {
 const balance=quoted-totalCost;
 return <section className="card profitability" id="worksite-profitability" tabIndex={-1}>
  <div className="labour-heading"><div><span className="eyebrow">PILOTAGE DU CHANTIER</span><h2>Rentabilité</h2><p>Où en est le chantier, sur la base des coûts enregistrés à ce jour ?</p></div><span className="badge">Montants HT</span></div>
  <div className="profitability-layout"><div className={`profitability-hero ${balance<0?'negative':''}`}><span>Vendu − coûts engagés</span><strong>{money(balance)}</strong><b>{quoted>0?`${(balance/quoted*100).toLocaleString('fr-BE',{maximumFractionDigits:1})} % du vendu`:'Taux non calculable'}</b><p>Solde provisoire : les coûts restant à engager ne sont pas encore déduits.</p></div>
   <div className="profitability-breakdown"><div><span>Montant vendu / marché</span><strong>{money(quoted)}</strong></div>{costs.map(c=><div key={c.label}><span>{c.label}</span><b>− {money(c.amount)}</b></div>)}<div className="profitability-cost-total"><strong>Total des coûts engagés</strong><strong>{money(totalCost)}</strong></div>{children}</div></div>
  <div className="profitability-comparison"><div><span>Facturé − coûts engagés</span><strong>{money(invoiced-totalCost)}</strong><small>{money(invoiced)} facturés à ce jour</small></div><div><span>Encaissé − coûts engagés</span><strong>{money(paid-totalCost)}</strong><small>{money(paid)} encaissés à ce jour</small></div><p>Un solde négatif avant facturation ou encaissement ne suffit pas à conclure que le chantier est déficitaire. La marge finale dépend aussi des travaux et des coûts restants.</p></div>
 </section>;
}
