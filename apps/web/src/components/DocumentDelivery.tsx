'use client';
import { useEffect, useState } from 'react';
import { FileText, Send, CheckCircle2, CircleAlert } from 'lucide-react';
import { api, apiBlobUrl } from '@/lib/api';
import type { DocFull } from '@/lib/doc-ui';

/** Transport is deliberately explicit: a downloaded PDF is never a sent invoice. */
export function DocumentDelivery({doc,busy,onExternal,onError,peppolEnabled=false,onPeppol,onPeppolRefresh,emailEnabled=false,onEmail}:{doc:DocFull;busy:boolean;onExternal:()=>void;onError:(message:string)=>void;peppolEnabled?:boolean;onPeppol?:()=>void;onPeppolRefresh?:()=>void;emailEnabled?:boolean;onEmail?:(m:{to:string[];subject:string;message:string;copyToSelf:boolean;sign?:boolean})=>void}) {
  const [channel,setChannel]=useState<'pdf'|'email'|'peppol'>('pdf');
  const [mail,setMail]=useState<{to:string;subject:string;message:string}|null>(null);
  const [copy,setCopy]=useState(true);
  const [sign,setSign]=useState(false);
  const isQuote=doc.kind==='quote';
  type Sig={id:string;status:string;sentTo:string|null;expiresAt:string;signedAt:string|null;signerName:string|null;signerComment:string|null;url:string|null}|null;
  const [sig,setSig]=useState<Sig>(null);
  useEffect(()=>{
    if(!isQuote)return;
    api<{signature:Sig}>(`/api/quote-sign/document/${doc.id}`).then((r)=>setSig(r.signature)).catch(()=>setSig(null));
  },[doc.id,doc.sentAt,doc.status,isQuote]);
  const revoke=async()=>{if(!sig||!confirm('Annuler le lien de signature ? Le client ne pourra plus signer avec ce lien.'))return;try{const r=await api<{signature:Sig}>(`/api/quote-sign/${sig.id}/revoke`,{method:'POST',body:{}});setSig(r.signature);}catch(e){onError((e as Error).message);}};
  useEffect(()=>{
    if(channel!=='email'||mail)return;
    api<{to:string;subject:string;message:string}>(`/api/documents/${doc.id}/email/defaults`).then(setMail).catch((e)=>onError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[channel,doc.id]);
  const invoice=['invoice','deposit_invoice','credit_note'].includes(doc.kind);
  const vat=doc.billingVat??doc.contact?.vat;
  const recipient=doc.billingName??doc.contact?.name;
  const pdf=async()=>{try{window.open(await apiBlobUrl(`/api/documents/${doc.id}/pdf`),'_blank','noopener');}catch(e){onError((e as Error).message);}};
  return <section className="doc-card delivery-panel" aria-label="Transmission du document">
    <div className="delivery-title"><div><span className="eyebrow">Transmission</span><h2>Envoyer au client</h2></div><span className="badge plain">{doc.sentAt?'Envoi enregistré':'À transmettre'}</span></div>
    <p className="muted">{recipient||'Choisissez le destinataire'}{vat?` · ${vat}`:''}</p>
    <div className="delivery-options" role="group" aria-label="Canal de transmission">
      <button type="button" aria-pressed={channel==='pdf'} className={channel==='pdf'?'selected':''} onClick={()=>setChannel('pdf')}><FileText size={21}/><span><strong>PDF / envoi externe</strong><small>Particuliers ou autre canal convenu</small></span></button>
      <button type="button" aria-pressed={channel==='email'} className={channel==='email'?'selected':''} onClick={()=>setChannel('email')}><FileText size={21}/><span><strong>E-mail</strong><small>PDF joint, depuis la boîte JJD</small></span></button>
      {invoice&&<button type="button" aria-pressed={channel==='peppol'} className={channel==='peppol'?'selected':''} onClick={()=>setChannel('peppol')}><Send size={21}/><span><strong>Peppol</strong><small>Clients professionnels concernés</small></span></button>}
    </div>
    {channel==='email'?<div>
      {!emailEnabled?<div className="delivery-notice"><CircleAlert size={20}/><div><strong>Envoi par e-mail à activer</strong><p>Le serveur d’envoi de la boîte JJD n’est pas encore branché. En attendant, téléchargez le PDF et envoyez-le depuis votre messagerie.</p></div></div>
      :!doc.lockedAt?<div className="delivery-notice"><CircleAlert size={20}/><div><p>Émettez d’abord le document pour pouvoir l’envoyer.</p></div></div>
      :!mail?<p className="hint">Préparation du message…</p>
      :<div style={{display:'grid',gap:'0.6rem'}}>
        <label className="field"><span>Destinataire(s) — séparés par une virgule</span><input className="input" value={mail.to} onChange={(e)=>setMail({...mail,to:e.target.value})} placeholder="client@exemple.be"/></label>
        <label className="field"><span>Objet</span><input className="input" value={mail.subject} onChange={(e)=>setMail({...mail,subject:e.target.value})}/></label>
        <label className="field"><span>Message</span><textarea className="input" rows={9} value={mail.message} onChange={(e)=>setMail({...mail,message:e.target.value})}/></label>
        <label style={{display:'flex',gap:'0.5rem',alignItems:'center',fontSize:'0.88rem'}}><input type="checkbox" checked={copy} onChange={(e)=>setCopy(e.target.checked)}/>M’envoyer une copie (en copie cachée) pour la retrouver dans la boîte JJD</label>
        {isQuote&&<label style={{display:'flex',gap:'0.5rem',alignItems:'flex-start',fontSize:'0.9rem',background:'var(--paper, #f5f5ef)',borderRadius:8,padding:'0.6rem 0.7rem'}}><input type="checkbox" checked={sign} onChange={(e)=>setSign(e.target.checked)} style={{marginTop:3}}/><span><strong>Permettre au client de signer ce devis en ligne</strong><br/><small>Un lien personnel (valable 30 jours) est ajouté au message : le client lit le devis, l’accepte et le signe depuis son téléphone ou son ordinateur. Le PDF envoyé est figé et la preuve (nom, date, heure, adresse IP) est conservée. Le devis passe en « accepté » à la signature.</small></span></label>}
        <p className="hint">Le PDF du document est joint automatiquement. {doc.sentAt?'Ce document a déjà été envoyé : un nouvel envoi n’en change pas le statut.':'Le document passera en « envoyé » une fois l’e-mail parti.'}</p>
        <div><button className="btn primary" disabled={busy||!mail.to.trim()} onClick={()=>{
          const to=mail.to.split(/[,;\s]+/).map((x)=>x.trim()).filter(Boolean);
          if(confirm(`Envoyer ce document par e-mail à ${to.join(', ')} ?`))onEmail?.({to,subject:mail.subject,message:mail.message,copyToSelf:copy,...(isQuote&&sign?{sign:true}:{})});
        }}><Send size={16}/>Envoyer par e-mail</button></div>
      </div>}
    </div>:    channel==='peppol'?(peppolEnabled?<div className="delivery-notice"><Send size={20}/><div>
      {doc.peppolId&&doc.peppolStatus!=='error'?<>
        <strong>{doc.peppolStatus==='delivered'?'Livré au client via Peppol':'Transmis au réseau Peppol'}</strong>
        <p>{doc.peppolStatus==='delivered'?'Le point d’accès du client a confirmé la réception.':'En attente de la confirmation de livraison du point d’accès du client (mise à jour automatique toutes les 30 minutes).'}</p>
        {doc.peppolStatus!=='delivered'&&<button className="btn" disabled={busy} onClick={onPeppolRefresh}>Actualiser le statut</button>}
      </>:<>
        <strong>Envoyer par Peppol</strong>
        <p>La facture est transmise directement au point d’accès Peppol du client{vat?` (${vat})`:''}. Réservé aux clients professionnels belges avec un numéro de TVA ; sinon, envoyez le PDF par e-mail. La réception de vos factures fournisseurs reste gérée par votre comptable : JJD n’envoie que vos ventes.</p>
        {doc.peppolStatus==='error'&&<p>Une transmission précédente a échoué : vous pouvez corriger le document puis réessayer.</p>}
        {!doc.lockedAt?<p>Émettez d’abord le document pour pouvoir l’envoyer.</p>:null}
        <button className="btn primary" disabled={busy||!doc.lockedAt||!vat} onClick={()=>{if(confirm('Envoyer ce document au client par Peppol ? L’envoi est réel et définitif.'))onPeppol?.();}}>Envoyer par Peppol</button>
        {!vat&&<p>Numéro de TVA du client manquant : complétez sa fiche.</p>}
      </>}
    </div></div>:<div className="delivery-notice"><CircleAlert size={20}/><div><strong>Connexion Peppol à activer</strong><p>JJD ne transmet pas encore au réseau. Continuez l’envoi via TrustUp jusqu’à l’activation du connecteur. La réception chez votre comptable reste indépendante.</p>{doc.peppolStatus==='queued'&&<p>Ancienne file d’attente : ce statut ne constitue pas une preuve d’envoi.</p>}<button className="btn" disabled>Envoi Peppol indisponible</button></div></div>):<div><p className="hint">Téléchargez le PDF, puis transmettez-le par votre canal habituel. Le téléchargement ne marque pas le document comme envoyé.</p><div className="row"><button className="btn primary" onClick={pdf}><FileText size={16}/>Télécharger le PDF</button>{!!doc.lockedAt&&!doc.sentAt&&<button className="btn" disabled={busy} onClick={()=>{if(confirm('Confirmez-vous avoir déjà transmis ce document au client hors de JJD ? Cette action ne réalise aucun envoi.'))onExternal();}}>Enregistrer l’envoi déjà effectué</button>}</div></div>}
    {isQuote&&sig&&<p className="delivery-history" style={{display:'flex',flexWrap:'wrap',gap:'0.5rem',alignItems:'center'}}>
      {sig.status==='signed'&&<><CheckCircle2 size={16}/>Signé en ligne par <strong>{sig.signerName}</strong> le {new Date(sig.signedAt!).toLocaleString('fr-BE',{dateStyle:'long',timeStyle:'short'})}.</>}
      {sig.status==='declined'&&<><CircleAlert size={16}/>Refusé en ligne par le client{sig.signerComment?` : « ${sig.signerComment} »`:''}.</>}
      {sig.status==='pending'&&<><Send size={16}/>Signature en ligne en attente (envoyée à {sig.sentTo}, valable jusqu’au {new Date(sig.expiresAt).toLocaleDateString('fr-BE')}). <button className="btn ghost" style={{fontSize:'0.8rem'}} onClick={revoke}>Annuler le lien</button></>}
      {sig.status==='expired'&&<><CircleAlert size={16}/>Le lien de signature a expiré : renvoyez le devis avec « signer en ligne » coché.</>}
    </p>}
    {doc.sentAt&&<p className="delivery-history"><CheckCircle2 size={16}/>Envoi enregistré le {new Date(doc.sentAt).toLocaleDateString('fr-BE')} · à distinguer de l’accusé de réception Peppol.</p>}
  </section>;
}
