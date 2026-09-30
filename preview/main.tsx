import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft, CalendarDays, Camera, CheckCircle2, Clock3, Euro, FileText, MapPin, MessageSquare, Receipt, ShoppingCart, TrendingUp, Users, Wallet} from 'lucide-react';
import {WorksiteLabourDetail, type LabourRow} from '../apps/web/src/components/WorksiteLabourDetail';
import {WorksiteProfitability} from '../apps/web/src/components/WorksiteProfitability';
import {Shell} from '../apps/web/src/components/Shell';
import Dashboard from '../apps/web/src/app/app/page';
import Planning from '../apps/web/src/app/app/planning/page';
import Chantiers from '../apps/web/src/app/app/chantiers/page';
import {usePathname} from './navigation';
import {getWorksite,getEvents,reset,people} from './api';
import {SecondaryPage} from './secondary';
import {MessagingPage} from './messages';
import '../apps/web/src/app/globals.css';

function WorksiteDetail({ws}:{ws:any}){
  const events=getEvents(ws.id);
  const [tab,setTab]=useState<'overview'|'finances'>('overview');
  const finance=useMemo(()=>{
    const index=Math.max(0,Number(String(ws.id).replace(/\D/g,''))||0);
    const labour=6850+index*1375;
    const hours=137+index*28;
    const pendingHours=14+index*3;
    // Fictional recorded time, deliberately independent of planning assignments.
    const labourRows:LabourRow[]=Array.from({length:20},(_,i)=>{
      const person=people[(index*4+i%4)%people.length];
      const base=Math.floor(hours/20*4)/4;
      const rowHours=i===19?hours-19*base:base;
      const baseAmount=Math.round(labour/hours*base*100)/100;
      const amount=i===19?labour-19*baseAmount:baseAmount;
      return {date:`2026-09-${String(21+Math.floor(i/4)).padStart(2,'0')}`,personId:person.id,personName:person.displayName,hours:rowHours,amount:Math.round(amount*100)/100,pending:false};
    });
    [0,1].forEach(i=>{const person=people[(index*4+i)%people.length];labourRows.push({date:'2026-09-28',personId:person.id,personName:person.displayName,hours:pendingHours/2,amount:Math.round(pendingHours/2*labour/hours*100)/100,pending:true});});
    const purchases=4320+index*980;
    const equipment=780+index*210;
    const subcontracting=index%2?2450:0;
    const totalCost=labour+purchases+equipment+subcontracting;
    const quoted=Number(ws.quotedHt||0);
    const invoiced=Number(ws.invoicedHt||0);
    return {labour,purchases,equipment,subcontracting,totalCost,quoted,invoiced,paid:Math.round(invoiced*.72),leftToInvoice:Math.max(0,quoted-invoiced),forecastMargin:quoted-totalCost,labourRows,hours,pendingHours,purchaseCount:8+index*2};
  },[ws]);
  return <>
    <a className="btn ghost preview-back" href="#/app/chantiers"><ArrowLeft size={17}/>Tous les chantiers</a>
    <section className="preview-worksite-hero">
      {ws.building?.photoThumbUrl&&<img src={ws.building.photoThumbUrl} alt=""/>}
      <div className="preview-worksite-overlay"/>
      <div className="preview-worksite-copy">
        <div className="eyebrow">DOSSIER CHANTIER · {ws.ref}</div>
        <h1>{ws.title}</h1>
        <p><MapPin size={17}/>{ws.city} · {ws.client?.name}</p>
        <div className="row"><span className="badge ok">En cours</span><span className="badge">{ws.scope==='intervention'?'Intervention':'Chantier long'}</span><span className="badge">{ws.billingMode==='regie'?'Régie':'Sur devis'}</span></div>
      </div>
    </section>
    <div className="preview-worksite-stats">
      <div className="card"><small>Prochaine intervention</small><strong>{events[0]?new Date(events[0].startAt).toLocaleDateString('fr-BE',{weekday:'short',day:'numeric',month:'short'}):'À planifier'}</strong><span>07:00 · départ dépôt</span></div>
      <div className="card"><small>Équipe prévue</small><strong>{events[0]?.assignments.length??0} ouvriers</strong><span>Responsable · {ws.manager?.displayName}</span></div>
      <div className="card"><small>Avancement</small><strong>{ws.status==='in_progress'?'45':'15'}%</strong><div className="progress-bar"><div className="progress-fill" style={{width:ws.status==='in_progress'?'45%':'15%'}}/></div></div>
      <div className="card"><small>Facturé HT</small><strong>{Number(ws.invoicedHt||0).toLocaleString('fr-BE')} €</strong><span>Devisé · {Number(ws.quotedHt||0).toLocaleString('fr-BE')} €</span></div>
    </div>
    <nav className="preview-worksite-tabs" aria-label="Sections du chantier">
      <button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Vue opérationnelle</button>
      <button className={tab==='finances'?'active':''} onClick={()=>setTab('finances')}>Finances &amp; rentabilité <span>{finance.leftToInvoice.toLocaleString('fr-BE')} € à facturer</span></button>
    </nav>
    {tab==='overview'?<div className="preview-worksite-layout">
      <section className="card preview-worksite-panel">
        <div className="preview-panel-head"><div><span className="eyebrow">PLANNING</span><h2>Interventions à venir</h2></div><a className="btn" href="#/app/planning"><CalendarDays size={17}/>Ouvrir le planning</a></div>
        {events.slice(0,4).map((e:any)=><div className="preview-event-row" key={e.id}><div className="preview-event-date"><strong>{new Date(e.startAt).getDate()}</strong><span>{new Date(e.startAt).toLocaleDateString('fr-BE',{month:'short'})}</span></div><div><strong>{e.title}</strong><p>{new Date(e.startAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})}–{new Date(e.endAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})} · {e.assignments.length} personnes · {e.vehicles[0]?.vehicle?.model}</p></div><span className="badge ok">Confirmé</span></div>)}
      </section>
      <aside className="preview-worksite-side">
        <section className="card preview-worksite-panel"><span className="eyebrow">RENTABILITÉ</span><h2>{finance.forecastMargin.toLocaleString('fr-BE')} €</h2><p className="muted">Vendu − coûts engagés à ce jour. Coûts restants non déduits.</p><button className="btn primary" onClick={()=>setTab('finances')}>Voir la rentabilité</button></section>
        <section className="card preview-worksite-panel"><span className="eyebrow">ACCÈS RAPIDE</span><div className="preview-quick-links"><button><MessageSquare size={18}/><span><strong>Conversation</strong><small>Photos et échanges du chantier</small></span></button><button><Camera size={18}/><span><strong>Photos</strong><small>Ajouter l’avancement du jour</small></span></button><button><FileText size={18}/><span><strong>Documents</strong><small>Devis, rapports et factures</small></span></button><button><Users size={18}/><span><strong>Contacts</strong><small>Client et personnes sur place</small></span></button></div></section>
        <section className="card preview-worksite-panel"><span className="eyebrow">PROCHAINE ACTION</span><h2>Préparer l’équipe</h2><p className="muted">Vérifier le véhicule, le matériel et l’accès avant le départ du dépôt.</p><a className="btn primary" href="#/app/planning">Modifier l’affectation</a></section>
      </aside>
    </div>:<WorksiteFinance ws={ws} finance={finance}/>}
  </>;
}

