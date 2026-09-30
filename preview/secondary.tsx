import React, {useMemo, useState} from 'react';
import {AlertTriangle, BarChart3, BrainCircuit, Building2, CheckCircle2, Clock3, CreditCard, FileText, Filter, Mail, MapPin, Phone, Plus, Search, ShieldCheck, Sparkles, Users} from 'lucide-react';
import {people} from './api';

const money=(n:number)=>n.toLocaleString('fr-BE',{style:'currency',currency:'EUR',maximumFractionDigits:0});

function PageTitle({eyebrow,title,sub,action}:{eyebrow:string;title:string;sub:string;action?:React.ReactNode}){
  return <div className="preview-page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{sub}</p></div>{action}</div>;
}

function SearchBox({value,onChange,placeholder}:{value:string;onChange:(v:string)=>void;placeholder:string}){
  return <label className="preview-search"><Search size={17}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></label>;
}

const docs=[
  {kind:'Facture',number:'F2026-391',client:'SRL Design Plus',worksite:'DEMO-101 · Résidence des Tilleuls',date:'28 sept.',amount:12480,status:'Envoyée',tone:'primary'},
  {kind:"État d’avancement",number:'EA-2026-044',client:'Famille Exemple',worksite:'DEMO-102 · Villa des Pins',date:'27 sept.',amount:31500,status:'À valider',tone:'warn'},
  {kind:'Devis',number:'D2026-418',client:'ACP Exemple',worksite:'Remise en état après fuite',date:'25 sept.',amount:8670,status:'Accepté',tone:'ok'},
  {kind:'Facture',number:'F2026-386',client:'Promoteur Exemple',worksite:'DEMO-103 · Les Jardins lot 12',date:'22 sept.',amount:18900,status:'Payée',tone:'ok'},
  {kind:'Devis',number:'D2026-415',client:'Syndic Exemple',worksite:'Réfection des communs',date:'20 sept.',amount:42750,status:'Sans réponse',tone:'crit'},
];

