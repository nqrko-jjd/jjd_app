'use client';
import { useState } from 'react';
import { FileText, Send, CheckCircle2, CircleAlert } from 'lucide-react';
import { apiBlobUrl } from '@/lib/api';
import type { DocFull } from '@/lib/doc-ui';

/** Transport is deliberately explicit: a downloaded PDF is never a sent invoice. */
export function DocumentDelivery({doc,busy,onExternal,onError,peppolEnabled=false,onPeppol,onPeppolRefresh}:{doc:DocFull;busy:boolean;onExternal:()=>void;onError:(message:string)=>void;peppolEnabled?:boolean;onPeppol?:()=>void;onPeppolRefresh?:()=>void}) {
  const [channel,setChannel]=useState<'pdf'|'peppol'>('pdf');
  const invoice=['invoice','deposit_invoice','credit_note'].includes(doc.kind);
  const vat=doc.billingVat??doc.contact?.vat;
  const recipient=doc.billingName??doc.contact?.name;
  const pdf=async()=>{try{window.open(await apiBlobUrl(`/api/documents/${doc.id}/pdf`),'_blank','noopener');}catch(e){onError((e as Error).message);}};
  return <section className="doc-card delivery-panel" aria-label="Transmission du document">
    <div className="delivery-title"><div><span className="eyebrow">Transmission</span><h2>Envoyer au client</h2></div><span className="badge plain">{doc.sentAt?'Envoi enregistré':'À transmettre'}</span></div>
    <p className="muted">{recipient||'Choisissez le destinataire'}{vat?` · ${vat}`:''}</p>
    <div className="delivery-options" role="group" aria-label="Canal de transmission">
      <button type="button" aria-pressed={channel==='pdf'} className={channel==='pdf'?'selected':''} onClick={()=>setChannel('pdf')}><FileText size={21}/><span><strong>PDF / envoi externe</strong><small>Particuliers ou autre canal convenu</small></span></button>
      {invoice&&<button type="button" aria-pressed={channel==='peppol'} className={channel==='peppol'?'selected':''} onClick={()=>setChannel('peppol')}><Send size={21}/><span><strong>Peppol</strong><small>Clients professionnels concernés</small></span></button>}
    </div>
    {channel==='peppol'?(peppolEnabled?<div className="delivery-notice"><Send size={20}/><div>
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
    {doc.sentAt&&<p className="delivery-history"><CheckCircle2 size={16}/>Envoi enregistré le {new Date(doc.sentAt).toLocaleDateString('fr-BE')} · à distinguer de l’accusé de réception Peppol.</p>}
  </section>;
}
