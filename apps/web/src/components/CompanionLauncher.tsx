'use client';
import {useEffect,useRef,useState} from 'react';
import {MessageCircle, Sparkles, X, Maximize2, Minimize2} from 'lucide-react';
import {useAuth} from '@/lib/auth';
import CompanionPreview from './CompanionPreview';
import MessagingWorkspace from './MessagingWorkspace';
import {CompanionAvatar} from './CompanionAvatar';
import s from '@/app/app-compagnon/companion.module.css';
export function CompanionLauncher({onOpenConnected,unread=0}:{onOpenConnected?:()=>void;unread?:number}){
 const {user}=useAuth();const [open,setOpen]=useState(false);const [large,setLarge]=useState(false);const [tab,setTab]=useState<'team'|'ai'>('ai');const [teamVisited,setTeamVisited]=useState(false);const trigger=useRef<HTMLButtonElement>(null);const closeButton=useRef<HTMLButtonElement>(null);
 function close(){setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
 useEffect(()=>{if(!open)return;closeButton.current?.focus();function key(e:KeyboardEvent){if(e.key==='Escape'&&!document.querySelector('[aria-modal="true"]'))close();}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 return <><button ref={trigger} className={s.fab} aria-label="Ouvrir les discussions et Compagnon" aria-expanded={open} aria-controls="jjd-companion" onClick={()=>setOpen(!open)}><CompanionAvatar size={36}/><span>Discussions<small>Équipe & Compagnon</small></span>{unread>0&&<b className={s.unread}>{unread}</b>}</button>
 <section id="jjd-companion" aria-label="Discussions JJD" className={`${s.panel} ${large?s.expanded:''}`} hidden={!open}>
 <div className={s.panelBar}><span><i/>JJD · Toujours à vos côtés</span><div>{onOpenConnected&&<button onClick={()=>{close();onOpenConnected();}}>Assistant connecté</button>}<button aria-label={large?'Réduire le chat':'Agrandir le chat'} onClick={()=>setLarge(!large)}>{large?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button ref={closeButton} aria-label="Fermer le chat" onClick={close}><X size={19}/></button></div></div>
 <div className={s.hubTabs} role="tablist" aria-label="Espace de discussion"><button id="team-tab" role="tab" aria-selected={tab==='team'} aria-controls="team-panel" onClick={()=>{setTab('team');setTeamVisited(true);}}><MessageCircle size={18}/>Équipe{unread>0&&<b>{unread}</b>}</button><button id="ai-tab" role="tab" aria-selected={tab==='ai'} aria-controls="ai-panel" onClick={()=>setTab('ai')}><Sparkles size={18}/>Compagnon IA<small>Aperçu</small></button></div>
 <div id="ai-panel" role="tabpanel" aria-labelledby="ai-tab" className={s.hubBody} hidden={tab!=='ai'}><CompanionPreview embedded/></div>
 <div id="team-panel" role="tabpanel" aria-labelledby="team-tab" className={`${s.hubBody} ${s.teamPanel}`} hidden={tab!=='team'}>{user?.role==='storekeeper'?<p className={s.accessNote}>La messagerie n’est pas encore accessible au profil magasinier. Ses droits doivent être définis avant activation.</p>:teamVisited&&<MessagingWorkspace compact active={open&&tab==='team'}/>}</div>
 </section></>;
}
