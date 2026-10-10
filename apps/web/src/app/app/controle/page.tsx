'use client';
import { tr } from '@/lib/ui-language';
import {OperationalControl} from '@/components/OperationalControl';
import {SkeletonRows,ErrorState} from '@/components/States';
import {useState} from 'react';
import Link from 'next/link';
import {useApi} from '@/lib/use-api';
import {api} from '@/lib/api';
import {PageHead} from '@/lib/ui';
import {AlertTriangle,ShieldAlert,Info,CheckCircle2,Search,ClipboardCheck} from 'lucide-react';

interface Issue {id:string;entity:string;sheet:string|null;rowRef:string|null;severity:string;message:string;resolved:boolean;link:{label:string;href:string}|null}
const ENTITY_LABEL:Record<string,string>={worksite:'Chantiers',ledger:'Finances',time_entry:'Pointage',contact:'Contacts',person:'Équipe'};
const PRIORITIES=[{key:'error',label:'À corriger en priorité',tone:'crit',icon:ShieldAlert},{key:'warning',label:'À vérifier',tone:'warn',icon:AlertTriangle},{key:'info',label:'À compléter',tone:'plain',icon:Info}];

export default function ControlePage(){
 const [resolved,setResolved]=useState('0'),[entity,setEntity]=useState(''),[severity,setSeverity]=useState(''),[q,setQ]=useState('');
 const [actionError,setActionError]=useState<string|null>(null),[busy,setBusy]=useState<string|null>(null),[lastDone,setLastDone]=useState<string|null>(null);
 const params=new URLSearchParams({resolved});if(entity)params.set('entity',entity);if(severity)params.set('severity',severity);
 const {data,loading,error,reload}=useApi<{items:Issue[];openBySeverity:Record<string,number>}>(`/api/imports/issues?${params}`);
 async function resolve(id:string,value=true){
  if(busy)return;setBusy(id);setActionError(null);
  try{await api(`/api/imports/issues/${id}`,{method:'PATCH',body:{resolved:value}});setLastDone(value?id:null);reload();}
  catch(e){setActionError(e instanceof Error?e.message:'Modification impossible.');}finally{setBusy(null);}
 }
 const items=(data?.items||[]).filter(i=>`${i.message} ${ENTITY_LABEL[i.entity]||i.entity} ${i.link?.label||''}`.toLocaleLowerCase().includes(q.toLocaleLowerCase().trim()));
 const groups=Object.entries(ENTITY_LABEL).concat([...new Set(items.map(i=>i.entity))].filter(k=>!ENTITY_LABEL[k]).map(k=>[k,k]));
 const rank=(i:Issue)=>({error:0,warning:1,info:2}[i.severity]??3);
 return <>
  <PageHead eyebrow={tr("Administration")} title={tr("File de contrôle")} sub="Les points à vérifier, avec un accès direct aux fiches concernées."/>
  <OperationalControl/>
  <div className="control-administrative-heading"><span className="eyebrow">Qualité des données</span><h2>Contrôles administratifs</h2></div>
  <div className="control-priorities">
   {PRIORITIES.map(p=><button key={p.key} className={`control-priority ${p.tone}${severity===p.key&&resolved==='0'?' selected':''}`} aria-pressed={severity===p.key&&resolved==='0'} onClick={()=>{setResolved('0');setSeverity(severity===p.key?'':p.key);}}><p.icon size={22}/><span><strong>{data?.openBySeverity[p.key]??'—'}</strong><span>{p.label}</span></span></button>)}
  </div>
  <div className="control-workspace">
   <section className="control-queue" aria-label="Contrôles">
    <div className="control-toolbar">
     <div className="control-view-tabs"><button className={resolved==='0'?'active':''} onClick={()=>setResolved('0')}>À traiter</button><button className={resolved==='1'?'active':''} onClick={()=>setResolved('1')}>Traités</button></div>
     <label className="control-search"><Search size={18}/><input aria-label="Rechercher un contrôle" placeholder="Rechercher une anomalie, un dossier…" value={q} onChange={e=>setQ(e.target.value)}/></label>
     <select className="select" aria-label={tr("Catégorie")} value={entity} onChange={e=>setEntity(e.target.value)}><option value="">Toutes les catégories</option>{Object.entries(ENTITY_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    </div>
    {severity&&<div className="control-active-filter"><span>Priorité : {PRIORITIES.find(p=>p.key===severity)?.label}</span><button className="btn ghost" onClick={()=>setSeverity('')}>Toutes les priorités</button></div>}
    {actionError&&<p className="state error" role="alert">{actionError}</p>}
    {lastDone&&<div className="control-feedback" role="status"><CheckCircle2 size={18}/><span>Contrôle classé comme traité.</span><button className="btn ghost" disabled={!!busy} onClick={()=>resolve(lastDone,false)}>{tr("Annuler")}</button></div>}
    {loading&&<SkeletonRows/>}
    {error&&!loading&&<ErrorState message={error} onRetry={reload}/>}
    {!loading&&data&&items.length===0&&<div className="control-empty"><ClipboardCheck size={36}/><h2>{resolved==='1'?'Aucun contrôle traité ici':'Aucun point à traiter ici'}</h2><p>{q||entity||severity?'Essayez une autre recherche ou retirez les filtres.':'Les contrôles disponibles apparaîtront dans cette liste.'}</p>{(q||entity||severity)&&<button className="btn" onClick={()=>{setQ('');setEntity('');setSeverity('');}}>Réinitialiser les filtres</button>}</div>}
    {!loading&&groups.map(([key,label])=>{const rows=items.filter(i=>i.entity===key).sort((a,b)=>rank(a)-rank(b));return rows.length>0&&<section key={key} className="control-group"><h2>{label}<span>{rows.length}</span></h2>{rows.map(i=>{const priority=PRIORITIES.find(p=>p.key===i.severity)||PRIORITIES[2]!;const Icon=priority.icon;return <article className={`control-card ${priority.tone}`} key={i.id}><div className={`control-card-icon ${priority.tone}`}><Icon size={22}/></div><div className="control-card-content"><span className={`badge ${i.resolved?'ok':priority.tone}`}>{i.resolved?tr("Traité"):priority.label}</span><h3>{i.message}</h3>{(i.sheet||i.rowRef)&&<details><summary>Voir l’origine du contrôle</summary><p>{i.sheet||'Import'}{i.rowRef?` · ligne ${i.rowRef}`:''}</p></details>}<div className="control-card-actions">{i.link?<Link className="btn primary" href={i.link.href}>{i.link.label}</Link>:<span className="muted">Aucune fiche liée à ce contrôle.</span>}<button className="btn ghost" disabled={!!busy} onClick={()=>resolve(i.id,!i.resolved)}>{busy===i.id?tr("Enregistrement…"):i.resolved?'Remettre à traiter':'Marquer comme traité'}</button></div></div></article>})}</section>})}
   </section>
   <aside className="control-guide"><span className="eyebrow">Votre contrôle</span><h2>Une anomalie,<br/>une action claire.</h2><ol><li><strong>Ouvrir la fiche</strong><span>Retrouvez le contact, chantier ou pointage concerné.</span></li><li><strong>Corriger ou vérifier</strong><span>Contrôlez l’information dans son contexte.</span></li><li><strong>Classer le contrôle</strong><span>Marquez-le comme traité quand la vérification est terminée.</span></li></ol><p>« Traité » classe l’alerte. Cette action ne modifie pas les données de la fiche.</p></aside>
  </div>
 </>;
}
