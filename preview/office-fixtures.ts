/** Local-only adapters for the existing office screens. Never used by Next/API builds. */
export function officeFixtures(p:string,method:string,b:any,u:URL,state:any,db:any,people:any[],save:()=>void):any {
 const parts=p.split('/'),uid=()=>crypto.randomUUID();
 const requireItem=(v:any)=>{if(!v)throw Error('Élément introuvable.');return v};
 if(p.startsWith('/api/people')) {
  state.peopleEdits??={};state.extraPeople??=[];
  const all=()=>[...people,...state.extraPeople].map(x=>({lastName:null,contractType:'subcontractor',hourlyRate:25,dailyHours:8,legalDocs:[],equipment:[],adjustments:[],languages:['fr'],_count:{legalDocs:0,timeEntries:0},...x,...state.peopleEdits[x.id]}));
  if(p==='/api/people'){
   if(method==='POST'){const person={...b,id:uid(),displayName:[b.firstName,b.lastName].filter(Boolean).join(' '),active:true};state.extraPeople.push(person);save();return {person};}
   return {items:all().filter(x=>(!u.searchParams.get('q')||JSON.stringify(x).toLowerCase().includes(u.searchParams.get('q')!.toLowerCase()))&&(!u.searchParams.get('role')||x.role===u.searchParams.get('role'))&&(!u.searchParams.get('active')||x.active===(u.searchParams.get('active')==='1')))};
  }
  const person=requireItem(all().find(x=>x.id===parts[3]));
  if(parts[4]==='stats')return {months:[]};
  if(parts[4]==='earnings')return {total:{hours:0,amount:0,years:0,worksites:0},byYear:[],byWorksite:[]};
  if(parts.length>4)throw Error('Les comptes et documents personnels réels ne sont pas modifiables dans cet aperçu.');
  if(method==='PATCH'){state.peopleEdits[person.id]={...state.peopleEdits[person.id],...b};Object.assign(person,b);save();}
  else if(method!=='GET')throw Error('Action non disponible dans cet aperçu.');
  return {person,monthStatement:{hours:0,amount:0,worksites:0,guaranteeApplied:false,dailyHours:8},adjustmentBalance:0};
 }
 if(p.startsWith('/api/imports/issues')) {
  state.issues??=[{id:'issue1',entity:'contact',sheet:'Contacts de démonstration',rowRef:'12',severity:'warning',message:'Vérifier les coordonnées de facturation.',resolved:false,link:{label:'Ouvrir les contacts',href:'/app/contacts'}},{id:'issue2',entity:'worksite',sheet:'Projets de démonstration',rowRef:'7',severity:'info',message:'Confirmer la prochaine visite de contrôle après séchage.',resolved:false,link:{label:'Ouvrir le chantier',href:'/app/chantiers/w3'}}];
  if(method==='PATCH'){Object.assign(requireItem(state.issues.find((x:any)=>x.id===parts[4])),{resolved:!!b.resolved});save();return {ok:true};}
  return {items:state.issues.filter((x:any)=>x.resolved===(u.searchParams.get('resolved')==='1')&&(!u.searchParams.get('entity')||x.entity===u.searchParams.get('entity'))&&(!u.searchParams.get('severity')||x.severity===u.searchParams.get('severity'))),openBySeverity:Object.fromEntries(['error','warning','info'].map(severity=>[severity,state.issues.filter((x:any)=>!x.resolved&&x.severity===severity).length]))};
 }
 if(p==='/api/finance/analytics'){
  const months=Number(u.searchParams.get('months')||12),entity=u.searchParams.get('entity');
  const monthly=Array.from({length:months},(_,i)=>{const d=new Date(Date.UTC(2026,9-months+i,1));const revenue=entity==='tonton'?18000+i*500:62000+i*1800,expenses=revenue*.54,labourCost=revenue*.23;return {month:d.toISOString().slice(0,7),revenue,expenses,result:revenue-expenses-labourCost,collected:revenue*.85,hours:640+i*8,labourCost};});
  const totals:any={revenue:0,expenses:0,result:0,collected:0,hours:0,marginPct:23};for(const m of monthly)for(const key of ['revenue','expenses','result','collected','hours'])totals[key]+=(m as any)[key];
  return {range:{months,from:monthly[0]!.month+'-01'},entity,monthly,totals,prev:{...totals,revenue:totals.revenue*.9,result:totals.result*.9},expenseSections:[{key:'materials',label:'Achats',total:totals.expenses},{key:'labour',label:'Main-d’œuvre',total:monthly.reduce((n,m)=>n+m.labourCost,0)}],topWorksites:[],topClients:[],quotes:{sent:12,accepted:7,declined:2,pending:3,pipelineHt:48000,acceptRate:58.3}};
 }
 if(p==='/api/push/mentionable')return {items:people.map(x=>({id:x.id,name:x.displayName,email:null}))};
 if(p==='/api/push/public-key')return {configured:false,publicKey:null};
 if(p.startsWith('/api/messagerie/')){
  state.readThreads??={};state.threads??={};
  const general='general-internal';state.threads[general]??=[{id:'hello-general',kind:'text',body:'Bonjour à tous. Les affectations et véhicules sont disponibles dans le planning.',authorName:'Melvina',authorId:'office-demo',createdAt:'2026-09-30T06:30:00Z',fileUrl:null,thumbUrl:null}];
  if(p==='/api/messagerie/read'){state.readThreads[b.threadId]=true;save();return {ok:true};}
  if(p==='/api/messagerie/unread-count')return {internal:state.readThreads[general]?0:1,client:0};
  if(p==='/api/messagerie/threads'){
   const client=u.searchParams.get('audience')==='client';const archived=u.searchParams.get('archived')==='1';
   const rows=db.worksites.filter((w:any)=>archived?['done','closed','cancelled'].includes(w.status):!['done','closed','cancelled'].includes(w.status)).map((w:any)=>{const id=w.id+(client?'-client':'-internal');const msgs=state.threads[id]||[];return {id,kind:'worksite',title:w.title,sub:w.building?.name||w.city,worksiteId:w.id,ref:w.ref,lastMessage:msgs.at(-1)?.body||'Ouvrir la conversation',lastAt:msgs.at(-1)?.createdAt||null,unread:0,pinned:false};});
   if(!client&&!archived)rows.unshift({id:general,kind:'general',title:'Général JJD',sub:'Toute l’équipe',worksiteId:null,ref:null,lastMessage:state.threads[general].at(-1)?.body,lastAt:state.threads[general].at(-1)?.createdAt,unread:state.readThreads[general]?0:1,pinned:true});
   return {items:rows};
  }
  if(p==='/api/messagerie/general/messages'&&method==='POST'){if(!b.body?.trim())throw Error('Message vide');state.threads[general].push({id:uid(),kind:'text',body:b.body,authorName:'David',authorId:'demo',createdAt:new Date().toISOString()});save();return {ok:true};}
  if(p==='/api/messagerie/general')return {thread:{id:general},messages:state.threads[general]};
  throw Error('Cette fonctionnalité nécessite le service de messagerie réel.');
 }
 return undefined;
}