export function DocumentsPage(){
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('Tous');
  const shown=docs.filter(d=>(status==='Tous'||d.status===status)&&[d.number,d.client,d.worksite,d.kind].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageTitle eyebrow="COMMERCIAL & FINANCES" title="Devis & factures" sub="Retrouver rapidement ce qui doit être préparé, validé, envoyé ou relancé." action={<button className="btn primary" onClick={()=>alert('Maquette : ouverture du formulaire de création de document.')}><Plus size={17}/>Nouveau document</button>}/>
    <div className="preview-module-kpis"><article><span>À valider</span><strong>6</strong><small>{money(74820)} HT</small></article><article><span>À envoyer</span><strong>4</strong><small>documents prêts</small></article><article className="attention"><span>Relances prioritaires</span><strong>3</strong><small>{money(46500)} sans réponse</small></article><article><span>À encaisser</span><strong>{money(42150)}</strong><small>7 factures ouvertes</small></article></div>
    <div className="preview-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Numéro, client ou chantier…"/><div className="preview-pills">{['Tous','À valider','Envoyée','Accepté','Payée','Sans réponse'].map(s=><button key={s} className={status===s?'active':''} onClick={()=>setStatus(s)}>{s}</button>)}</div></div>
    <section className="card preview-data-card"><div className="preview-data-head"><span>Document</span><span>Client & chantier</span><span>Date</span><span>Montant HT</span><span>Statut</span><span/></div>{shown.map(d=><button className="preview-data-row" key={d.number} onClick={()=>alert(`Maquette : ouverture de ${d.number}.`)}><span className="preview-doc-mark"><FileText size={18}/><i>{d.kind}</i><b>{d.number}</b></span><span><strong>{d.client}</strong><small>{d.worksite}</small></span><span>{d.date}</span><span className="amount">{money(d.amount)}</span><span><i className={`badge ${d.tone}`}>{d.status}</i></span><span>Ouvrir</span></button>)}{!shown.length&&<div className="preview-empty">Aucun document ne correspond à ces filtres.</div>}</section>
  </>;
}

const expenses=[
  {supplier:'Van Marcke',ref:'VM-93841',worksite:'DEMO-101 · Résidence des Tilleuls',date:'29 sept.',amount:1847,method:'VISA Prépaid 2',state:'Paiement déclaré',tone:'warn',pdf:true},
  {supplier:'Carimar',ref:'CAR-260914',worksite:'DEMO-102 · Villa des Pins',date:'27 sept.',amount:3260,method:'Belfius',state:'Rapproché',tone:'ok',pdf:true},
  {supplier:'Knauf Belgium',ref:'KN-10483',worksite:'DEMO-103 · Les Jardins lot 12',date:'26 sept.',amount:5780,method:'ING',state:'À rapprocher',tone:'crit',pdf:true},
  {supplier:'Toolstation',ref:'TS-887201',worksite:'Non affecté',date:'24 sept.',amount:438,method:'VISA Prépaid 1',state:'Chantier manquant',tone:'warn',pdf:false},
];

export function PurchasesPage(){
  const [query,setQuery]=useState('');
  const shown=expenses.filter(e=>JSON.stringify(e).toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageTitle eyebrow="ACHATS & TRÉSORERIE" title="Dépenses sans angle mort" sub="Chaque facture fournisseur reste liée à son paiement, son PDF et au chantier qui porte le coût." action={<button className="btn primary" onClick={()=>alert('Maquette : ajout guidé d’une dépense avec photo ou PDF.')}><Plus size={17}/>Ajouter une dépense</button>}/>
    <div className="preview-reconcile-hero"><div><span className="eyebrow">FILE DE CONTRÔLE</span><h2>5 dépenses demandent une vérification</h2><p>Deux paiements par carte attendent le relevé mensuel, deux opérations bancaires doivent être rapprochées et un achat n’a pas encore de chantier.</p></div><button className="btn">Ouvrir les rapprochements</button></div>
    <div className="preview-module-kpis"><article><span>Achats ce mois</span><strong>{money(28340)}</strong><small>42 pièces reçues</small></article><article><span>Rattaché aux chantiers</span><strong>91%</strong><small>{money(25560)} imputés</small></article><article><span>À payer</span><strong>{money(7280)}</strong><small>3 échéances</small></article><article className="attention"><span>Cartes à confirmer</span><strong>2</strong><small>en attente du décompte</small></article></div>
    <div className="preview-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Fournisseur, référence ou chantier…"/><button className="btn"><Filter size={16}/>Filtres</button></div>
    <section className="preview-expense-list">{shown.map(e=><article className="card preview-expense" key={e.ref}><div className="preview-expense-logo">{e.supplier.slice(0,2).toUpperCase()}</div><div><strong>{e.supplier}</strong><small>{e.ref} · {e.date}</small></div><div className="preview-expense-link"><span>{e.worksite}</span><small>Chantier imputé</small></div><div><strong>{money(e.amount)}</strong><small><CreditCard size={13}/>{e.method}</small></div><span className={`badge ${e.tone}`}>{e.state}</span><button title={e.pdf?'Afficher le PDF':'Ajouter un justificatif'}>{e.pdf?<><FileText size={17}/>PDF</>:<><Plus size={17}/>Justificatif</>}</button></article>)}</section>
  </>;
}

const buildings=[
  {id:'w0',name:'Résidence des Tilleuls',city:'Uccle',client:'Syndic Exemple',image:'/demo/jjd/residence-brick.png',open:3,observation:1,contacts:['Président ACP','Concierge'],type:'ACP · 48 lots'},
  {id:'w1',name:'Villa des Pins',city:'Rhode-Saint-Genèse',client:'Famille Exemple',image:'/demo/jjd/villa.png',open:1,observation:0,contacts:['Propriétaire'],type:'Particulier · rénovation'},
  {id:'w2',name:'Les Jardins · lot 12',city:'Waterloo',client:'Promoteur Exemple',image:'/demo/jjd/residence-modern.png',open:4,observation:0,contacts:['Conducteur de chantier','Acquéreur'],type:'Projet promoteur · 12 lots'},
  {id:'w3',name:'Immeuble Horizon',city:'Bruxelles',client:'ACP Exemple',image:'/demo/jjd/residence-brick.png',open:2,observation:1,contacts:['Syndic','Locataire','Propriétaire'],type:'ACP · 22 lots'},
];

export function BuildingsPage(){
  const [query,setQuery]=useState('');
  const shown=buildings.filter(b=>JSON.stringify(b).toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageTitle eyebrow="RÉPERTOIRES" title="Immeubles & projets" sub="Une seule fiche de référence pour les adresses, contacts, interventions et chantiers successifs." action={<button className="btn primary"><Plus size={17}/>Nouvel immeuble ou projet</button>}/>
    <div className="preview-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Nom, ville, syndic ou promoteur…"/><div className="preview-pills"><button className="active">Tous</button><button>ACP / Syndics</button><button>Promoteurs</button><button>Particuliers</button></div></div>
    <div className="preview-building-grid">{shown.map(b=><a className="card preview-building" key={b.name} href={`#/app/chantiers/${b.id}`}><img src={b.image} alt=""/><div className="preview-building-body"><div className="row"><span className="badge">{b.type}</span>{b.observation>0&&<span className="badge warn">{b.observation} en observation</span>}</div><h2>{b.name}</h2><p><MapPin size={14}/>{b.city} · {b.client}</p><div className="preview-building-stats"><span><strong>{b.open}</strong> dossiers ouverts</span><span><strong>{b.contacts.length}</strong> contacts utiles</span></div><div className="preview-building-contacts">{b.contacts.map(c=><span key={c}>{c}</span>)}</div></div></a>)}</div>
  </>;
}

const contacts=[
  {name:'Claire Dumont',company:'ACP Résidence des Tilleuls',role:'Présidente de copropriété',phone:'+32 475 12 34 56',email:'claire@example.be',kind:'Syndic / ACP',image:'/demo/jjd/manager.png'},
  {name:'Marc Leroy',company:'Promoteur Exemple',role:'Conducteur de chantier',phone:'+32 476 23 45 67',email:'marc@example.be',kind:'Promoteur',image:''},
  {name:'Sophie Martin',company:'Villa des Pins',role:'Propriétaire',phone:'+32 477 34 56 78',email:'sophie@example.be',kind:'Particulier',image:''},
  {name:'Nicolas Bernard',company:'Immeuble Horizon · appartement 3B',role:'Locataire / accès',phone:'+32 478 45 67 89',email:'nicolas@example.be',kind:'Occupant',image:''},
  {name:'Julie François',company:'Syndic Exemple',role:'Gestionnaire technique',phone:'+32 479 56 78 90',email:'julie@example.be',kind:'Syndic / ACP',image:''},
];

export function ContactsPage(){
  const [query,setQuery]=useState('');
  const shown=contacts.filter(c=>JSON.stringify(c).toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageTitle eyebrow="RÉPERTOIRES" title="Contacts reliés, pas dupliqués" sub="Une personne peut intervenir sur plusieurs immeubles ou dossiers, avec un rôle différent dans chaque contexte." action={<button className="btn primary"><Plus size={17}/>Nouveau contact</button>}/>
    <button className="preview-duplicate-callout"><Sparkles size={20}/><span><strong>2 doublons potentiels détectés</strong><small>Même e-mail ou numéro de téléphone. Vérifier avant de créer une nouvelle fiche.</small></span><b>Comparer</b></button>
    <div className="preview-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Nom, société, téléphone ou adresse…"/><button className="btn"><Filter size={16}/>Type de relation</button></div>
    <div className="preview-contact-grid">{shown.map((c,i)=><article className="card preview-contact" key={c.name}><div className="preview-contact-person">{c.image?<img src={c.image} alt=""/>:<span>{c.name.split(' ').map(x=>x[0]).join('')}</span>}<div><strong>{c.name}</strong><small>{c.role}</small></div></div><span className="badge plain">{c.kind}</span><div className="preview-contact-company"><Building2 size={15}/><span><strong>{c.company}</strong><small>{i%2===0?'Facturation et suivi':'Accès chantier et rendez-vous'}</small></span></div><a href={`tel:${c.phone.replaceAll(' ','')}`}><Phone size={15}/>{c.phone}</a><a href={`mailto:${c.email}`}><Mail size={15}/>{c.email}</a><footer><button>Voir la fiche</button><button>Associer à un dossier</button></footer></article>)}</div>
  </>;
}

export function TeamPage(){
  const [filter,setFilter]=useState('Tous');
  const workers=people.map((p,i)=>({...p,status:i%7===0?'Absent':i%5===0?'Disponible':'Affecté',permit:i%3!==0,vehicle:i%5===0?'—':`V${i%6+1}`,image:i===29?'/demo/jjd/worker-julien.png':i===0?'/demo/jjd/worker-bogdan.png':''}));
  const shown=workers.filter(w=>filter==='Tous'||w.status===filter||(filter==='Permis'&&w.permit));
  return <>
    <PageTitle eyebrow="ÉQUIPES" title="30 personnes, une vue exploitable" sub="Disponibilité, permis, spécialité et véhicule restent visibles avant de composer les équipes." action={<button className="btn primary"><Plus size={17}/>Ajouter un ouvrier</button>}/>
    <div className="preview-module-kpis"><article><span>Actifs</span><strong>30</strong><small>28 ouvriers · 2 responsables</small></article><article><span>Affectés aujourd’hui</span><strong>22</strong><small>6 équipes terrain</small></article><article><span>Disponibles</span><strong>4</strong><small>renfort possible</small></article><article className="attention"><span>Sans permis</span><strong>10</strong><small>à répartir dans les véhicules</small></article></div>
    <div className="preview-toolbar"><div className="preview-pills">{['Tous','Affecté','Disponible','Absent','Permis'].map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f}</button>)}</div><a href="#/app/planning" className="btn">Ouvrir le planning</a></div>
    <div className="preview-team-grid">{shown.map(w=><article className="card preview-worker" key={w.id}>{w.image?<img src={w.image} alt=""/>:<span className="preview-worker-avatar">{w.displayName.slice(0,2).toUpperCase()}</span>}<div className="preview-worker-main"><strong>{w.displayName}</strong><small>{w.specialties[0]} · {w.role==='foreman'?'Chef de chantier':'Ouvrier'}</small></div><span className={`badge ${w.status==='Affecté'?'primary':w.status==='Disponible'?'ok':'warn'}`}>{w.status}</span><div className="preview-worker-meta"><span><ShieldCheck size={14}/>{w.permit?'Permis B':'Sans permis'}</span><span><Users size={14}/>{w.vehicle==='—'?'À véhiculer':`Véhicule ${w.vehicle}`}</span></div><button>Voir la fiche</button></article>)}</div>
  </>;
}

export function AnalysisPage(){
  const margins=[{name:'Résidence des Tilleuls',sold:62000,cost:38500,pct:38},{name:'Villa des Pins',sold:84500,cost:61200,pct:28},{name:'Les Jardins · lot 12',sold:54000,cost:39700,pct:26},{name:'Immeuble Horizon',sold:18600,cost:14400,pct:23}];
  const months=[62,78,71,89,82,100];
  return <>
    <PageTitle eyebrow="DIRECTION" title="Les chiffres utiles pour décider" sub="Trésorerie, facturation à produire, carnet signé et rentabilité des chantiers réunis dans une lecture unique." action={<button className="btn"><BarChart3 size={17}/>Exporter le rapport</button>}/>
    <section className="preview-analysis-hero"><div><span>Argent disponible</span><strong>{money(148600)}</strong><small>ING + Belfius · actualisé aujourd’hui</small></div><div><span>Encaissements attendus à 30 jours</span><strong>{money(92400)}</strong><small>dont {money(18450)} en retard</small></div><div><span>Carnet de commandes signé</span><strong>{money(684000)}</strong><small>4,8 mois de charge estimée</small></div></section>
    <div className="preview-analysis-alerts"><a href="#/app/documents"><AlertTriangle size={18}/><span><strong>{money(32700)} de travaux réalisés non facturés</strong><small>6 dossiers peuvent être préparés cette semaine</small></span><b>Traiter</b></a><a href="#/app/documents"><Clock3 size={18}/><span><strong>4 factures à relancer en priorité</strong><small>Échéance dépassée de plus de 15 jours</small></span><b>Relancer</b></a><a href="#/app/chantiers"><CheckCircle2 size={18}/><span><strong>3 devis attendent la validation de Julien</strong><small>{money(74820)} HT prêts à contrôler</small></span><b>Vérifier</b></a></div>
    <div className="preview-analysis-grid">
      <section className="card preview-analysis-card"><div className="preview-panel-head"><div><span className="eyebrow">ACTIVITÉ</span><h2>Facturation des 6 derniers mois</h2></div><strong>+18%</strong></div><div className="preview-bars">{months.map((m,i)=><div key={i}><i style={{height:`${m}%`}}/><span>{['Avr','Mai','Juin','Juil','Août','Sept'][i]}</span></div>)}</div><div className="preview-analysis-foot"><span>Septembre</span><strong>{money(128400)} HT</strong></div></section>
      <section className="card preview-analysis-card"><span className="eyebrow">COMMERCIAL</span><h2>Devis et transformation</h2><div className="preview-funnel"><div><span>Reçus</span><strong>28</strong><i style={{width:'100%'}}/></div><div><span>Envoyés</span><strong>19</strong><i style={{width:'68%'}}/></div><div><span>Acceptés</span><strong>11</strong><i style={{width:'39%'}}/></div></div><div className="preview-analysis-foot"><span>Taux d’acceptation</span><strong>58%</strong></div></section>
    </div>
    <section className="card preview-analysis-card"><div className="preview-panel-head"><div><span className="eyebrow">RENTABILITÉ</span><h2>Chantiers actifs</h2></div><a href="#/app/chantiers" className="btn">Voir les chantiers</a></div><div className="preview-margin-table"><div className="head"><span>Chantier</span><span>Vendu</span><span>Coûts engagés</span><span>Marge prévue</span></div>{margins.map(m=><a href="#/app/chantiers/w0" key={m.name}><span>{m.name}</span><span>{money(m.sold)}</span><span>{money(m.cost)}</span><span><b>{m.pct}%</b><i><em style={{width:`${m.pct}%`}}/></i></span></a>)}</div></section>
  </>;
}

const controlItems=[
  {kind:'E-mail analysé',title:'Demande urgente · fuite abondante',sub:'Syndic Exemple · Résidence Parc Sud',action:'Créer l’intervention',icon:BrainCircuit,tone:'crit'},
  {kind:'Facturation',title:'14 heures encore à valider',sub:'DEMO-101 · Résidence des Tilleuls',action:'Contrôler les heures',icon:Clock3,tone:'warn'},
  {kind:'Achats',title:'Paiement carte sans justificatif',sub:'Toolstation · 438 € · VISA Prépaid 1',action:'Associer le ticket',icon:CreditCard,tone:'warn'},
  {kind:'Devis',title:'Brouillon prêt pour contrôle final',sub:'D2026-421 · rénovation salle de bain · 24 680 €',action:'Ouvrir le devis',icon:FileText,tone:'primary'},
  {kind:'Contact',title:'Doublon possible détecté',sub:'Claire Dumont · même téléphone sur 2 fiches',action:'Comparer les fiches',icon:Users,tone:'plain'},
];

export function ControlPage(){
  const [done,setDone]=useState<string[]>([]);
  return <>
    <PageTitle eyebrow="ADMINISTRATION" title="File de contrôle" sub="Un seul endroit pour ce que l’IA ou l’équipe a préparé, mais qui nécessite encore une décision humaine."/>
    <div className="preview-control-summary"><div><BrainCircuit size={23}/><span><strong>Assistant en pré-analyse</strong><small>Classe les demandes et prépare les brouillons sans jamais les envoyer seul.</small></span></div><span className="badge ok">5 éléments prêts</span></div>
    <div className="preview-control-layout"><section className="preview-control-list"><div className="preview-control-tabs"><button className="active">À traiter <span>{controlItems.length-done.length}</span></button><button>Urgent <span>1</span></button><button>Terminé aujourd’hui <span>{done.length}</span></button></div>{controlItems.filter(x=>!done.includes(x.title)).map(item=><article className="card preview-control-item" key={item.title}><span className={`preview-control-icon ${item.tone}`}><item.icon size={19}/></span><div><span className="eyebrow">{item.kind}</span><strong>{item.title}</strong><small>{item.sub}</small></div><button className="btn">{item.action}</button><button className="preview-control-done" title="Marquer comme traité" onClick={()=>setDone(v=>[...v,item.title])}><CheckCircle2 size={19}/></button></article>)}{controlItems.length===done.length&&<div className="card preview-empty"><CheckCircle2 size={28}/><p>Tout est traité pour aujourd’hui.</p></div>}</section><aside className="card preview-control-rules"><span className="eyebrow">RÈGLES JJD</span><h2>Ce qui reste humain</h2><ul><li>Julien valide le prix final des devis.</li><li>Melvina valide le planning avant publication.</li><li>David contrôle paiements et trésorerie.</li><li>Les demandes urgentes peuvent être confirmées par Melvina ou David.</li><li>Aucun message client n’est envoyé automatiquement.</li></ul></aside></div>
  </>;
}

export function SecondaryPage({path}:{path:string}){
  if(path==='/app/documents')return <DocumentsPage/>;
  if(path==='/app/achats')return <PurchasesPage/>;
  if(path==='/app/immeubles')return <BuildingsPage/>;
  if(path==='/app/contacts')return <ContactsPage/>;
  if(path==='/app/equipe')return <TeamPage/>;
  if(path==='/app/analyse')return <AnalysisPage/>;
  if(path==='/app/controle')return <ControlPage/>;
  return null;
}
