'use client';
import {useEffect,useRef,useState} from 'react';
import {Sparkles, X, Maximize2, Minimize2} from 'lucide-react';
import CompanionPreview from './CompanionPreview';
import s from '@/app/app-compagnon/companion.module.css';
export function CompanionLauncher({onOpenConnected}:{onOpenConnected?:()=>void}){
 const [open,setOpen]=useState(false);const [large,setLarge]=useState(false);const trigger=useRef<HTMLButtonElement>(null);
 function close(){setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
 useEffect(()=>{function key(e:KeyboardEvent){if(e.key==='Escape'&&!document.querySelector('[aria-modal="true"]'))close();}if(open)window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 return <><button ref={trigger} className={s.fab} aria-label="Ouvrir Compagnon JJD" aria-expanded={open} aria-controls="jjd-companion" onClick={()=>setOpen(!open)}><Sparkles size={21}/><span>Compagnon<small>Aperçu IA</small></span></button>
 <section id="jjd-companion" aria-label="Compagnon JJD — aperçu" className={`${s.panel} ${large?s.expanded:''}`} hidden={!open}>
 <div className={s.panelBar}><span><i/>Votre assistant, à portée de main</span><div>{onOpenConnected&&<button onClick={()=>{close();onOpenConnected();}}>Assistant connecté</button>}<button aria-label={large?'Réduire le chat':'Agrandir le chat'} onClick={()=>setLarge(!large)}>{large?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button autoFocus aria-label="Fermer le chat" onClick={close}><X size={19}/></button></div></div>
 <CompanionPreview embedded/>
 </section></>;
}
