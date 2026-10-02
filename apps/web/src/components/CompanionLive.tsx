'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ChevronLeft,MessageCircle,Mic,Phone,PhoneOff,Plus,Square,Volume2,VolumeX} from 'lucide-react';
import {api,ApiError} from '@/lib/api';
import {CompanionAvatar} from './CompanionAvatar';
import s from '@/app/app-compagnon/companion.module.css';
export type LiveQuota={direction:boolean;enabled:boolean;monthlyLimitEuro:number|null;spentEuro:number;reservedEuro:number;remainingPercent:number|null;dailyRemaining:number|null;dailyLimit:number|null;dailyResetAt:string;monthlyResetAt:string};
type Turn={role:'user'|'assistant';content:string};
const date=(v:string)=>new Intl.DateTimeFormat('fr-BE',{timeZone:'Europe/Brussels',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
// Dictée (entrée) : API Web Speech native, pas de coût ni de requête supplémentaire. Absente de
// Safari/iOS — sur iPhone on compte sur le micro du clavier système, déjà dispo sur ce textarea.
type SpeechRecognitionLike={lang:string;continuous:boolean;interimResults:boolean;
 onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>&{isFinal:boolean}>})=>void)|null;
 onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
const getSpeechRecognitionCtor=():(new()=>SpeechRecognitionLike)|null=>
 typeof window==='undefined'?null:((window as unknown as {SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike}).SpeechRecognition
  ??(window as unknown as {webkitSpeechRecognition?:new()=>SpeechRecognitionLike}).webkitSpeechRecognition)??null;