function WorksiteFinance({ws,finance}:{ws:any;finance:any}){
  const [invoiceOpen,setInvoiceOpen]=useState(false);
  const euro=(n:number)=>n.toLocaleString('fr-BE',{style:'currency',currency:'EUR',maximumFractionDigits:0});
  const marginPct=finance.quoted?Math.round(finance.forecastMargin/finance.quoted*100):0;
  return <div className="preview-finance">
    <section className="preview-finance-head">
      <div><span className="eyebrow">SYNTHÈSE DU CHANTIER</span><h2>Du terrain à la facture</h2><p>Les données déjà saisies dans les heures, achats et documents sont regroupées ici. Aucun double encodage.</p></div>
      <button className="btn primary" onClick={()=>setInvoiceOpen(true)}><Receipt size={17}/>Préparer une facture</button>
    </section>
    <div className="preview-finance-kpis">
      <article className="hero"><span><FileText size={17}/>Marché HT</span><strong>{euro(finance.quoted)}</strong><small>{ws.billingMode==='regie'?'Régie valorisée à ce jour':'Devis accepté'}</small></article>
      <article><span><Euro size={17}/>Facturé</span><strong>{euro(finance.invoiced)}</strong><small>{finance.quoted?Math.round(finance.invoiced/finance.quoted*100):0}% du marché</small></article>
      <article><span><Wallet size={17}/>Encaissé</span><strong>{euro(finance.paid)}</strong><small>{euro(Math.max(0,finance.invoiced-finance.paid))} à recevoir</small></article>
      <article className="attention"><span><Receipt size={17}/>Reste à facturer</span><strong>{euro(finance.leftToInvoice)}</strong><small>Base disponible à contrôler</small></article>
      <article><span><TrendingUp size={17}/>Marge prévue</span><strong>{euro(finance.forecastMargin)}</strong><small>{marginPct}% après coûts engagés</small></article>
    </div>
    <WorksiteProfitability quoted={finance.quoted} invoiced={finance.invoiced} paid={finance.paid} totalCost={finance.totalCost} costs={[{label:'Main-d’œuvre validée',amount:finance.labour},{label:'Achats & matériaux',amount:finance.purchases},{label:'Matériel / véhicules',amount:finance.equipment},{label:'Sous-traitance',amount:finance.subcontracting}]}><p className="muted">{finance.pendingHours} h restent à valider, hors coûts ci-dessus. Données fictives.</p></WorksiteProfitability>
    <div className="preview-finance-grid">
      <section className="card preview-finance-card">
        <div className="preview-panel-head"><div><span className="eyebrow">BASE DE FACTURATION</span><h2>Éléments à contrôler</h2></div><span className="badge warn">3 vérifications</span></div>
        <div className="preview-billable-row"><span className="preview-finance-icon"><Clock3 size={18}/></span><div><strong>Main-d’œuvre</strong><p>{finance.hours} h validées · {finance.pendingHours} h encore à valider</p></div><strong>{euro(finance.labour)}</strong><button onClick={()=>{const el=document.getElementById('worksite-labour');el?.scrollIntoView({behavior:'smooth'});el?.focus({preventScroll:true});}}>Voir les heures</button></div>
        <div className="preview-billable-row"><span className="preview-finance-icon"><ShoppingCart size={18}/></span><div><strong>Achats &amp; matériaux</strong><p>{finance.purchaseCount} achats liés · 2 justificatifs à vérifier</p></div><strong>{euro(finance.purchases)}</strong><button>Voir les achats</button></div>
        <div className="preview-billable-row"><span className="preview-finance-icon"><Receipt size={18}/></span><div><strong>Matériel &amp; sous-traitance</strong><p>Locations, consommables et prestations externes</p></div><strong>{euro(finance.equipment+finance.subcontracting)}</strong><button>Voir le détail</button></div>
        <div className="preview-finance-ready"><CheckCircle2 size={19}/><div><strong>{euro(finance.leftToInvoice)} peuvent être préparés</strong><small>Le brouillon reste soumis au contrôle final de Julien avant envoi.</small></div></div>
      </section>
      <aside className="card preview-finance-card preview-cost-card">
        <span className="eyebrow">COÛTS ENGAGÉS</span><h2>{euro(finance.totalCost)}</h2>
        {[["Main-d’œuvre",finance.labour],["Achats matériaux",finance.purchases],["Matériel / véhicules",finance.equipment],["Sous-traitance",finance.subcontracting]].filter((x:any)=>x[1]>0).map((x:any)=><div className="preview-cost-row" key={x[0]}><span>{x[0]}</span><strong>{euro(x[1])}</strong><div><i style={{width:`${Math.round(x[1]/finance.totalCost*100)}%`}}/></div></div>)}
        <div className="preview-cost-footer"><span>Marge prévisionnelle</span><strong>{euro(finance.forecastMargin)} · {marginPct}%</strong></div>
      </aside>
    </div>
    <WorksiteLabourDetail rows={finance.labourRows} demo/>
    <section className="card preview-finance-card">
      <div className="preview-panel-head"><div><span className="eyebrow">DOCUMENTS COMMERCIAUX</span><h2>Devis, états d’avancement &amp; factures</h2></div><button className="btn">Voir tous les documents</button></div>
      <div className="preview-doc-row"><span className="badge ok">Accepté</span><div><strong>Devis {ws.ref.replace('DEMO','D2026')}</strong><small>Marché initial · conditions et cahier des charges</small></div><strong>{euro(finance.quoted)}</strong><button>Ouvrir</button></div>
      {finance.invoiced>0&&<div className="preview-doc-row"><span className="badge primary">Envoyé</span><div><strong>État d’avancement n°1</strong><small>Facture liée et suivi de l’encaissement</small></div><strong>{euro(finance.invoiced)}</strong><button>Ouvrir</button></div>}
    </section>
    {invoiceOpen&&<InvoicePreparationModal ws={ws} finance={finance} onClose={()=>setInvoiceOpen(false)}/>}
  </div>;
}

