import type { ReactNode } from 'react';
const money = (n: number) => n.toLocaleString('fr-BE', {style:'currency',currency:'EUR',maximumFractionDigits:0});
export function WorksiteProfitability({ quoted, invoiced, paid, totalCost, costs, children }: { quoted:number; invoiced:number; paid:number; totalCost:number; costs:{label:string;amount:number}[]; children?:ReactNode }) {
 // Le "vendu" (devis du logiciel) ne reflète pas toujours tout le chantier : travaux
 // complémentaires facturés sans devis formel, vieux chantiers importés d'Excel avec
 // seulement une partie des devis recréés après coup... Si le facturé dépasse déjà le vendu,
 // ce dernier est manifestement sous-évalué — on bascule alors le chiffre principal sur
 // l'encaissé (réel, fiable) et on relègue le vendu en second plan plutôt que de laisser
 // croire à une perte qui n'existe pas.
 const quotedReliable = quoted <= 0 || invoiced <= quoted;
 const heroBasis = quotedReliable ? quoted : paid;
 const balance = heroBasis - totalCost;
 return <section className="card profitability" id="worksite-profitability" tabIndex={-1}>
  <div className="labour-heading"><div><span className="eyebrow">PILOTAGE DU CHANTIER</span><h2>Rentabilité</h2><p>Où en est le chantier, sur la base des coûts enregistrés à ce jour ?</p></div><span className="badge">Montants HT</span></div>
  <div className="profitability-layout"><div className={`profitability-hero ${balance<0?'negative':''}`}><span>{quotedReliable?'Vendu':'Encaissé'} − coûts engagés</span><strong>{money(balance)}</strong><b>{heroBasis>0?`${(balance/heroBasis*100).toLocaleString('fr-BE',{maximumFractionDigits:1})} % ${quotedReliable?'du vendu':"de l'encaissé"}`:'Taux non calculable'}</b><p>{quotedReliable?'Solde provisoire : les coûts restant à engager ne sont pas encore déduits.':"Le devis enregistré ne couvre pas tout le chantier (facturé > vendu) : solde basé sur l'encaissé réel plutôt que sur le devis."}</p></div>
   <div className="profitability-breakdown"><div><span>Montant vendu / marché</span><strong>{money(quoted)}</strong></div>{costs.map(c=><div key={c.label}><span>{c.label}</span><b>− {money(c.amount)}</b></div>)}<div className="profitability-cost-total"><strong>Total des coûts engagés</strong><strong>{money(totalCost)}</strong></div>{children}</div></div>
  <div className="profitability-comparison"><div className="profitability-comparison-row">{!quotedReliable && <div><span>Vendu − coûts engagés</span><strong>{money(quoted-totalCost)}</strong><small>{money(quoted)} vendus (devis incomplet)</small></div>}<div><span>Facturé − coûts engagés</span><strong>{money(invoiced-totalCost)}</strong><small>{money(invoiced)} facturés à ce jour</small></div><div><span>Encaissé − coûts engagés</span><strong>{money(paid-totalCost)}</strong><small>{money(paid)} encaissés à ce jour</small></div></div><p>Un solde négatif avant facturation ou encaissement ne suffit pas à conclure que le chantier est déficitaire. La marge finale dépend aussi des travaux et des coûts restants. Les compléments des journées rémunérées et le temps hors chantier doivent également être affectés : ils ne sont pas automatiquement répartis ici.</p></div>
 </section>;
}