export default function CompanionLive({embedded=false,initialQuota}:{embedded?:boolean;initialQuota:LiveQuota}){
 const [turns,setTurns]=useState<Turn[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState(false),[q,setQ]=useState(initialQuota),[error,setError]=useState('');
 const [listening,setListening]=useState(false);
 const [speaking,setSpeaking]=useState(false);
 const [conversationOn,setConversationOn]=useState(false);
 const [voiceOn,setVoiceOn]=useState(()=>{try{return localStorage.getItem('jjd-companion-voice')==='1';}catch{return false;}});
 const pending=useRef<{requestId:string;messages:Turn[]}|null>(null),sending=useRef(false),bottom=useRef<HTMLDivElement>(null);
 const recognition=useRef<SpeechRecognitionLike|null>(null);
 const convoActive=useRef(false);
 const canListen=typeof window!=='undefined'&&!!getSpeechRecognitionCtor();
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[turns.length,busy]);
 useEffect(()=>{const refresh=()=>api<LiveQuota>('/api/assistant/quota').then(setQ).catch(()=>{});const t=setInterval(refresh,30000);return()=>clearInterval(t);},[]);
 useEffect(()=>()=>{convoActive.current=false;try{recognition.current?.stop();}catch{/* déjà arrêté */}try{window.speechSynthesis?.cancel();}catch{/* pas de synthèse vocale sur ce navigateur */}},[]);
 function toggleVoice(){const next=!voiceOn;setVoiceOn(next);try{localStorage.setItem('jjd-companion-voice',next?'1':'0');}catch{/* stockage indisponible — pas bloquant */}if(!next)try{window.speechSynthesis?.cancel();}catch{/* idem */}}
 function speak(text:string,onDone?:()=>void){
  try{
   window.speechSynthesis.cancel();
   const u=new SpeechSynthesisUtterance(text);u.lang='fr-FR';
   u.onstart=()=>setSpeaking(true);
   u.onend=()=>{setSpeaking(false);onDone?.();};
   u.onerror=()=>{setSpeaking(false);onDone?.();};
   window.speechSynthesis.speak(u);
  }catch{setSpeaking(false);onDone?.();}
 }
 /** Une seule prise de parole (silence détecté = fin), utilisée aussi bien pour la dictée
  *  manuelle que pour chaque tour de la conversation mains-libres. Le texte entendu s'affiche
  *  en direct dans le champ ; onFinal décide quoi en faire une fois la prise de parole finie. */
 function listenOnce(onFinal:(text:string)=>void){
  const Ctor=getSpeechRecognitionCtor();if(!Ctor)return;
  const r=new Ctor();r.lang='fr-FR';r.continuous=false;r.interimResults=true;
  let transcript='';
  r.onresult=(e)=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;transcript=t;setInput(t);};
  r.onerror=()=>setListening(false);
  r.onend=()=>{setListening(false);onFinal(transcript.trim());};
  recognition.current=r;setListening(true);r.start();
 }
 function toggleListen(){
  if(listening){recognition.current?.stop();return;}
  listenOnce(()=>{/* texte laissé dans le champ, envoi manuel */});
 }
 function conversationTurn(){
  if(!convoActive.current)return;
  listenOnce((text)=>{
   if(!convoActive.current)return;
   if(text)void send(false,text);
   else conversationTurn(); // rien entendu — on retente l'écoute
  });
 }
 function startConversation(){
  if(!canListen||blocked)return;
  convoActive.current=true;setConversationOn(true);
  if(!voiceOn){setVoiceOn(true);try{localStorage.setItem('jjd-companion-voice','1');}catch{/* stockage indisponible — pas bloquant */}}
  conversationTurn();
 }
 function stopConversation(){
  convoActive.current=false;setConversationOn(false);
  try{recognition.current?.stop();}catch{/* déjà arrêté */}
  try{window.speechSynthesis.cancel();}catch{/* pas de synthèse vocale sur ce navigateur */}
  setListening(false);setSpeaking(false);
 }
 async function send(retry=false,overrideText?:string){
  if(sending.current||(!retry&&!overrideText&&!input.trim()))return;sending.current=true;setBusy(true);setError('');
  const text=overrideText??input.trim();
  const messages=retry&&pending.current?pending.current.messages:[...turns,{role:'user' as const,content:text}];
  const payload=retry&&pending.current?pending.current:{requestId:crypto.randomUUID(),messages};pending.current=payload;
  if(!retry){setTurns(messages);setInput('');}
  try{
   const r=await api<{reply:string;quota:LiveQuota}>('/api/assistant/chat',{method:'POST',body:payload});
   setTurns([...messages,{role:'assistant',content:r.reply}]);setQ(r.quota);pending.current=null;
   if(voiceOn||convoActive.current)speak(r.reply,convoActive.current?conversationTurn:undefined);
  }
  catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status!==409)pending.current=null;if(convoActive.current)stopConversation();}
  finally{await api<LiveQuota>('/api/assistant/quota').then(setQ).catch(()=>{});sending.current=false;setBusy(false);}
 }
 const blocked=!q.enabled||q.remainingPercent===0||q.dailyRemaining===0;
 return <div className={`${s.app} ${embedded?s.embedded:''}`}><main className={s.main}>
  <header className={s.header}><div className={s.heading}><CompanionAvatar size={38}/><div><strong>Compagnon JJD</strong><small>Assistant IA · lecture seule</small></div></div><button className={s.pending} disabled={busy} onClick={()=>{setTurns([]);setError('');pending.current=null;}}> <Plus size={14}/> Nouvelle</button></header>
  <button className={s.quotaStrip} aria-expanded={details} onClick={()=>setDetails(!details)}><span className={s.previewTag}>Connecté</span><span>{q.direction?'Direction':`${q.dailyRemaining}/${q.dailyLimit} demandes`} · {q.remainingPercent??'—'} % disponibles</span><span className={s.quotaLink}>Mon quota</span></button>
  <div className={s.thread}>
   {details&&<section className={s.quotaCard}><div className={s.quotaTitle}><strong>Votre utilisation réelle</strong></div><div className={s.quotaMetric}><span>Crédit restant</span><b>{q.remainingPercent??'—'} %</b></div><progress max={100} value={q.remainingPercent??0}/><p>{q.spentEuro.toFixed(4)} € comptabilisés · {q.reservedEuro.toFixed(4)} € réservés<br/>Budget : {q.monthlyLimitEuro??'à définir'} € · renouvellement le {date(q.monthlyResetAt)} (heure belge).</p>{q.direction?<p>Budget direction distinct ; aucune limite de 10 demandes/jour.</p>:<p>{q.dailyRemaining} demandes restantes · renouvellement le {date(q.dailyResetAt)}.</p>}<p>Montants API hors taxes, selon le taux de conversion configuré. Une provision conservée après incident peut être supérieure au coût fournisseur définitif.</p></section>}
   {!turns.length?<section className={s.welcome}><h1>Bonjour,<br/><em>comment puis-je t’aider ?</em></h1><div className={s.starters}>{['Retrouver un chantier','Retrouver un contact','Comprendre les pointages'].map(t=><button key={t} onClick={()=>setInput(t)}><MessageCircle size={18}/><strong>{t}</strong></button>)}</div><p>Consultation uniquement. Aucun devis, tâche ou planning ne sera créé.</p></section>:<div className={s.messages}>{turns.map((t,i)=><div key={i} className={`${s.message} ${t.role==='user'?s.mine:''}`}><div className={s.author}>{t.role==='assistant'&&<CompanionAvatar size={25}/>} {t.role==='user'?'Vous':'Compagnon IA'}</div><div className={s.bubble}>{t.content}</div>{t.role==='assistant'&&<button type="button" className={s.extension} style={{display:'inline-flex',alignItems:'center',gap:4,marginTop:6}} onClick={()=>speak(t.content)}><Volume2 size={12}/> Écouter</button>}</div>)}</div>}
   {busy&&<p role="status">Compagnon consulte les informations autorisées…</p>}<div ref={bottom}/>
  </div><footer className={s.footer}>{error&&<p role="alert" className={s.error}>{error}</p>}{pending.current&&!busy&&<button className={s.extension} onClick={()=>send(true)}>Vérifier la réponse de cette demande</button>}{blocked&&<p className={s.error}>Accès suspendu ou quota atteint. Consulte « Mon quota ».</p>}
   {conversationOn&&<p className={s.privacy} style={{fontWeight:700,color:'#1b4a38',margin:'0 0 8px'}}>{listening?'🎤 Je t’écoute…':speaking?'🔊 Compagnon répond…':busy?'… Compagnon réfléchit':'En conversation — parle quand tu veux'}</p>}
   <div className={s.composer}><textarea aria-label="Votre demande à Compagnon" value={input} onChange={e=>setInput(e.target.value)} maxLength={6000} rows={2} placeholder="Une question sur JJD…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!blocked)void send();}}}/><div className={s.composerBar}><div>{canListen&&<button type="button" disabled={conversationOn} title={listening?'Arrêter la dictée':'Dicter votre message'} aria-pressed={listening} style={listening?{background:'#f3dcd9',color:'#9e443a'}:undefined} onClick={toggleListen}>{listening?<Square size={14}/>:<Mic size={14}/>}{listening?'Écoute…':'Dicter'}</button>}<button type="button" disabled={conversationOn} title={voiceOn?'Désactiver la réponse vocale':'Activer la réponse vocale'} aria-pressed={voiceOn} style={voiceOn?{background:'#e5eddf',color:'#1b4a38'}:undefined} onClick={toggleVoice}>{voiceOn?<Volume2 size={14}/>:<VolumeX size={14}/>}{voiceOn?'Vocal activé':'Vocal'}</button>{canListen&&<button type="button" disabled={blocked&&!conversationOn} title={conversationOn?'Arrêter la conversation':'Démarrer une conversation mains-libres'} aria-pressed={conversationOn} style={conversationOn?{background:'#f3dcd9',color:'#9e443a'}:{background:'#1b4a38',color:'#fff'}} onClick={()=>conversationOn?stopConversation():startConversation()}>{conversationOn?<PhoneOff size={14}/>:<Phone size={14}/>}{conversationOn?'Arrêter':'Conversation'}</button>}</div><button className={s.send} disabled={busy||blocked||!input.trim()} aria-label="Envoyer à Compagnon" onClick={()=>send()}><ArrowUp size={20}/></button></div></div><p className={s.privacy}>Réponse générée par IA · vérifiez les informations importantes</p></footer>
 </main></div>;
}