function InvoicePreparationModal({ws,finance,onClose}:{ws:any;finance:any;onClose:()=>void}){
  const euro=(n:number)=>n.toLocaleString('fr-BE',{style:'currency',currency:'EUR',maximumFractionDigits:0});
  const [kind,setKind]=useState(ws.billingMode==='regie'?'regie':'progress');
  const [progress,setProgress]=useState(25);
  const [picked,setPicked]=useState({labour:true,purchases:true,equipment:true});
  const amounts={labour:Math.round(finance.labour*1.38),purchases:Math.round(finance.purchases*1.15),equipment:Math.round((finance.equipment+finance.subcontracting)*1.25)};
  const regieTotal=(Object.keys(picked) as (keyof typeof picked)[]).reduce((sum,key)=>sum+(picked[key]?amounts[key]:0),0);
  const progressTotal=Math.max(0,Math.min(finance.leftToInvoice,Math.round(finance.quoted*progress/100)));
  const total=kind==='progress'?progressTotal:kind==='deposit'?Math.round(finance.quoted*.3):kind==='balance'?finance.leftToInvoice:regieTotal;
  const toggle=(key:keyof typeof picked)=>setPicked(v=>({...v,[key]:!v[key]}));
  return <div className="preview-invoice-scrim" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="preview-invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
      <header><div><span className="eyebrow">{ws.ref} · BROUILLON</span><h2 id="invoice-title">Préparer la facturation</h2><p>Les montants viennent du chantier. Rien n’est envoyé au client à cette étape.</p></div><button className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button></header>
      <div className="preview-invoice-body">
        <section>
          <div className="preview-invoice-step"><span>1</span><div><strong>Choisir le type de facturation</strong><small>Le parcours s’adapte au contrat du chantier.</small></div></div>
          <div className="preview-invoice-types">
            {[['regie','Régie / décompte','Heures, achats et matériel réellement utilisés'],['progress','État d’avancement','Pourcentage du devis accepté'],['deposit','Acompte 30 %','Avant ou au démarrage du chantier'],['balance','Solde','Tout ce qui reste à facturer']].map(x=><button key={x[0]} className={kind===x[0]?'active':''} onClick={()=>setKind(x[0])}><strong>{x[1]}</strong><small>{x[2]}</small></button>)}
          </div>
          {kind==='regie'?<>
            <div className="preview-invoice-step"><span>2</span><div><strong>Sélectionner les éléments</strong><small>Coût interne visible pour contrôle, prix de vente proposé à droite.</small></div></div>
            <div className="preview-invoice-lines">
              <label><input type="checkbox" checked={picked.labour} onChange={()=>toggle('labour')}/><span><strong>Main-d’œuvre validée</strong><small>{finance.hours} h · coût interne {euro(finance.labour)}</small></span><b>{euro(amounts.labour)}</b></label>
              <label><input type="checkbox" checked={picked.purchases} onChange={()=>toggle('purchases')}/><span><strong>Achats &amp; matériaux</strong><small>{finance.purchaseCount} achats · coût interne {euro(finance.purchases)}</small></span><b>{euro(amounts.purchases)}</b></label>
              <label><input type="checkbox" checked={picked.equipment} onChange={()=>toggle('equipment')}/><span><strong>Matériel &amp; sous-traitance</strong><small>Coût interne {euro(finance.equipment+finance.subcontracting)}</small></span><b>{euro(amounts.equipment)}</b></label>
            </div>
          </>:kind==='progress'?<>
            <div className="preview-invoice-step"><span>2</span><div><strong>Définir l’avancement à facturer</strong><small>Le cumul ne peut pas dépasser le montant du devis.</small></div></div>
            <div className="preview-progress-input"><input type="range" min="5" max="100" step="5" value={progress} onChange={e=>setProgress(Number(e.target.value))}/><strong>{progress}%</strong><span>{euro(progressTotal)} pour cet état</span></div>
          </>:<div className="preview-invoice-info"><CheckCircle2 size={19}/><span>{kind==='deposit'?'Acompte calculé à 30 % du devis accepté.':'Le solde reprend le montant du marché qui n’a pas encore été facturé.'}</span></div>}
        </section>
        <aside>
          <span className="eyebrow">RÉCAPITULATIF</span><h3>{kind==='regie'?'Décompte en régie':kind==='progress'?`État d’avancement · ${progress}%`:kind==='deposit'?'Facture d’acompte':'Facture de solde'}</h3>
          <dl><div><dt>Client</dt><dd>{ws.client?.name}</dd></div><div><dt>Chantier</dt><dd>{ws.title}</dd></div><div><dt>Déjà facturé</dt><dd>{euro(finance.invoiced)}</dd></div><div><dt>Après ce brouillon</dt><dd>{euro(finance.invoiced+total)}</dd></div></dl>
          <div className="preview-invoice-total"><span>Total HT proposé</span><strong>{euro(total)}</strong><small>TVA et conditions reprises dans la fiche client</small></div>
          <label className="preview-invoice-note"><span>Note interne</span><textarea placeholder="Point à vérifier avant validation…"/></label>
        </aside>
      </div>
      <footer><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={()=>{alert(`Maquette : brouillon de ${euro(total)} créé pour validation interne.`);onClose()}}>Créer le brouillon · {euro(total)}</button></footer>
    </section>
  </div>;
}

