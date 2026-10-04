import type { ReactNode } from 'react';
const money = (n: number) => n.toLocaleString('fr-BE', {style:'currency',currency:'EUR',maximumFractionDigits:0});
const pctFmt = (n: number) => n.toLocaleString('fr-BE', {maximumFractionDigits: 2});
const COST_COLORS = ['#e6a937', '#f2cd7a', '#f7e4b3'];
const PROFIT_COLOR = '#7fd6a8';
const LOSS_COLOR = '#d9776a';

export function WorksiteProfitability({ quoted, invoiced, paid, totalCost, costs, children }: { quoted:number; invoiced:number; paid:number; totalCost:number; costs:{label:string;amount:number}[]; children?:ReactNode }) {
 // Le "vendu" (devis du logiciel) ne reflète pas toujours tout le chantier : travaux
 // complémentaires facturés sans devis formel, vieux chantiers importés d'Excel avec
 // seulement une partie des devis recréés après coup... Si le facturé dépasse déjà le vendu,
 // ce dernier est manifestement sous-évalué — on bascule alors le chiffre principal sur
 // l'encaissé (réel, fiable) et on relègue le vendu en second plan plutôt que de laisser
 // croire à une perte qui n'existe pas.
 // Sans aucun devis (marché à 0), il n'y a rien à comparer : on part directement de l'encaissé.
 const quotedReliable = quoted > 0 && invoiced <= quoted;
 const sales = quotedReliable ? quoted : paid;
 const balance = sales - totalCost;
 const pct = sales > 0 ? balance / sales * 100 : null;
 const loss = balance < 0;

 // Beignet : chaque coût puis le bénéfice, en part du total des ventes (ou des coûts si perte).
 const base = Math.max(sales, totalCost, 1);
 const R = 52, C = 2 * Math.PI * R;
 const segments = [
  ...costs.filter(c => c.amount > 0).map((c, i) => ({ key: c.label, value: c.amount, color: loss ? LOSS_COLOR : COST_COLORS[i % COST_COLORS.length]! })),
  ...(balance > 0 ? [{ key: 'Bénéfice', value: balance, color: PROFIT_COLOR }] : []),
 ];
 let offset = 0;

 return <section className="card profitability rent" id="worksite-profitability" tabIndex={-1}>
  <div className="rent-top">
   <div><span className="eyebrow">PILOTAGE DU CHANTIER</span><h2>Rentabilité actuelle</h2><p>Où en est le chantier, sur la base des coûts enregistrés à ce jour ?</p></div>
   <div className={`rent-chip ${loss ? 'negative' : ''}`}><span>{loss ? 'Perte actuelle' : 'Bénéfice actuel'}{pct != null && <b>{pctFmt(pct)} %</b>}</span><strong>{money(balance)}</strong></div>
  </div>
  <div className="rent-body">
   <div className="rent-donut" role="img" aria-label={`${loss ? 'Perte' : 'Bénéfice'} ${pct != null ? pctFmt(pct) + ' %' : ''}`}>
    <svg viewBox="0 0 140 140">
     <circle cx="70" cy="70" r={R} fill="none" stroke="#eef1ea" strokeWidth="18" />
     {segments.map(sg => { const len = sg.value / base * C; const el = <circle key={sg.key} cx="70" cy="70" r={R} fill="none" stroke={sg.color} strokeWidth="18" strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />; offset += len; return el; })}
    </svg>
    <div className="rent-donut-center"><strong>{pct != null ? `${pctFmt(pct)} %` : '—'}</strong><span>{loss ? 'Perte' : 'Bénéfice'}</span></div>
   </div>
   <div className="rent-figures">
    <div><span><i style={{background:'#cfd8cf'}} />{quotedReliable ? 'Total des ventes' : 'Total encaissé'}</span><strong>{money(sales)}</strong></div>
    {costs.map((c, i) => <div key={c.label}><span><i style={{background: loss ? LOSS_COLOR : COST_COLORS[i % COST_COLORS.length]}} />{c.label}</span><strong>{money(c.amount)}</strong></div>)}
    <div className="rent-total"><span><i style={{background: loss ? LOSS_COLOR : PROFIT_COLOR}} />{loss ? 'Perte' : 'Bénéfice'}</span><strong>{money(balance)}</strong></div>
   </div>
  </div>
  <details className="rent-details">
   <summary>Détails</summary>
   <p className="rent-note">{quotedReliable ? 'Solde provisoire : les coûts restant à engager ne sont pas encore déduits.' : quoted <= 0 ? "Aucun devis enregistré sur ce chantier : le solde est basé sur l'encaissé réel." : "Le devis enregistré ne couvre pas tout le chantier (facturé > vendu) : le solde est basé sur l'encaissé réel plutôt que sur le devis."}</p>
   <div className="profitability-comparison-row">
    <div><span>Montant vendu / marché</span><strong>{money(quoted)}</strong><small>{quotedReliable ? 'devis acceptés' : quoted <= 0 ? 'aucun devis' : 'devis incomplet'}</small></div>
    <div><span>Facturé − coûts engagés</span><strong>{money(invoiced-totalCost)}</strong><small>{money(invoiced)} facturés à ce jour</small></div>
    <div><span>Encaissé − coûts engagés</span><strong>{money(paid-totalCost)}</strong><small>{money(paid)} encaissés à ce jour</small></div>
    <div><span>Total des coûts engagés</span><strong>{money(totalCost)}</strong><small>main-d'œuvre, achats, transport</small></div>
   </div>
   {children}
   <p className="rent-note">Un solde négatif avant facturation ou encaissement ne suffit pas à conclure que le chantier est déficitaire. La marge finale dépend aussi des travaux et des coûts restants. Les compléments des journées rémunérées et le temps hors chantier doivent également être affectés : ils ne sont pas automatiquement répartis ici.</p>
  </details>
 </section>;
}
