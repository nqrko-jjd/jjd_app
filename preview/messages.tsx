import React, {useMemo, useState} from 'react';
import {FileText, Image as ImageIcon, Mic, Paperclip, Pin, Search, Send, Users} from 'lucide-react';

const conversations=[
  {id:'general',audience:'internal',title:'Fil général JJD',sub:'Toute l’équipe',last:'Julien : planning validé pour demain',time:'22:14',unread:3,pinned:true,image:'/brand/icon-color.png'},
  {id:'w0',audience:'internal',title:'Résidence des Tilleuls',sub:'DEMO-101 · équipe interne',last:'Miguel a ajouté 6 photos',time:'21:48',unread:2,pinned:false,image:'/demo/jjd/residence-brick.png'},
  {id:'w1',audience:'internal',title:'Villa des Pins',sub:'DEMO-102 · équipe interne',last:'Le matériel est prêt au dépôt',time:'18:32',unread:0,pinned:false,image:'/demo/jjd/villa.png'},
  {id:'client0',audience:'client',title:'Syndic Exemple',sub:'Résidence des Tilleuls · client',last:'Merci, nous validons le rendez-vous.',time:'16:05',unread:1,pinned:false,image:'/demo/jjd/manager.png'},
  {id:'client1',audience:'client',title:'Promoteur Exemple',sub:'Les Jardins · suivi client',last:'Décompte bien reçu.',time:'Hier',unread:0,pinned:false,image:'/demo/jjd/residence-modern.png'},
];

const messages={
  general:[{side:'in',name:'Melvina',time:'21:54',text:'Le planning de demain est prêt. Il reste le conducteur pour la deuxième camionnette.'},{side:'in',name:'Julien',time:'22:02',text:'Je viens de vérifier. Miguel peut conduire V3, garde Paulo et Rui avec lui.',reply:'Le planning de demain est prêt.'},{side:'out',name:'David',time:'22:08',text:'Parfait, je vérifie aussi les achats en attente avant demain.',reaction:'👍 2'},{side:'in',name:'Julien',time:'22:14',text:'Planning validé pour demain.',reaction:'✅ 4'}],
  w0:[{side:'in',name:'Miguel',time:'17:42',text:'La zone est encore humide derrière le plafonnage. Je conseille de laisser sécher avant de refermer.'},{side:'in',name:'Miguel',time:'17:44',photos:['/demo/jjd/residence-brick.png','/demo/jjd/residence-modern.png']},{side:'out',name:'Melvina',time:'17:51',text:'Merci. Je passe le chantier en observation et je programme un contrôle dans trois semaines.',reaction:'👍 1'},{side:'in',name:'Miguel',time:'18:03',voice:'0:24'}],
  w1:[{side:'in',name:'Pascal',time:'16:20',text:'Préparation terminée. Il manque uniquement les protections de sol.'},{side:'out',name:'Joséphine',time:'16:31',file:'Bon de préparation · BP-2026-118.pdf'},{side:'in',name:'Pascal',time:'18:32',text:'Reçu, le matériel est prêt au dépôt.'}],
  client0:[{side:'out',name:'Melvina',time:'15:12',text:'Bonjour, nous proposons une visite de contrôle jeudi entre 9 h et 10 h. Est-ce que l’accès est possible ?'},{side:'in',name:'Claire Dumont',time:'16:05',text:'Bonjour, merci. Le concierge ouvrira le local technique. Le rendez-vous est validé.'}],
  client1:[{side:'out',name:'Joséphine',time:'Hier',text:'Bonjour, vous trouverez le décompte de régie signé pour le lot 12.'},{side:'out',name:'Joséphine',time:'Hier',file:'Décompte régie · DR-2026-044.pdf'},{side:'in',name:'Marc Leroy',time:'Hier',text:'Décompte bien reçu. Je reviens vers vous après contrôle.'}],
} as Record<string,any[]>;

export function MessagingPage(){
  const [audience,setAudience]=useState<'internal'|'client'>('internal');
  const [selected,setSelected]=useState('general');
  const [query,setQuery]=useState('');
  const list=useMemo(()=>conversations.filter(c=>c.audience===audience&&JSON.stringify(c).toLowerCase().includes(query.toLowerCase())),[audience,query]);
  const current=conversations.find(c=>c.id===selected&&c.audience===audience)??list[0];
  const thread=current?messages[current.id]??[]:[];
  function switchAudience(a:'internal'|'client'){setAudience(a);setSelected(a==='internal'?'general':'client0')}
  return <div className="preview-messaging-page">
    <div className="preview-page-title"><div><span className="eyebrow">COMMUNICATION</span><h1>Messagerie JJD</h1><p>Les échanges internes restent séparés des conversations clients, mais toujours reliés au bon chantier.</p></div></div>
    <section className="preview-msg-shell">
      <aside className="preview-msg-list">
        <div className="preview-msg-tabs"><button className={audience==='internal'?'active':''} onClick={()=>switchAudience('internal')}>Interne <span>5</span></button><button className={audience==='client'?'active':''} onClick={()=>switchAudience('client')}>Clients <span>1</span></button></div>
        <label className="preview-msg-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher une conversation"/></label>
        <div className="preview-msg-conversations">{list.map(c=><button key={c.id} className={current?.id===c.id?'active':''} onClick={()=>setSelected(c.id)}><span className="preview-msg-avatar"><img src={c.image} alt=""/></span><span><strong>{c.pinned&&<Pin size={12}/>} {c.title}</strong><small>{c.sub}</small><i>{c.last}</i></span><time>{c.time}</time>{c.unread>0&&<b>{c.unread}</b>}</button>)}</div>
      </aside>
      <div className="preview-msg-thread">
        {current&&<><header><span className="preview-msg-avatar"><img src={current.image} alt=""/></span><div><strong>{current.title}</strong><small>{current.sub}</small></div><a href={current.id.startsWith('w')?`#/app/chantiers/${current.id}`:'#/app/contacts'}>Voir la fiche</a></header>
        <div className="preview-msg-day">Aujourd’hui</div>
        <div className="preview-msg-feed">{thread.map((m,i)=><article key={i} className={m.side==='out'?'out':'in'}>{m.reply&&<div className="preview-msg-reply">{m.reply}</div>}{m.text&&<p>{m.text}</p>}{m.photos&&<div className="preview-msg-photos">{m.photos.map((p:string)=><img src={p} alt="" key={p}/>)}</div>}{m.file&&<div className="preview-msg-file"><FileText size={20}/><span><strong>{m.file}</strong><small>PDF · 824 Ko</small></span></div>}{m.voice&&<div className="preview-msg-voice"><button>▶</button><span><i/><i/><i/><i/><i/><i/><i/><i/></span><b>{m.voice}</b></div>}<footer><span>{m.name}</span><time>{m.time}</time></footer>{m.reaction&&<button className="preview-msg-reaction">{m.reaction}</button>}</article>)}</div>
        <footer className="preview-msg-compose"><button title="Joindre une photo"><ImageIcon size={19}/></button><button title="Joindre un fichier"><Paperclip size={19}/></button><input placeholder={audience==='internal'?'Message à l’équipe…':'Répondre au client…'}/><button title="Message vocal"><Mic size={19}/></button><button className="send" onClick={()=>alert('Maquette : message non envoyé.')}><Send size={18}/></button></footer></>}
      </div>
    </section>
  </div>;
}
