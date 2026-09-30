export function sharedMedia(state:any,id:string){return (state.threads?.[id+'-internal']||[]).filter((m:any)=>m.sharedWithClient&&(m.kind==='photo'||m.kind==='video'));}
export function threadFixtures(p:string,method:string,b:any,state:any,db:any,people:any[],save:()=>void):any{
 const match=p.match(/^\/api\/worksites\/([^/]+)\/thread(?:\/(.*))?$/);if(!match)return undefined;
 const id=match[1],action=match[2]||'',w=db.worksites.find((w:any)=>w.id===id);if(!w)throw Error('Chantier introuvable.');
 state.threads??={};const internal=id+'-internal',client=id+'-client';state.threads[internal]??=[];state.threads[client]??=[];
 state.threadMediaV1??={};
 if(!state.threadMediaV1[id]){
  state.threads[internal].push({id:'photo-demo-'+id,kind:'photo',body:'Photo de démonstration · contrôle du chantier',fileUrl:w.building?.photoThumbUrl||'/demo/jjd/residence-brick.png',thumbUrl:w.building?.photoThumbUrl||'/demo/jjd/residence-brick.png',authorName:'Melvina',authorId:'office-demo',createdAt:'2026-09-30T08:00:00Z',sharedWithClient:false});
  state.threadMediaV1[id]=true;save();
 }
 if(action.match(/^messages\/[^/]+\/share$/)&&method==='PATCH'){
  const msg=state.threads[internal].find((m:any)=>m.id===action.split('/')[1]);if(!msg||!['photo','video'].includes(msg.kind))throw Error('Seules les photos et vidéos de ce chantier peuvent être partagées.');
  msg.sharedWithClient=b.shared===true;save();return {message:msg};
 }
 if(action==='photos'&&method==='POST'){
  if(!/^data:image\/(png|jpeg|webp|gif);base64,/.test(b.photoData||''))throw Error('Image non prise en charge.');
  const message={id:crypto.randomUUID(),kind:'photo',body:null,fileUrl:b.photoData,thumbUrl:b.photoData,authorName:'David',authorId:'demo',createdAt:new Date().toISOString(),sharedWithClient:false};state.threads[internal].push(message);save();return {message};
 }
 const isClient=action.startsWith('client');const key=isClient?client:internal;
 if(method==='POST'&&(action==='messages'||action==='client/messages')){
  if(!b.body?.trim())throw Error('Message vide.');
  state.threads[key].push({id:crypto.randomUUID(),kind:'text',body:b.body,authorName:'David',authorId:'demo',createdAt:new Date().toISOString()});save();
 }else if(method!=='GET')throw Error('Cette action n’est pas connectée dans la démonstration.');
 return {thread:{id:key,closedAt:null},messages:[...state.threads[key],...(isClient?sharedMedia(state,id):[])].sort((a:any,b:any)=>a.createdAt.localeCompare(b.createdAt)),readableBy:people.slice(0,4).map(p=>({id:p.id,name:p.displayName})),participants:people.slice(0,4)};
}
