'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { api, apiBlobUrl } from '@/lib/api';
import { formatDateBE } from '@/lib/ui';

type Receipt={id:string;source:string;reason:string|null;xmlPath:string|null;pdfPath:string|null;payload:{supplierName?:string;docNumber?:string;date?:string;ht?:number;ttc?:number;supplierVat?:string;direction?:string}};
export default function PurchaseReception({onImported}:{onImported:()=>void}) {
  const [page,setPage]=useState(1);
  const {data:list,error:listError,reload}=useApi<{items:Receipt[];total:number}>('/api/finance/expenses/receipts?page='+page);
  const {data:state,error:stateError,reload:reloadStatus}=useApi<{configured:boolean;enabled:boolean;recipient:boolean;verified:boolean;last:{at?:string;errors?:string[]}|null}>('/api/finance/expenses/peppol-reception');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function action(kind:'enable'|'disable'|'sync') {
    setBusy(true);setNotice('');
    try {
      if(kind==='sync') {
        const r=await api<{imported:number;review:number;errors:string[];disabled?:boolean}>('/api/finance/expenses/sync-peppol',{method:'POST'});
        setNotice(r.disabled?'Activez d’abord la synchronisation.':r.imported+' document(s) intégré(s), '+r.review+' à vérifier.'+(r.errors.length?' '+r.errors.join(' · '):''));
      } else {
        await api('/api/finance/expenses/peppol-reception',{method:'POST',body:{enabled:kind==='enable'}});
        setNotice(kind==='enable'?'Synchronisation activée, toutes les 10 minutes.':'Synchronisation JJD suspendue. Le routage Peppol du prestataire reste inchangé.');
      }
      reload();reloadStatus();onImported();
    }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="fox-export-panel">
    <h3>Réception Peppol et mails</h3>
    {stateError && <p role="alert">{stateError}</p>}
    {state && <p>{!state.configured?'Connexion Peppol non configurée.':!state.recipient?'Réception à transférer depuis Fox/Horus vers Recommand.':!state.verified?'Vérification de la société à terminer chez Recommand.':state.enabled?'Synchronisation Peppol active (toutes les 10 minutes).':'Réception disponible chez Recommand ; synchronisation JJD désactivée.'}</p>}
    {state?.configured && !state.recipient && <p>Demandez une clé de migration au comptable/Fox puis transférez la réception dans votre compte Recommand. Ne désactivez pas Fox avant que ce transfert soit prêt. <a href="https://app.recommand.eu" target="_blank" rel="noreferrer">Ouvrir Recommand</a></p>}
    <div className="row" style={{gap:8,flexWrap:'wrap'}}>
      <button className="btn" onClick={reloadStatus}>Vérifier la connexion</button>
      {state?.recipient && state.verified && <button className="btn" disabled={busy} onClick={()=>action(state.enabled?'disable':'enable')}>{state.enabled?'Suspendre la synchronisation':'Activer la synchronisation'}</button>}
      {state?.enabled && <button className="btn primary" disabled={busy} onClick={()=>action('sync')}>{busy?'Synchronisation…':'Récupérer maintenant'}</button>}
    </div>
    {state?.last?.at && <p className="muted">Dernière tentative : {formatDateBE(state.last.at)} {new Date(state.last.at).toLocaleTimeString('fr-BE')}</p>}
    {!!state?.last?.errors?.length && <p role="alert">{state.last.errors.join(' · ')}</p>}
    {notice && <p role="status">{notice}</p>}
    <MailboxHistory onProgress={()=>{reload();onImported();}}/>
    <h3>Documents à vérifier ({list?.total??0})</h3>
    <p>Un doute sur un doublon ou des données manquantes bloque la création automatique. Comparez le document avec les achats existants avant de le traiter.</p>
    {listError && <p role="alert">{listError}</p>}
    {list?.items.map(r=><ReceiptReview key={r.id} receipt={r} done={()=>{reload();onImported();}}/>)}
    {list?.total===0 && <p>Aucun document en attente de vérification.</p>}
    <div className="row" style={{gap:8}}>
      <button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Précédent</button>
      <span>Page {page}</span>
      <button className="btn" disabled={page*30>=(list?.total??0)} onClick={()=>setPage(p=>p+1)}>Suivant</button>
    </div>
  </section>;
}
type HistoryJob={configured:boolean;running:boolean;since:string|null;startedAt:string|null;finishedAt:string|null;folder:string|null;error:string|null;
  stats:{folders:number;messagesScanned:number;pdfsFound:number;alreadyInSystem:number;created:number;unreliableExtraction:number;errors:string[]}|null};
/** Import de tout l'historique de la boîte factures : rien n'est créé, les documents non retrouvés arrivent dans la liste à vérifier. */
function MailboxHistory({onProgress}:{onProgress:()=>void}) {
  const {data:job,reload}=useApi<HistoryJob>('/api/finance/expenses/mailbox-history');
  const [since,setSince]=useState(new Date().getFullYear()+'-01-01'),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  // pendant l'import : avancement rafraîchi toutes les 5 s, et la liste à vérifier se remplit au fur et à mesure
  useEffect(()=>{ if(!job?.running) return; const t=setInterval(()=>{reload();onProgress();},5000); return ()=>clearInterval(t); },[job?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  if(!job?.configured) return null;
  async function start(){
    if(!window.confirm('Parcourir tous les mails de la boîte factures'+(since?' depuis le '+since.split('-').reverse().join('/'):'')+' ?\n\nAucune dépense n’est créée : un PDF qui correspond à un achat existant lui est joint, les autres arrivent dans « Documents à vérifier ». Les mails ne sont pas modifiés.'))return;
    setBusy(true);setErr('');
    try{await api('/api/finance/expenses/mailbox-history',{method:'POST',body:{since:since||null}});reload();}catch(e){setErr((e as Error).message);}finally{setBusy(false);}
  }
  const st=job.stats;
  return <div className="card" style={{padding:12,marginBlock:12}}>
    <strong>Historique de la boîte factures</strong>
    <p className="muted" style={{marginTop:4}}>La synchronisation automatique traite les nouveaux mails. Ici, on reprend <strong>tous</strong> les mails déjà présents (lus ou non, tous les dossiers). Rien n’est créé automatiquement.</p>
    <div className="row" style={{gap:8,flexWrap:'wrap',alignItems:'end'}}>
      <label>Depuis le<input className="input" type="date" value={since} onChange={e=>setSince(e.target.value)} disabled={job.running}/></label>
      <button className="btn" disabled={busy||job.running} onClick={start}>{job.running?'Import en cours…':'Importer l’historique'}</button>
    </div>
    {st && <p role="status" style={{marginBottom:0}}>
      {job.running?'En cours'+(job.folder?' (dossier « '+job.folder.split(/[./]/).pop()+' »)':'')+' : ':job.finishedAt?'Terminé : ':''}
      {st.messagesScanned} mail(s) lu(s), {st.pdfsFound} PDF · {st.alreadyInSystem} déjà connu(s) · {st.created-st.unreliableExtraction} joint(s) à un achat existant · <strong>{st.unreliableExtraction} à vérifier</strong>
      {st.errors.length>0 && <> · {st.errors.length} erreur(s)</>}
    </p>}
    {job.error && <p role="alert">{job.error}</p>}
    {err && <p role="alert">{err}</p>}
  </div>;
}
const KIND_LABEL:Record<string,string>={purchase:'Facture',delivery_slip:'Bordereau',credit_note:'Note de crédit'};
function ReceiptReview({receipt:r,done}:{receipt:Receipt;done:()=>void}) {
  const [open,setOpen]=useState(false);
  return <details className="card" style={{padding:12,marginBlock:12,minWidth:0}} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary style={{cursor:'pointer'}}>{r.payload.supplierName||'Fournisseur à identifier'} · {r.payload.docNumber||'Numéro à compléter'} · {KIND_LABEL[r.payload.direction??'']??'Type à confirmer'} · {r.source==='peppol'?'Peppol':'Mail'}</summary>
    {open && <ReceiptContent receipt={r} done={done}/>}
  </details>;
}
function ReceiptContent({receipt:r,done}:{receipt:Receipt;done:()=>void}) {
  const d=r.payload;
  const [search,setSearch]=useState(d.docNumber??''),[entryId,setEntryId]=useState('');
  const {data}=useApi<{items:{id:string;docNumber:string;supplier:string;ttc:number}[]}>('/api/finance/expenses?q='+encodeURIComponent(search)+'&pageSize=100');
  const [supplier,setSupplier]=useState(d.supplierName??''),[number,setNumber]=useState(d.docNumber??'');
  const [date,setDate]=useState(d.date??''),[ht,setHt]=useState(d.ht==null?'':String(Math.abs(d.ht))),[ttc,setTtc]=useState(d.ttc==null?'':String(Math.abs(d.ttc)));
  const [kind,setKind]=useState(d.direction==='credit_note'||d.direction==='delivery_slip'?d.direction:'purchase');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  async function file(format:string) {
    try {const url=await apiBlobUrl('/api/finance/expenses/receipts/'+r.id+'/'+format);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){setNotice((e as Error).message);}
  }
  async function ignore(why:string) {
    if(!window.confirm('Ignorer ce document ('+why.toLowerCase()+') ? Il sort de la liste et ne sera créé ni rattaché nulle part.'))return;
    setBusy(true);setNotice('');
    try{await api('/api/finance/expenses/receipts/'+r.id+'/ignore',{method:'POST',body:{reason:why}});done();}
    catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
  }
  async function submit(create:boolean) {
    if(!window.confirm(create?(kind==='delivery_slip'?'Créer un bordereau en attente de facture ? Confirmez':'Créer une dépense distincte ? Confirmez')+' avoir vérifié qu’il ne s’agit pas d’un doublon et corrigé les montants en euros.':'Rattacher ce document à l’achat sélectionné ? Ses paiements et son chantier seront conservés.'))return;
    setBusy(true);setNotice('');
    try {
      await api('/api/finance/expenses/receipts/'+r.id+(create?'/create':'/link'),{method:'POST',body:create?{confirmedDistinct:true,direction:kind,docNumber:number,supplierName:supplier,supplierVat:d.supplierVat||null,contactId:null,date,ht:Number(ht),ttc:Number(ttc)}:{entryId}});
      done();
    }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
  }
  return <div>
    <p>{r.reason?.startsWith('Doublon possible')?'Doublon possible : comparez avec les achats existants.':r.reason}</p>
    <div className="row" style={{gap:8,flexWrap:'wrap'}}>
      {r.pdfPath && <button className="btn" onClick={()=>file('pdf')}>Voir le PDF</button>}
      {r.xmlPath && <button className="btn" onClick={()=>file('xml')}>Télécharger l’original Peppol (XML)</button>}
    </div>
    <div className="row" style={{gap:8,flexWrap:'wrap',marginBlock:8}}>
      <span className="muted">Pas une pièce à encoder :</span>
      {['Conditions générales','Rappel de paiement','Autre document'].map(why=><button key={why} className="btn ghost" disabled={busy} onClick={()=>ignore(why)}>Ignorer · {why}</button>)}
    </div>
    <label>Rechercher un achat existant<input className="input" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <label>Achat correspondant<select className="select" style={{maxWidth:'100%'}} value={entryId} onChange={e=>setEntryId(e.target.value)}>
      <option value="">Choisir un achat</option>{data?.items.filter(e=>e.id).map(e=><option key={e.id} value={e.id}>{e.supplier} · {e.docNumber} · {e.ttc} €</option>)}
    </select></label>
    <button className="btn" disabled={busy||!entryId} onClick={()=>submit(false)}>Rattacher à cet achat</button>
    <details style={{marginTop:16}}>
      <summary>Ce document est une nouvelle pièce (facture, bordereau ou note de crédit)</summary>
      <div style={{display:'grid',gap:8,gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,180px),1fr))',marginBlock:12}}>
        <label>Type<select className="select" value={kind} onChange={e=>setKind(e.target.value)}><option value="purchase">Facture</option><option value="delivery_slip">Bordereau</option><option value="credit_note">Note de crédit</option></select></label>
        <label>Fournisseur<input className="input" value={supplier} onChange={e=>setSupplier(e.target.value)}/></label>
        <label>Numéro<input className="input" value={number} onChange={e=>setNumber(e.target.value)}/></label>
        <label>Date<input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <label>HT (€)<input className="input" type="number" step="0.01" min="0" value={ht} onChange={e=>setHt(e.target.value)}/></label>
        <label>TTC (€)<input className="input" type="number" step="0.01" min="0" value={ttc} onChange={e=>setTtc(e.target.value)}/></label>
      </div>
      <button className="btn" disabled={busy||!supplier||!number||!date||ht===''||ttc===''} onClick={()=>submit(true)}>Créer après vérification</button>
    </details>
    {notice && <p role="alert">{notice}</p>}
  </div>;
}