function App(){
  const path=usePathname();
  const ws=getWorksite(path.split('/').pop()!);
  const secondary=<SecondaryPage path={path}/>;
  const navigationPaths=['/app','/app/chantiers','/app/planning','/app/messagerie','/app/documents','/app/achats','/app/analyse','/app/immeubles','/app/contacts','/app/equipe','/app/controle'];
  const known=navigationPaths.includes(path)||!!ws;
  return <><div className="preview-ribbon"><strong>Aperçu privé · données fictives</strong><span>Identité visuelle JJD · parcours administratifs et terrain</span><button onClick={()=>{if(confirm('Réinitialiser uniquement les données fictives de cet aperçu ?'))reset()}}>Réinitialiser</button></div><Shell navigationPaths={navigationPaths}><div className="preview-tabs"><a href="#/app">Vue d’ensemble</a><a href="#/app/planning">Planning</a><a href="#/app/chantiers">Chantiers</a><a href="#/app/messagerie">Messagerie</a><a href="#/app/documents">Facturation</a><a href="#/app/achats">Achats</a></div>{path==='/app'?<Dashboard/>:path==='/app/chantiers'?<Chantiers/>:ws?<WorksiteDetail ws={ws}/>:path==='/app/planning'?<Planning/>:path==='/app/messagerie'?<MessagingPage/>:secondary??<section className="state"><h2>Parcours en préparation</h2><p>Cette page annexe sera reprise dans la prochaine étape de la maquette.</p><a className="btn primary" href="#/app">Retour à la vue d’ensemble</a></section>}{!known&&null}</Shell></>;
}

createRoot(document.getElementById('root')!).render(<App/>);
