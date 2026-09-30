'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {CompanionAvatar} from './CompanionAvatar';
import { ArrowUp, Plus, Video, Paperclip, MessageCircle, FileText, CalendarDays, ShieldCheck, ChevronLeft, X, Sparkles, Check, Menu } from 'lucide-react';
import { useRequireAuth } from '@/lib/auth';
import s from '@/app/app-compagnon/companion.module.css';

type Profile = 'Julien' | 'David' | 'Melvina' | 'Ouvrier' | 'Chef' | 'Magasinier';
type Kind = 'devis' | 'intervention' | 'planning';
type Proposal = { kind: Kind; title: string; detail: string; accepted: boolean; requestedBy: Profile };
type Message = { id: string; role: 'user' | 'assistant'; text: string; time: string; files?: string[]; proposal?: Proposal };
type Chat = { id: string; title: string; messages: Message[] };
const time = () => new Date().toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
const uid = () => crypto.randomUUID();
const suggestions:Record<Profile,{title:string;sub:string;prompt:string}[]>={
 Julien:[{title:'Une visite → un devis',sub:'Vidéo, photos et explications du chantier',prompt:'Prépare un brouillon de devis à partir de ma visite.'},{title:'Les points à contrôler',sub:'Préparer le contrôle qualité',prompt:'Quels points vérifier avant la réception ?'},{title:'Relire avant validation',sub:'Prix, précisions et éléments manquants',prompt:'Quels éléments vérifier avant de valider ce devis ?'}],
 David:[{title:'Comprendre la rentabilité',sub:'Heures, achats et montant vendu',prompt:'Explique comment lire la rentabilité de ce chantier.'},{title:'Les priorités financières',sub:'Impayés et travaux à facturer',prompt:'Quels indicateurs financiers consulter en priorité ?'},{title:'Préparer une intervention',sub:'Une proposition à relire ensemble',prompt:'Prépare une fiche intervention pour une fuite.'}],
 Melvina:[{title:'Vérifier une demande',sub:'Repérer les informations manquantes',prompt:'Quelles informations vérifier dans une demande d’intervention ?'},{title:'Préparer le contrôle planning',sub:'Ouvriers, permis et places disponibles',prompt:'Que vérifier avant de soumettre le planning à Julien ?'},{title:'Comprendre un dossier',sub:'Une aide à la lecture, sans création',prompt:'Comment vérifier qu’un dossier est complet ?'}],
 Ouvrier:[{title:'Les consignes du chantier',sub:'Retrouver où consulter les informations',prompt:'Où retrouver les consignes et les contacts du chantier ?'},{title:'Photos de fin de journée',sub:'Quelles photos transmettre à l’équipe ?',prompt:'Quelles photos faut-il envoyer avant de partir ?'},{title:'Comment pointer ?',sub:'Arrivée et départ sur le chantier',prompt:'Comment pointer mes heures sur chantier ?'}],
 Chef:[{title:'Vérifier l’équipe',sub:'Affectations, accès et matériel',prompt:'Que vérifier avant le départ de l’équipe ?'},{title:'Contrôle qualité',sub:'Les points à vérifier sur place',prompt:'Quels points vérifier avant la réception ?'},{title:'Consignes et photos',sub:'Préparer un suivi clair pour le bureau',prompt:'Quelles informations transmettre au bureau en fin de journée ?'}],
 Magasinier:[{title:'Préparer les départs',sub:'Commandes, outils et consommables',prompt:'Que vérifier avant de remettre une préparation ?'},{title:'Réception fournisseur',sub:'Quantités et documents à contrôler',prompt:'Que vérifier à la réception d’une commande fournisseur ?'},{title:'Retour au dépôt',sub:'État des outils et quantités restantes',prompt:'Que vérifier lors du retour du matériel ?'}]
};
export default function CompanionPreview({embedded=false}:{embedded?:boolean}){
 const {user,loading}=useRequireAuth();
 const pathname=usePathname();
 const [profile,setProfile]=useState<Profile>('Julien');
 const [chats,setChats]=useState<Chat[]>([{id:'welcome',title:'Nouvelle conversation',messages:[]}]);
 const [active,setActive]=useState('welcome'); const [input,setInput]=useState('');
 const [attachments,setAttachments]=useState<File[]>([]); const [sidebar,setSidebar]=useState(false);
 const [screen,setScreen]=useState<'chat'|'proposals'>('chat'); const [error,setError]=useState('');
 const [editing,setEditing]=useState<{chat:string;message:string;title:string;detail:string}|null>(null);
 const fileRef=useRef<HTMLInputElement>(null);const videoRef=useRef<HTMLInputElement>(null);const bottom=useRef<HTMLDivElement>(null);const inputRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(user)setProfile(user.role==='admin'?'David':user.role==='office'?'Melvina':user.role==='worker'?'Ouvrier':user.role==='storekeeper'?'Magasinier':'Chef');},[user]);
 const contextual=pathname.includes('/planning')?{title:'Vérifier cette journée',sub:'Équipes, permis et places dans les véhicules',prompt:'Que vérifier avant de soumettre le planning à Julien ?'}:pathname.includes('/stock')?{title:'Comprendre le stock',sub:'Préparations, réceptions et retours',prompt:'Que vérifier lors du retour du matériel ?'}:pathname.includes('/chantiers/')?{title:'Faire le point sur ce chantier',sub:'Consignes, accès et informations manquantes',prompt:'Quelles informations vérifier dans le dossier du chantier ?'}:null;
 const visibleSuggestions=contextual?[contextual,...suggestions[profile].slice(0,2)]:suggestions[profile];
 const current=chats.find(c=>c.id===active)!;
 const pending=chats.flatMap(c=>c.messages.filter(m=>m.proposal&&!m.proposal.accepted).map(m=>({chat:c,message:m})));
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[active,current.messages.length,screen]);
 useEffect(()=>{function esc(e:KeyboardEvent){if(e.key==='Escape'){setSidebar(false);setEditing(null);}}window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[]);
 function newChat(){const id=uid();setChats(c=>[{id,title:'Nouvelle conversation',messages:[]},...c]);setActive(id);setInput('');setAttachments([]);setSidebar(false);setScreen('chat');}
 function chooseFiles(list:FileList|null){if(!list)return;const files=Array.from(list);if(files.some(f=>f.size>100*1024*1024)){setError('Choisis des fichiers de moins de 100 Mo pour cet aperçu.');return;}setError('');setAttachments(a=>[...a,...files].slice(0,5));}
 function send(){
  if(!input.trim()&&!attachments.length)return;
  const text=input.trim()||'Voici ma vidéo de visite.';
  const kind:Kind=attachments.some(f=>f.type.startsWith('video/'))||/devis|prix|chiffr|offre/i.test(text)?'devis':/rendez|planning|demain|créneau/i.test(text)?'planning':'intervention';
  const creating=/prépare un|crée|créer|génère|générer|rédige|rédiger|brouillon|organise|planifie|ajoute/i.test(text)||attachments.some(f=>f.type.startsWith('video/'));
  const denied=creating&&(profile==='Melvina'||(!['Julien','David'].includes(profile)&&kind==='devis'));
  const proposal:Proposal={kind,title:kind==='devis'?'Remise en état après une fuite':kind==='planning'?'Visite technique — créneau à confirmer':'Recherche de fuite — intervention',detail:kind==='devis'?'Exemple fictif à adapter :\n• Protéger la zone d’intervention.\n• Reprendre le support après séchage.\n• Préparer et peindre les surfaces concernées.\n\nÀ préciser : adresse, surfaces, matériaux et prix. Aucun montant n’est calculé.':kind==='planning'?'À préciser : chantier, interlocuteur, date, durée et participants.\nLes disponibilités réelles ne sont pas consultées dans cet aperçu.':'À préciser : immeuble, logement, contact sur place, accès et degré d’urgence.\nJoindre les photos utiles à l’équipe.',accepted:false,requestedBy:profile};
  const guidance=/pointer|heures sur chantier/i.test(text)?'Chaque ouvrier pointe individuellement à l’arrivée puis au départ du chantier. Les heures effectives restent distinctes des journées rémunérées utilisées dans le décompte.':/photos/i.test(text)?'Transmets les vues d’ensemble, les détails réalisés et les éventuels problèmes dans le fil interne du chantier. Le partage avec le client reste une action distincte.':/planning|permis|départ de l’équipe/i.test(text)?'Vérifie les affectations, les conducteurs, le nombre de places par véhicule, les accès et le matériel. Melvina prépare le planning ; Julien le valide.':/rentabilité|financier/i.test(text)?'Compare le vendu aux coûts de main-d’œuvre, achats et sous-traitance. Distingue les heures sur place des trajets et autres coûts. Cet aperçu ne consulte aucun chiffre réel.':'Vérifie le lieu, les contacts, les accès, la demande précise, les photos, les délais et les validations attendues. Cet aperçu ne lit pas le dossier réel.';
  const reply=!creating?guidance:denied?'Cette création par IA est indisponible pour ce profil. Melvina conserve la création manuelle dans JJD ; Julien et David peuvent demander une génération. Cette restriction est illustrée ici, son contrôle serveur reste à intégrer.':kind==='devis'?'Voici à quoi ressemblera la proposition après une visite. Cet exemple est fictif : les fichiers joints n’ont pas été analysés. Relis les postes et complète les informations avant de simuler la validation.':'Je te présente une fiche à compléter. C’est une proposition de démonstration, sans création ni réservation dans JJD.';
  const messages:Message[]=[{id:uid(),role:'user',text,time:time(),files:attachments.map(f=>f.name)},{id:uid(),role:'assistant',text:reply,time:time(),...(creating&&!denied?{proposal}:{})}];
  setChats(cs=>cs.map(c=>c.id===active?{...c,title:c.messages.length?c.title:text.slice(0,44),messages:[...c.messages,...messages]}:c));setInput('');setAttachments([]);setScreen('chat');
 }
 function accept(chatId:string,messageId:string){setChats(cs=>cs.map(c=>c.id===chatId?{...c,messages:c.messages.map(m=>m.id===messageId&&m.proposal?{...m,proposal:{...m.proposal,accepted:true}}:m)}:c));}
 function card(m:Message,chatId:string){const p=m.proposal;if(!p)return null;const restricted=profile==='Melvina'||(!['Julien','David'].includes(profile)&&p.kind==='devis');return <article className={s.proposal}>
  <div className={s.proposalHead}><span><FileText size={17}/>{p.kind==='devis'?'BROUILLON DE DEVIS':p.kind==='planning'?'RENDEZ-VOUS':'FICHE INTERVENTION'}</span><b>{p.accepted?'Simulation validée':'À relire'}</b></div>
  <h3>{p.title}</h3><p className={s.details}>{p.detail}</p><div className={s.source}><ShieldCheck size={15}/>Exemple fictif · demandeur simulé : {p.requestedBy}</div>
  {restricted?<p className={s.denied}>Création et validation IA indisponibles pour ce profil.</p>:<div className={s.cardActions}><button onClick={()=>{setEditing({chat:chatId,message:m.id,title:p.title,detail:p.detail});}} disabled={p.accepted}>Relire / modifier</button><button className={s.primary} disabled={p.accepted} onClick={()=>accept(chatId,m.id)}>{p.accepted?<><Check size={16}/>Validé dans l’aperçu</>:'Simuler la validation'}</button></div>}
  <small>Aucun document créé dans JJD.</small>
 </article>;}
 if(loading||!user)return <div className="empty">Connexion à JJD…</div>;
 if(!['admin','office','worker','foreman','storekeeper'].includes(user.role))return <div className="empty">Cet aperçu est réservé aux profils internes. <Link href="/app">Retour à JJD</Link></div>;
 return <div className={`${s.app} ${embedded?s.embedded:''}`}>
  {sidebar&&<button className={s.scrim} onClick={()=>setSidebar(false)} aria-label="Fermer les conversations"/>}
  <aside className={`${s.sidebar} ${sidebar?s.open:''}`}>
   <Link href="/app" className={s.brand}><img src="/brand/icon-mono.png" alt=""/><span>JJD <b>Compagnon</b><small>Votre bureau, partout.</small></span></Link>
   <button className={s.newChat} onClick={newChat}><Plus size={18}/>Nouvelle conversation</button>
   <div className={s.sideLabel}>CONVERSATIONS DE CET APERÇU</div>
   <div className={s.chatList}>{chats.map(c=><button key={c.id} className={c.id===active?s.selected:''} onClick={()=>{setActive(c.id);setScreen('chat');setSidebar(false);setInput('');setAttachments([]);}}><MessageCircle size={17}/><span>{c.title}</span></button>)}</div>
   <button className={s.review} onClick={()=>{setScreen('proposals');setSidebar(false);}}><FileText size={18}/>À relire <b>{pending.length}</b></button>
   <div className={s.team}><span className={s.sideLabel}>UNE SEULE CONVERSATION</span><p>Demandes · Devis · Organisation</p><small>Les spécialistes travaillent derrière le chat, vous gardez la décision.</small></div>
   <Link className={s.back} href="/app"><ChevronLeft size={16}/>Retour au logiciel JJD</Link>
  </aside>
  <main className={s.main}>
   <header className={s.header}><button className={s.menu} aria-label="Conversations" onClick={()=>setSidebar(true)}><Menu size={22}/></button><div className={s.heading}><CompanionAvatar size={38}/><div><strong>Compagnon JJD</strong><small>Une demande. Une proposition. Votre validation.</small></div></div><button className={s.pending} onClick={()=>setScreen(screen==='chat'?'proposals':'chat')}>{screen==='chat'?`À relire · ${pending.length}`:'Retour au chat'}</button></header>
   <div className={s.demo}><span><b>Aperçu interactif</b> · données fictives, aucun envoi ni action réelle</span><label>Profil simulé <select value={profile} onChange={e=>{setProfile(e.target.value as Profile);setEditing(null);}}><option>Julien</option><option>David</option><option>Melvina</option><option>Ouvrier</option><option>Chef</option><option>Magasinier</option></select></label></div>
   <div className={s.thread}>
   {screen==='proposals'?<div className={s.proposals}><h1>On relit avant d’agir.</h1><p>Retrouvez les propositions en attente de cet aperçu.</p>{!pending.length?<div className={s.empty}><ShieldCheck size={32}/><h2>Rien en attente</h2><p>Commence une conversation pour préparer une proposition.</p><button onClick={()=>setScreen('chat')}>Ouvrir le chat</button></div>:pending.map(({chat,message})=><div key={message.id}>{card(message,chat.id)}</div>)}</div>:<>
   {!current.messages.length?<section className={s.welcome}><div className={s.welcomeAvatar}><CompanionAvatar size={64}/><span className={s.kicker}>JJD COMPAGNON<br/><small>Votre coup de main au quotidien</small></span></div><h1>Du terrain au bureau,<br/><em>une conversation suffit.</em></h1><p>Bonjour {profile}. De quoi as-tu besoin pour avancer ?</p><div className={s.contextNote}>{pathname.includes('/chantiers/')?'Vous consultez un chantier':pathname.includes('/planning')?'Vous consultez le planning':pathname.includes('/stock')?'Vous consultez le stock':'Un espace adapté à votre quotidien'} · aucune donnée lue dans cet aperçu</div><div className={s.starters}>{visibleSuggestions.map(({title,sub,prompt})=><button key={title} onClick={()=>{setInput(prompt);inputRef.current?.focus();}}><MessageCircle size={22}/><strong>{title}</strong><span>{sub}</span></button>)}</div><div className={s.trust}><ShieldCheck size={16}/>{profile==='Melvina'?'Création par IA désactivée · création manuelle disponible.':!['Julien','David'].includes(profile)?'Génération de devis IA indisponible pour ce profil.':'Tu relis chaque proposition avant toute action.'}</div></section>:<div className={s.messages}>{current.messages.map(m=><div key={m.id} className={`${s.message} ${m.role==='user'?s.mine:''}`}><div className={s.author}>{m.role==='assistant'&&<CompanionAvatar size={25}/>} {m.role==='user'?'Vous':'Compagnon'} <time>{m.time}</time></div><div className={s.bubble}>{m.text}{m.files?.map((name,i)=><div className={s.file} key={i}><Paperclip size={15}/>{name}<small>Local · non envoyé</small></div>)}</div>{card(m,current.id)}</div>)}</div>}
   </>}
   <div ref={bottom}/></div>
   {screen==='chat'&&<footer className={s.footer}>
    {error&&<p role="alert" className={s.error}>{error}</p>}
    <div className={s.composer}>
     {!!attachments.length&&<div className={s.attachments}>{attachments.map((f,i)=><span key={i}><Paperclip size={14}/>{f.name}<button aria-label={`Retirer ${f.name}`} onClick={()=>setAttachments(a=>a.filter((_,n)=>n!==i))}><X size={14}/></button></span>)}</div>}
     <textarea ref={inputRef} aria-label="Votre demande à Compagnon" placeholder="Explique ce qu’il faut faire…" value={input} rows={2} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
     <div className={s.composerBar}><div><button onClick={()=>videoRef.current?.click()}><Video size={18}/>Vidéo</button><button onClick={()=>fileRef.current?.click()}><Paperclip size={18}/>Joindre</button></div><button className={s.send} aria-label="Envoyer dans la démonstration" disabled={!input.trim()&&!attachments.length} onClick={send}><ArrowUp size={20}/></button></div>
     <input ref={videoRef} type="file" accept="video/*" hidden onChange={e=>{chooseFiles(e.target.files);e.target.value='';}}/><input ref={fileRef} type="file" accept="image/*,video/*,.pdf" multiple hidden onChange={e=>{chooseFiles(e.target.files);e.target.value='';}}/>
    </div><p className={s.privacy}>Fichiers conservés uniquement pendant cette session · réponses de démonstration</p>
   </footer>}
  </main>
  {editing&&<div className={s.modalScrim}><form className={s.modal} role="dialog" aria-modal="true" aria-labelledby="proposal-title" onSubmit={e=>{e.preventDefault();setChats(cs=>cs.map(c=>c.id===editing.chat?{...c,messages:c.messages.map(m=>m.id===editing.message&&m.proposal?{...m,proposal:{...m.proposal,title:editing.title,detail:editing.detail}}:m)}:c));setEditing(null);}}><div className={s.modalHead}><h2 id="proposal-title">Relire la proposition</h2><button type="button" aria-label="Fermer" onClick={()=>setEditing(null)}><X size={20}/></button></div><label>Titre<input autoFocus required value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/></label><label>Détail<textarea rows={9} value={editing.detail} onChange={e=>setEditing({...editing,detail:e.target.value})}/></label><p>Modification locale, aucun enregistrement dans JJD.</p><button className={s.primary} type="submit">Conserver dans l’aperçu</button></form></div>}
 </div>;
}
