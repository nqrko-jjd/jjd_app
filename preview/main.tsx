import React from 'react';
import {createRoot} from 'react-dom/client';
import {Shell} from '../apps/web/src/components/Shell';
import Planning from '../apps/web/src/app/app/planning/page';
import Chantiers from '../apps/web/src/app/app/chantiers/page';
import {usePathname} from './navigation';
import {getWorksite,getEvents,reset} from './api';
import '../apps/web/src/app/globals.css';
function App(){const path=usePathname();const ws=getWorksite(path.split('/').pop()!);return <><div className="preview-ribbon"><strong>Aperçu privé · données fictives</strong><span>Planning et chantiers · modifications conservées dans ce navigateur</span><button onClick={()=>{if(confirm('Réinitialiser uniquement les données fictives de cet aperçu ?'))reset()}}>Réinitialiser</button></div><Shell navigationPaths={['/app/chantiers','/app/planning']}><div className="preview-tabs"><a href="#/app/planning">Tester le planning</a><a href="#/app/chantiers">Voir les chantiers</a></div>{path==='/app/chantiers'?<Chantiers/>:ws?<><div className="page-head"><div><p className="muted">DOSSIER DE DÉMONSTRATION · {ws.ref}</p><h1>{ws.title}</h1><p>{ws.city} · {ws.client?.name}</p></div><a className="btn" href="#/app/chantiers">Retour aux chantiers</a></div><div className="card" style={{padding:24}}><h2>Affectations prévues</h2><p className="muted" style={{margin:'8px 0 20px'}}>La fiche complète du chantier sera retravaillée dans le prochain lot.</p>{getEvents(ws.id).map((e:any)=><div key={e.id} style={{padding:'14px 0',borderBottom:'1px solid var(--line)'}}><strong>{new Date(e.startAt).toLocaleDateString('fr-BE',{weekday:'long',day:'numeric',month:'long'})}</strong><p>{e.title} · {e.assignments.length} personnes</p></div>)}<a className="btn primary" style={{marginTop:20}} href="#/app/planning">Ouvrir le planning</a></div></>:<Planning/>}</Shell></>}
createRoot(document.getElementById('root')!).render(<App/>);
