export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export const setToken=()=>{};
const key='jjd-isolated-preview-v3';
const names=['José','Miguel','Paulo','Rui','André','Tiago','Lucas','Manuel','Bruno','Pedro','Antoine','Marc','Hugo','Arthur','Noah','Louis','Adam','Tom','Enzo','Léo','Gabriel','Oscar','Victor','Nicolas','Maxime','Alex','Samuel','Daniel','David','Julien'];
export const people=names.map((name,i)=>({id:'p'+i,displayName:name,firstName:name,role:i===29?'foreman':'worker',specialties:[['Peinture','Plomberie','Rénovation'][i%3]],active:true,phone:null}));
export const vehicles=Array.from({length:6},(_,i)=>({id:'v'+i,code:'V'+(i+1),plate:'DEMO-'+(i+1),brand:i%2?'Ford':'Renault',model:i%2?'Transit':'Trafic',seats:i===0?3:6,status:'active',excludedFromPlanning:false}));
export const equipment=[{id:'eq1',name:'Déboucheur électrique'},{id:'eq2',name:'Échafaudage roulant'},{id:'eq3',name:'Airless peinture'}];
const monday=new Date();monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
const iso=(n:number,h:number)=>{const d=new Date(monday);d.setDate(d.getDate()+n);d.setHours(h);return d.toISOString()};
const demoPhotos=['/demo/jjd/residence-brick.png','/demo/jjd/villa.png','/demo/jjd/residence-modern.png','/demo/jjd/residence-brick.png'];
const defaults={worksites:[['Résidence des Tilleuls','Uccle','Syndic Exemple','intervention'],['Villa des Pins','Rhode-Saint-Genèse','Famille Exemple','long_term'],['Projet Les Jardins · lot 12','Waterloo','Promoteur Exemple','long_term'],['Immeuble Horizon · suite fuite','Bruxelles','ACP Exemple','intervention']].map((a,i)=>({id:'w'+i,ref:'DEMO-'+(101+i),title:a[0],city:a[1],client:{id:'c'+i,name:a[2]},building:{id:'b'+i,name:a[0],photoThumbUrl:demoPhotos[i]},status:i===3?'on_hold':'in_progress',priority:i===0?'urgent':i===2?'high':'normal',entity:'jjd',scope:a[3],billingMode:i===0?'regie':i===2?'contrat':'devis',quotedHt:18000*(i+1),invoicedHt:5000*i,endedOn:null,manager:{firstName:'Julien',displayName:i===1?'Pascal':'Julien'},address:'Adresse fictive',postalCode:'1000'})),events:[] as any[],absences:[] as any[]};
let db:any;
try{db=JSON.parse(localStorage.getItem(key)||'null')}catch{}
if(!db){db=defaults;for(let d=0;d<5;d++)for(let w=0;w<3;w++) db.events.push(hydrate({id:`e${d}-${w}`,worksiteId:'w'+w,title:['Diagnostic fuite et remise en état','Préparation des murs','Finitions du lot 12'][w],startAt:iso(d,w===0?8:7),endAt:iso(d,w===0?12:17),personIds:[w*4,w*4+1,w*4+2,w*4+3].map(n=>'p'+n),vehicles:[{vehicleId:'v'+w,driverPersonId:d===2&&w===1?null:'p'+w*4}],equipmentIds:[equipment[w].id],kind:'intervention',status:d===4?'tentative':'confirmed',tasksNote:'Protéger les lieux\nRéaliser les travaux prévus\nAjouter les photos de fin de journée',departureFrom:'Dépôt',departureAt:iso(d,6),accessNote:'Contacter la personne sur place avant l’arrivée.'}));}
function save(){localStorage.setItem(key,JSON.stringify(db))}
function hydrate(b:any,old:any={}){const x={allDay:false,team:null,consumables:[],leadPerson:null,driverPerson:null,meetingOnSite:true,meetingAddress:null,meetingBox:null,meetingPostalCode:null,meetingCity:null,note:null,materialsNote:null,...old,...b};return {...x,worksite:b.worksiteId?db.worksites.find((w:any)=>w.id===b.worksiteId):old.worksite,assignments:b.personIds?b.personIds.map((id:string)=>({person:people.find(p=>p.id===id)})):old.assignments||[],vehicles:b.vehicles?b.vehicles.map((v:any)=>v.vehicle?v:{vehicle:vehicles.find(x=>x.id===v.vehicleId),driver:people.find(p=>p.id===v.driverPersonId)||null}):old.vehicles||[],equipment:b.equipmentIds?b.equipmentIds.map((id:string)=>({equipment:equipment.find(e=>e.id===id)})):old.equipment||[]};}
export function reset(){localStorage.removeItem(key);location.reload()}
export function getWorksite(id:string){return db.worksites.find((w:any)=>w.id===id)}
export function getEvents(id:string){return db.events.filter((e:any)=>e.worksite.id===id)}
export async function api<T=unknown>(path:string,opts:any={}):Promise<T>{
 const url=new URL(path,'https://demo.invalid'),p=url.pathname,b=opts.body,method=opts.method||'GET';let result:any;
 if(p==='/api/assistant/status')result={enabled:false};
 else if(p==='/api/messagerie/unread-count')result={internal:3,client:1};
 else if(p==='/api/dashboard')result={
  kpis:{invoicedMonth:128400,invoicedPrevMonth:104800,paidMonth:86250,overdueAmount:18450,overdueCount:4,supplierOverdueAmount:7280,supplierOverdueCount:3,openWorksites:db.worksites.length,teamsOnSiteToday:3,receivableAmount:42150,quotesPendingAmount:96500,quotesPendingCount:7},
  alerts:[
   {kind:'overdue_invoices',severity:'critical',label:'Factures clients à relancer',count:4,amount:18450,href:'/app/documents'},
   {kind:'to_invoice',severity:'warning',label:'Travaux réalisés à facturer',count:6,amount:32700,href:'/app/chantiers?statut=to_invoice'},
   {kind:'quotes_follow',severity:'info',label:'Devis sans réponse depuis 7 jours',count:3,amount:46500,href:'/app/documents'},
  ],
  inProgress:db.worksites.filter((w:any)=>w.status==='in_progress').map((w:any)=>({id:w.id,ref:w.ref,title:w.title,city:w.city,status:w.status,client:w.client?.name,manager:w.manager?.displayName,photoThumbUrl:w.building?.photoThumbUrl??null})),
  expiringDocs:[{id:'legal-1',person:'Miguel Santos',type:'work_permit',label:'Permis de travail',expiresOn:new Date(Date.now()+18*86400000).toISOString()}],
  fieldToday:db.events.slice(0,3).map((e:any,i:number)=>({id:e.id,startAt:e.startAt,endAt:e.endAt,allDay:false,tentative:i===2,worksite:{id:e.worksite.id,ref:e.worksite.ref,title:e.worksite.title,city:e.worksite.city},team:['Équipe Julien','Équipe Pascal','Renfort finition'][i],people:e.assignments.map((a:any,j:number)=>({id:a.person.id,name:a.person.displayName,state:j===0?'running':j<3?'done':'none'}))})),
 };
 else if(p==='/api/finance/analytics')result={monthly:[['2026-04',74000],['2026-05',89500],['2026-06',97200],['2026-07',108400],['2026-08',104800],['2026-09',128400]].map(([month,invoiced])=>({month,invoiced}))};
 else if(p==='/api/documents'&&method==='POST')result={document:{id:'demo-devis'}};
 else if(p==='/api/people')result={items:people};
 else if(p==='/api/vehicles')result={items:vehicles};
 else if(p==='/api/equipment')result={items:equipment};
 else if(p==='/api/meta/pickers')result={clients:db.worksites.map((w:any)=>w.client),buildings:[],people:people.map(p=>({id:p.id,name:p.displayName}))};
 else if(p==='/api/geocode/search')result={items:[]};
 else if(p==='/api/worksites/counts')result={total:db.worksites.length,byStatus:db.worksites.reduce((a:any,w:any)=>(a[w.status]=(a[w.status]||0)+1,a),{})};
 else if(p==='/api/worksites'&&method==='GET'){let items=db.worksites.filter((w:any)=>(!url.searchParams.get('q')||JSON.stringify(w).toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()))&&(!url.searchParams.get('status')||url.searchParams.get('status')!.split(',').includes(w.status)));result={items,totalCount:items.length,page:1,pageSize:100,totalPages:1};}
 else if(p==='/api/worksites'&&method==='POST'){result={...defaults.worksites[0],...b,id:crypto.randomUUID(),ref:'DEMO-'+(db.worksites.length+101),client:db.worksites.map((w:any)=>w.client).find((c:any)=>c.id===b.clientId)||null};db.worksites.push(result);save();}
 else if(p.startsWith('/api/worksites/')&&method==='PATCH'){result=db.worksites.find((w:any)=>w.id===p.split('/').pop());Object.assign(result,b);save();}
 else if(p==='/api/planning'&&method==='GET')result={items:db.events.filter((e:any)=>(!url.searchParams.get('from')||e.endAt>url.searchParams.get('from')!)&&(!url.searchParams.get('to')||e.startAt<url.searchParams.get('to')!)),googleSync:false};
 else if(p==='/api/planning'&&method==='POST'){result=hydrate({...b,id:crypto.randomUUID()});db.events.push(result);save();}
 else if(p.startsWith('/api/planning/')&&method==='PATCH'){const i=db.events.findIndex((e:any)=>e.id===p.split('/').pop());result=hydrate(b,db.events[i]);db.events[i]=result;save();}
 else if(p.startsWith('/api/planning/')&&method==='DELETE'){db.events=db.events.filter((e:any)=>e.id!==p.split('/').pop());save();result={ok:true};}
 else if(p==='/api/absences'&&method==='GET')result={items:db.absences};
 else if(p.startsWith('/api/absences/')&&method==='PATCH'){result=db.absences.find((a:any)=>a.id===p.split('/').pop());Object.assign(result,b,{person:people.find(p=>p.id===b.personId)});save();}
 else if(p.startsWith('/api/absences/')&&method==='DELETE'){db.absences=db.absences.filter((a:any)=>a.id!==p.split('/').pop());save();result={ok:true};}
 else if(p==='/api/absences'&&method==='POST'){result={...b,id:crypto.randomUUID(),person:people.find(p=>p.id===b.personId)};db.absences.push(result);save();}
 else throw new ApiError(400,'Cette action ne fait pas partie de ce premier aperçu. Aucun service réel n’a été contacté.');
 return result as T;
}
export async function apiBlobUrl():Promise<string>{throw new Error('Export non disponible dans cet aperçu')}
export async function apiUpload<T>():Promise<T>{throw new Error('Import non disponible dans cet aperçu')}
