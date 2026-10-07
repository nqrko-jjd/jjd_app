'use client';
import {useEffect,useRef,useState} from 'react';
import {X, Maximize2, Minimize2} from 'lucide-react';
import CompanionPreview from './CompanionPreview';
import s from '@/app/app-compagnon/companion.module.css';

/** Panneau du Compagnon IA. Il s'ouvre depuis le menu latéral (plus de bouton flottant : il masquait des boutons de page). */
export function CompanionLauncher({open,onClose,onOpenConnected}:{open:boolean;onClose:()=>void;onOpenConnected?:()=>void}){
 const [large,setLarge]=useState(false);const closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  const opener=document.activeElement as HTMLElement|null;
  closeButton.current?.focus();
  function key(e:KeyboardEvent){if(e.key==='Escape'&&!document.querySelector('[aria-modal="true"]'))onClose();}
  window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('keydown',key);opener?.focus?.();};
 },[open,onClose]);
 return <section id="jjd-companion" aria-label="Compagnon IA" className={`${s.panel} ${large?s.expanded:''}`} hidden={!open}>
 <div className={s.panelBar}><span><i/>JJD · Toujours à vos côtés</span><div>{onOpenConnected&&<button onClick={()=>{onClose();onOpenConnected();}}>Assistant connecté</button>}<button aria-label={large?'Réduire le chat':'Agrandir le chat'} onClick={()=>setLarge(!large)}>{large?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button ref={closeButton} aria-label="Fermer le chat" onClick={onClose}><X size={19}/></button></div></div>
 <div className={s.hubBody}><CompanionPreview embedded/></div>
 </section>;
}
