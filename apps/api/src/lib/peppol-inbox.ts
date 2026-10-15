import { env } from '../env.js';
import { prisma } from '../db.js';
import { storeFile } from './media.js';
import { peppolConfigured } from './peppol.js';
import { receivePurchase, normVat, type PurchaseData } from './purchase-receipts.js';
import { HttpError } from './http.js';

async function request(route: string, pdf=false) {
  if (!peppolConfigured()) throw new HttpError(503,'Connexion Peppol non configurée.');
  const r=await fetch(env.peppol.baseUrl+route,{
    headers:{authorization:'Basic '+Buffer.from(env.peppol.apiKey+':'+env.peppol.apiSecret).toString('base64'),accept:pdf?'application/pdf':'application/json'},
    signal:AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new HttpError(502,'Peppol : requête refusée ('+r.status+'). Vérifiez la connexion et les droits de réception.');
  const declared=Number(r.headers.get('content-length')||0);
  if(declared>30*1024*1024) throw new HttpError(422,'Document Peppol trop volumineux.');
  // Bound downloaded bytes even when Content-Length is absent.
  const chunks: Uint8Array[]=[]; let length=0;
  const reader=r.body?.getReader();
  if(!reader) throw new HttpError(502,'Réponse Peppol vide.');
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>30*1024*1024){await reader.cancel();throw new HttpError(422,'Document Peppol trop volumineux.');}chunks.push(value);}
  const bytes=Buffer.concat(chunks);
  return pdf ? bytes : JSON.parse(bytes.toString('utf8'));
}
export async function peppolReceptionStatus() {
  const setting=await prisma.setting.findUnique({where:{key:'peppolReception'}});
  const enabled=(setting?.value as {enabled?:boolean}|null)?.enabled===true;
  const last=await prisma.setting.findUnique({where:{key:'peppolReceptionLast'}});
  if(!peppolConfigured()) return {configured:false,enabled:false,recipient:false,verified:false,last:last?.value??null};
  const r=await request('/companies/'+encodeURIComponent(env.peppol.companyId));
  const co=r.company;
  if(!co || co.id!==env.peppol.companyId) throw new HttpError(502,'Réponse de configuration Peppol inattendue.');
  return {configured:true,enabled,recipient:co.isSmpRecipient===true,verified:co.isVerified===true,last:last?.value??null};
}
export async function setPeppolReception(enabled:boolean) {
  if(enabled) {
    const state=await peppolReceptionStatus();
    if(!state.recipient || !state.verified) throw new HttpError(409,'La réception doit d’abord être transférée de Fox/Horus vers Recommand. Demandez une clé de migration à votre prestataire actuel.');
  }
  await prisma.setting.upsert({where:{key:'peppolReception'},create:{key:'peppolReception',value:{enabled}},update:{value:{enabled}}});
}
type RemoteDocument = {
  id:string;companyId:string;direction:string;type:string;xml:string;validation?:{result?:string};
  parsed?:{invoiceNumber?:string;creditNoteNumber?:string;issueDate?:string;dueDate?:string;currency?:string;
    seller?:{name?:string;vatNumber?:string}; totals?:{taxExclusiveAmount?:string;taxInclusiveAmount?:string}};
};
const amount=(s:unknown)=>typeof s==='string' && /^-?\d+(\.\d{1,4})?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
const date=(s:unknown)=>typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s ? s : null;
export function mapReceivedDocument(doc:RemoteDocument,companyId:string) {
  if(!doc.id || doc.companyId!==companyId || doc.direction!=='incoming') throw new HttpError(422,'Document Peppol hors de la société destinataire.');
  if(!['invoice','creditNote'].includes(doc.type)) throw new HttpError(422,'Type Peppol non pris en charge : '+doc.type);
  if(typeof doc.xml!=='string' || !doc.xml.trim()) throw new HttpError(422,'Original XML Peppol absent.');
  const p=doc.parsed;
  const data:PurchaseData={direction:doc.type==='creditNote'?'credit_note':'purchase',
    docNumber:(doc.type==='creditNote'?p?.creditNoteNumber:p?.invoiceNumber)?.trim()||null,
    supplierName:p?.seller?.name?.trim()||null,supplierVat:normVat(p?.seller?.vatNumber)||null,contactId:null,
    date:date(p?.issueDate),dueDate:date(p?.dueDate),ht:amount(p?.totals?.taxExclusiveAmount),ttc:amount(p?.totals?.taxInclusiveAmount)};
  const reason=doc.validation?.result!=='valid'?'Validation Peppol à vérifier.':p?.currency!=='EUR'?'Devise non EUR : traitement manuel requis.':null;
  return {data,reason};
}
let running:Promise<unknown>|null=null;
export function syncPeppolInbox() {
  if(running) return running;
  running=run().finally(()=>{running=null;});return running;
}
async function run() {
  const setting=await prisma.setting.findUnique({where:{key:'peppolReception'}});
  if((setting?.value as {enabled?:boolean}|null)?.enabled!==true) return {imported:0,review:0,errors:[],disabled:true};
  const result={imported:0,review:0,errors:[] as string[],at:new Date().toISOString()};
  try {
    const status=await peppolReceptionStatus();
    if(!status.recipient || !status.verified) throw new HttpError(409,'Réception Peppol inactive chez le prestataire.');
    // Paged history also covers documents read by another client. Local receipt IDs make replay safe.
    const listing=await request('/documents?direction=incoming&companyId='+encodeURIComponent(env.peppol.companyId)+'&limit=50&page=1');
    if(!Array.isArray(listing.documents)) throw new HttpError(502,'Liste Peppol illisible.');
    const pages=Math.max(1,Math.ceil(Number(listing.pagination?.total||listing.documents.length)/50));
    for(let page=1;page<=Math.min(pages,100);page++) {
      const list=page===1?listing:await request('/documents?direction=incoming&companyId='+encodeURIComponent(env.peppol.companyId)+'&limit=50&page='+page);
      if(!Array.isArray(list.documents)) throw new HttpError(502,'Liste Peppol illisible.');
      for(const item of list.documents) {
        const ref='peppol:'+env.peppol.companyId+':'+item.id;
        if(await prisma.purchaseReceipt.findUnique({where:{sourceRef:ref}})) continue;
        try {
          const response=await request('/documents/'+encodeURIComponent(item.id));
          const doc=response.document as RemoteDocument;
          const {data,reason}=mapReceivedDocument(doc,env.peppol.companyId);
          if(doc.id!==item.id) throw new HttpError(422,'Identifiant Peppol incohérent.');
          if(data.supplierVat) {
            const contacts=await prisma.contact.findMany({where:{type:{in:['supplier','both']}},select:{id:true,vat:true}});
            const matches=contacts.filter(c=>normVat(c.vat)===data.supplierVat);
            if(matches.length===1) data.contactId=matches[0]!.id;
          }
          const pdf=await request('/documents/'+encodeURIComponent(item.id)+'/render/pdf',true) as Buffer;
          if(!pdf.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new HttpError(502,'PDF Peppol illisible.');
          const pdfPath=storeFile(pdf,'peppol.pdf','expenses');
          const xmlPath=storeFile(Buffer.from(doc.xml,'utf8'),'peppol.xml','expenses');
          const receipt=await receivePurchase({sourceRef:ref,source:'peppol',data,pdfPath,xmlPath,reason});
          if(receipt.status==='review') result.review++; else result.imported++;
        } catch(e) {result.errors.push(String(item.id)+': '+(e as Error).message);}
      }
    }
    if(pages>100) result.errors.push('Historique supérieur à 5000 documents : reprise complémentaire nécessaire.');
  } catch(e) {result.errors.push((e as Error).message);}
  await prisma.setting.upsert({where:{key:'peppolReceptionLast'},create:{key:'peppolReceptionLast',value:result},update:{value:result}});
  return result;
}
