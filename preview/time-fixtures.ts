/** Fictitious hours only. Production calculations and payroll rules stay in the API. */
export function ensureTimeEntries(state:any,db:any,people:any[],save:()=>void){
 if(state.timeEntries)return;
 state.timeEntries=db.worksites.flatMap((w:any)=>Array.from({length:w.demoNew?0:12},(_,n)=>({id:`time-${w.id}-${n}`,worksiteId:w.id,personId:people[n%3].id,date:`2026-09-${21+Math.floor(n/3)}T12:00:00`,hours:8,amount:400,rateUsed:50,status:n>8?'submitted':'approved',task:'Travaux de démonstration',note:null,geoFlag:n===11,geoDistance:n===11?650:null,startLat:null,startLng:null})));
 save();
}
export function timeFixtures(p:string,method:string,b:any,u:URL,state:any,db:any,people:any[],save:()=>void):any{
 if(!p.startsWith('/api/timesheet/')&&!p.startsWith('/api/statements'))return undefined;
 ensureTimeEntries(state,db,people,save);
 const person=(id:string)=>{const v=[...people,...(state.extraPeople||[])].find(x=>x.id===id);if(!v)throw Error('Ouvrier introuvable.');return {...v,...state.peopleEdits?.[id]}};
 const hydrate=(e:any)=>({...e,person:person(e.personId),worksite:db.worksites.find((w:any)=>w.id===e.worksiteId)||null});
 const validate=(input:any)=>{
  if(input.hours!=null&&(!Number.isFinite(Number(input.hours))||Number(input.hours)<=0||Number(input.hours)>24))throw Error('Indiquez entre 0 et 24 heures.');
  if(input.date&&!Number.isFinite(new Date(input.date).getTime()))throw Error('Date invalide.');
  if(input.worksiteId&&!db.worksites.some((w:any)=>w.id===input.worksiteId))throw Error('Chantier introuvable.');
 };
 if(p==='/api/timesheet/pending')return {items:state.timeEntries.filter((e:any)=>e.status==='submitted').map(hydrate)};
 if(p==='/api/timesheet/entries'&&method==='POST'){
  validate(b);const worker=person(b.personId),rate=worker.hourlyRate??25;
  const entry={...b,id:crypto.randomUUID(),worksiteId:b.worksiteId||null,hours:Number(b.hours),amount:b.amount??Math.round(Number(b.hours)*rate*100)/100,rateUsed:rate,status:'submitted',geoFlag:false,geoDistance:null,startLat:null,startLng:null};
  state.timeEntries.push(entry);save();return {entry:hydrate(entry)};
 }
 if(p==='/api/timesheet/entries/approve-all'&&method==='POST'){
  const rows=state.timeEntries.filter((e:any)=>e.status==='submitted'&&!e.geoFlag);
  rows.forEach((e:any)=>e.status='approved');save();return {approved:rows.length};
 }
 if(p.startsWith('/api/timesheet/entries/')){
  const parts=p.split('/'),entry=state.timeEntries.find((e:any)=>e.id===parts[4]);
  if(!entry)throw Error('Pointage introuvable.');
  if(method==='POST'&&['approve','reject'].includes(parts[5]))entry.status=parts[5]==='approve'?'approved':'rejected';
  else if(method==='PATCH'){validate(b);Object.assign(entry,b);}
  else if(method==='DELETE')state.timeEntries=state.timeEntries.filter((e:any)=>e.id!==entry.id);
  else if(method!=='GET')throw Error('Action indisponible dans cet aperçu.');
  save();return {entry:hydrate(entry)};
 }
 if(p.startsWith('/api/statements')){
  const now=new Date(),year=Number(u.searchParams.get('year')||now.getFullYear()),month=Number(u.searchParams.get('month')||now.getMonth()+1);
  const period=state.timeEntries.filter((e:any)=>{const d=new Date(e.date);return d.getFullYear()===year&&d.getMonth()+1===month&&e.status!=='rejected'});
  const total=(rows:any[],key:string)=>rows.reduce((s:number,e:any)=>s+Number(e[key]||0),0);
  const id=p.split('/')[3];
  if(id){
   const entries=period.filter((e:any)=>e.personId===id).map((e:any)=>{const w=db.worksites.find((w:any)=>w.id===e.worksiteId);return {...e,worksiteRef:w?.ref||null,worksiteTitle:w?.title||null}});
   const approved=entries.filter((e:any)=>e.status==='approved');
   return {totalHours:total(approved,'hours'),totalAmount:total(approved,'amount'),entries,byWorksite:[...new Set(approved.map((e:any)=>e.worksiteId))].map(wid=>{const rows=approved.filter((e:any)=>e.worksiteId===wid),w=db.worksites.find((w:any)=>w.id===wid);return {ref:w?.ref||'Sans chantier',title:w?.title||'',hours:total(rows,'hours'),amount:total(rows,'amount'),days:total(rows,'hours')/8}})};
  }
  const rows=[...new Set(period.map((e:any)=>e.personId))].map(id=>{const worker=person(String(id)),all=period.filter((e:any)=>e.personId===id),approved=all.filter((e:any)=>e.status==='approved'),amount=total(approved,'amount'),hours=total(approved,'hours');return {personId:id,name:worker.displayName||worker.firstName,photoThumbUrl:null,contractType:'subcontractor',hourlyRate:worker.hourlyRate??25,dailyHours:8,payoutPerDay:null,hours,days:hours/8,amount,payoutAmount:amount,toWithhold:0,netAmount:amount,pending:all.filter((e:any)=>e.status==='submitted').length}});
  return {year,month,rows,totalAmount:total(rows,'amount'),totalPayoutAmount:total(rows,'payoutAmount'),totalNetAmount:total(rows,'netAmount')};
 }
 throw Error('Ce parcours terrain n’est pas encore connecté dans la démonstration.');
}
