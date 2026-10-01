'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ChevronLeft,MessageCircle,Plus} from 'lucide-react';
import {api,ApiError} from '@/lib/api';
import {CompanionAvatar} from './CompanionAvatar';
import s from '@/app/app-compagnon/companion.module.css';
export type LiveQuota={direction:boolean;enabled:boolean;monthlyLimitEuro:number|null;spentEuro:number;reservedEuro:number;remainingPercent:number|null;dailyRemaining:number|null;dailyLimit:number|null;dailyResetAt:string;monthlyResetAt:string};
type Turn={role:'user'|'assistant';content:string};
const date=(v:string)=>new Intl.DateTimeFormat('fr-BE',{timeZone:'Europe/Brussels',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
export default function CompanionLive({embedded=false,initialQuota}:{embedded?:boolean;initialQuota:LiveQuota}){
 const [turns,setTurns]=useState<Turn[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState(false),[q,setQ]=useState(initialQuota),[error,setError]=useState('');
 const pending=useRef<{requestId:string;messages:Turn[]}|null>(null),sending=useRef(false),bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[turns.length,busy]);
 useEffect(()=>{const refresh=()=>api<LiveQuota>('/api/assistant/quota').then(setQ).catch(()=>{});const t=setInterval(refresh,30000);return()=>clearInterval(t);},[]);
 async function send(retry=false){
  if(sending.current||(!retry&&!input.trim()))return;sending.current=true;setBusy(true);setError('');
  const messages=retry&&pending.current?pending.current.messages:[...turns,{role:'user' as const,content:input.trim()}];
  const payload=retry&&pending.current?pending.current:{requestId:crypto.randomUUID(),messages};pending.current=payload;
  if(!retry){setTurns(messages);setInput('');}
  try{const r=await api<{reply:string;quota:LiveQuota}>('/api/assistant/chat',{method:'POST',body:payload});setTurns([...messages,{role:'assistant',content:r.reply}]);setQ(r.quota);pending.current=null;}
  catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status!==409)pending.current=null;}
  finally{await api<LiveQuota>('/api/assistant/quota').then(setQ).catch(()=>{});sending.current=false;setBusy(false);}
 }
 const blocked=!q.enabled||q.remainingPercent===0||q.dailyRemaining===0;
 return <div className={`${s.app} ${embedded?s.embedded:''}`}><main className={s.main}>
  <header className={s.header}><div className={s.heading}><CompanionAvatar size={38}/><div><strong>Compagnon JJD</strong><small>Assistant IA · lecture seule</small></div></div><button className={s.pending} disabled={busy} onClick={()=>{setTurns([]);setError('');pending.current=null;}}> <Plus size={14}/> Nouvelle</button></header>
  <button className={s.quotaStrip} aria-expanded={details} onClick={()=>setDetails(!details)}><span className={s.previewTag}>Connecté</span><span>{q.direction?'Direction':`${q.dailyRemaining}/${q.dailyLimit} demandes`} · {q.remainingPercent??'—'} % disponibles</span><span className={s.quotaLink}>Mon quota</span></button>
  <div className={s.thread}>
   {details&&<section className={s.quotaCard}><div className={s.quotaTitle}><strong>Votre utilisation réelle</strong></div><div className={s.quotaMetric}><span>Crédit restant</span><b>{q.remainingPercent??'—'} %</b></div><progress max={100} value={q.remainingPercent??0}/><p>{q.spentEuro.toFixed(4)} € comptabilisés · {q.reservedEuro.toFixed(4)} € réservés<br/>Budget : {q.monthlyLimitEuro??'à définir'} € · renouvellement le {date(q.monthlyResetAt)} (heure belge).</p>{q.direction?<p>Budget direction distinct ; aucune limite de 10 demandes/jour.</p>:<p>{q.dailyRemaining} demandes restantes · renouvellement le {date(q.dailyResetAt)}.</p>}<p>Montants API hors taxes, selon le taux de conversion configuré. Une provision conservée après incident peut être supérieure au coût fournisseur définitif.</p></section>}
   {!turns.length?<section className={s.welcome}><h1>Bonjour,<br/><em>comment puis-je t’aider ?</em></h1><div className={s.starters}>{['Retrouver un chantier','Retrouver un contact','Comprendre les pointages'].map(t=><button key={t} onClick={()=>setInput(t)}><MessageCircle size={18}/><strong>{t}</strong></button>)}</div><p>Consultation uniquement. Aucun devis, tâche ou planning ne sera créé.</p></section>:<div className={s.messages}>{turns.map((t,i)=><div key={i} className={`${s.message} ${t.role==='user'?s.mine:''}`}><div className={s.author}>{t.role==='assistant'&&<CompanionAvatar size={25}/>} {t.role==='user'?'Vous':'Compagnon IA'}</div><div className={s.bubble}>{t.content}</div></div>)}</div>}
   {busy&&<p role="status">Compagnon consulte les informations autorisées…</p>}<div ref={bottom}/>
  </div><footer className={s.footer}>{error&&<p role="alert" className={s.error}>{error}</p>}{pending.current&&!busy&&<button className={s.extension} onClick={()=>send(true)}>Vérifier la réponse de cette demande</button>}{blocked&&<p className={s.error}>Accès suspendu ou quota atteint. Consulte « Mon quota ».</p>}<div className={s.composer}><textarea aria-label="Votre demande à Compagnon" value={input} onChange={e=>setInput(e.target.value)} maxLength={6000} rows={2} placeholder="Une question sur JJD…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!blocked)void send();}}}/><div className={s.composerBar}><span>Texte uniquement</span><button className={s.send} disabled={busy||blocked||!input.trim()} aria-label="Envoyer à Compagnon" onClick={()=>send()}><ArrowUp size={20}/></button></div></div><p className={s.privacy}>Réponse générée par IA · vérifiez les informations importantes</p></footer>
 </main></div>;
}
