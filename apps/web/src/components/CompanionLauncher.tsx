'use client';
import {useEffect,useRef,useState} from 'react';
import {X, Maximize2, Minimize2} from 'lucide-react';
import CompanionPreview from './CompanionPreview';
import {CompanionAvatar} from './CompanionAvatar';
import s from '@/app/app-compagnon/companion.module.css';
export function CompanionLauncher({onOpenConnected}:{onOpenConnected?:()=>void;unread?:number}){
 const [open,setOpen]=useState(false);const [large,setLarge]=useState(false);const trigger=useRef<HTMLButtonElement>(null);const closeButton=useRef<HTMLButtonElement>(null);
 function close(){setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
 useEffect(()=>{if(!open)return;closeButton.current?.focus();function key(e:KeyboardEvent){if(e.key==='Escape'&&!document.querySelector('[aria-modal="true"]'))close();}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 return <><button ref={trigger} className={s.fab} aria-label="Ouvrir Compagnon IA" aria-expanded={open} aria-controls="jjd-companion" onClick={()=>setOpen(!open)}><CompanionAvatar size={36}/><span>Compagnon IA<small>Votre assistant JJD</small></span></button>
 <section id="jjd-companion" aria-label="Compagnon IA" className={`${s.panel} ${large?s.expanded:''}`} hidden={!open}>
 <div className={s.panelBar}><span><i/>JJD · Toujours à vos côtés</span><div>{onOpenConnected&&<button onClick={()=>{close();onOpenConnected();}}>Assistant connecté</button>}<button aria-label={large?'Réduire le chat':'Agrandir le chat'} onClick={()=>setLarge(!large)}>{large?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button ref={closeButton} aria-label="Fermer le chat" onClick={close}><X size={19}/></button></div></div>
 <div className={s.hubBody}><CompanionPreview embedded/></div>
 </section></>;
}
