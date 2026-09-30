/** Device-local task simulation shared by global and worksite views. */
export function taskFixtures(p:string,method:string,b:any,u:URL,state:any,db:any,people:any[],save:()=>void):any {
 const match=p.match(/^\/api\/worksites\/([^/]+)\/tasks$/);
 if(!match&&p!=='/api/tasks'&&!p.startsWith('/api/tasks/'))return undefined;
 state.tasks??={};
 const today=new Date();today.setHours(12,0,0,0);
 const date=(days:number)=>{const d=new Date(today);d.setDate(d.getDate()+days);return d.toISOString()};
 if(!state.taskExamplesV1){
  for(const [i,w] of db.worksites.slice(0,3).entries()){
   state.tasks[w.id]??=[];
   state.tasks[w.id].push({id:'task-demo-'+w.id,title:['Confirmer le prochain passage','Préparer les matériaux','Contrôler les finitions'][i],description:'Exemple modifiable, sans notification réelle.',priority:i===0?'high':'normal',status:'todo',dueOn:date(i-1),phaseId:null,assignees:people.slice(i,i+1).map(x=>({id:x.id,name:x.displayName})),checklist:[{label:'Vérifier les informations du dossier',done:false},{label:'Ajouter les photos utiles',done:false}],doneAt:null,doneByName:null});
  }
  state.taskExamplesV1=true;save();
 }
 const rows=()=>Object.entries(state.tasks).flatMap(([worksiteId,list]:[string,any])=>list.map((t:any)=>({...t,worksiteId:worksiteId||null,worksite:db.worksites.find((w:any)=>w.id===worksiteId)||null})));
 const assignees=(ids:string[])=>ids.map(id=>({id,name:people.find(x=>x.id===id)?.displayName||id}));
 if(method==='POST'&&(match||p==='/api/tasks')){
  if(!b.title?.trim())throw Error('Indiquez ce qu’il faut faire.');
  const key=match?.[1]||b.worksiteId||'';
  if(key&&!db.worksites.some((w:any)=>w.id===key))throw Error('Chantier introuvable.');
  const task={status:'todo',priority:'normal',description:null,dueOn:null,checklist:[],phaseId:null,doneAt:null,doneByName:null,...b,id:crypto.randomUUID(),assignees:assignees(b.assigneeIds||[])};
  state.tasks[key]??=[];state.tasks[key].push(task);save();return {task};
 }
 if(p.startsWith('/api/tasks/')){
  const id=p.split('/')[3],old=rows().find((t:any)=>t.id===id);
  if(!old)throw Error('Tâche introuvable.');
  const oldKey=old.worksiteId||'';
  if(method==='DELETE'){state.tasks[oldKey]=state.tasks[oldKey].filter((t:any)=>t.id!==id);save();return {ok:true};}
  if(method==='PATCH'){
   const key=b.worksiteId===undefined?oldKey:(b.worksiteId||'');
   if(key&&!db.worksites.some((w:any)=>w.id===key))throw Error('Chantier introuvable.');
   const task={...old,...b,assignees:b.assigneeIds?assignees(b.assigneeIds):old.assignees};
   if(b.status!==undefined){task.doneAt=b.status==='done'?new Date().toISOString():null;task.doneByName=b.status==='done'?'David (démo)':null;}
   state.tasks[oldKey]=state.tasks[oldKey].filter((t:any)=>t.id!==id);state.tasks[key]??=[];state.tasks[key].push(task);save();return {task};
  }
  return {task:old};
 }
 let items=rows();const key=match?.[1]||u.searchParams.get('worksiteId');
 if(key)items=items.filter((t:any)=>t.worksiteId===key);
 // The administration demo has no linked worker, as in preview/auth.tsx.
 if(u.searchParams.get('mine')==='1')items=[];
 const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+(u.searchParams.get('view')==='week'?7:1));
 const view=u.searchParams.get('view');
 if(view==='overdue')items=items.filter((t:any)=>t.dueOn&&new Date(t.dueOn)<start&&t.status!=='done');
 if(view==='today'||view==='week')items=items.filter((t:any)=>t.dueOn&&new Date(t.dueOn)>=start&&new Date(t.dueOn)<end);
 return {items};
}
