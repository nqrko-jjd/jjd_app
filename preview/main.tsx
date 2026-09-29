import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft, CalendarDays, Camera, FileText, MapPin, MessageSquare, Users} from 'lucide-react';
import {Shell} from '../apps/web/src/components/Shell';
import Planning from '../apps/web/src/app/app/planning/page';
import Chantiers from '../apps/web/src/app/app/chantiers/page';
import {usePathname} from './navigation';
import {getWorksite,getEvents,reset} from './api';
import '../apps/web/src/app/globals.css';

function WorksiteDetail({ws}:{ws:any}){
  const events=getEvents(ws.id);
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
    <div className="preview-worksite-layout">
      <section className="card preview-worksite-panel">
        <div className="preview-panel-head"><div><span className="eyebrow">PLANNING</span><h2>Interventions à venir</h2></div><a className="btn" href="#/app/planning"><CalendarDays size={17}/>Ouvrir le planning</a></div>
        {events.slice(0,4).map((e:any)=><div className="preview-event-row" key={e.id}><div className="preview-event-date"><strong>{new Date(e.startAt).getDate()}</strong><span>{new Date(e.startAt).toLocaleDateString('fr-BE',{month:'short'})}</span></div><div><strong>{e.title}</strong><p>{new Date(e.startAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})}–{new Date(e.endAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})} · {e.assignments.length} personnes · {e.vehicles[0]?.vehicle?.model}</p></div><span className="badge ok">Confirmé</span></div>)}
      </section>
      <aside className="preview-worksite-side">
        <section className="card preview-worksite-panel"><span className="eyebrow">ACCÈS RAPIDE</span><div className="preview-quick-links"><button><MessageSquare size={18}/><span><strong>Conversation</strong><small>Photos et échanges du chantier</small></span></button><button><Camera size={18}/><span><strong>Photos</strong><small>Ajouter l’avancement du jour</small></span></button><button><FileText size={18}/><span><strong>Documents</strong><small>Devis, rapports et factures</small></span></button><button><Users size={18}/><span><strong>Contacts</strong><small>Client et personnes sur place</small></span></button></div></section>
        <section className="card preview-worksite-panel"><span className="eyebrow">PROCHAINE ACTION</span><h2>Préparer l’équipe</h2><p className="muted">Vérifier le véhicule, le matériel et l’accès avant le départ du dépôt.</p><a className="btn primary" href="#/app/planning">Modifier l’affectation</a></section>
      </aside>
    </div>
  </>;
}

function App(){
  const path=usePathname();
  const ws=getWorksite(path.split('/').pop()!);
  return <><div className="preview-ribbon"><strong>Aperçu privé · données fictives</strong><span>Identité visuelle JJD · planning et chantiers</span><button onClick={()=>{if(confirm('Réinitialiser uniquement les données fictives de cet aperçu ?'))reset()}}>Réinitialiser</button></div><Shell navigationPaths={['/app/chantiers','/app/planning']}><div className="preview-tabs"><a href="#/app/planning">Planning</a><a href="#/app/chantiers">Chantiers</a></div>{path==='/app/chantiers'?<Chantiers/>:ws?<WorksiteDetail ws={ws}/>:<Planning/>}</Shell></>;
}

createRoot(document.getElementById('root')!).render(<App/>);
