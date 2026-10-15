import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from './http.js';

export interface PurchaseData {
  direction: 'purchase' | 'credit_note' | 'delivery_slip';
  docNumber: string | null; supplierName: string | null; supplierVat?: string | null;
  contactId: string | null; date: string | null; dueDate?: string | null;
  ht: number | null; ttc: number | null; vatRate?: number | null;
  worksiteId?: string | null; worksiteRef?: string | null;
}
export const normVat = (s?: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const norm = (s?: string | null) => (s ?? '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
function complete(d: PurchaseData) {
  return !!(d.docNumber && d.supplierName && d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isFinite(Date.parse(d.date))
    && d.ht != null && Number.isFinite(d.ht) && d.ttc != null && Number.isFinite(d.ttc));
}
export async function purchaseMatches(tx: Prisma.TransactionClient, d: PurchaseData) {
  if (!d.docNumber) return { exact: [], possible: [] };
  // Compare normalized references, never amount alone. Legacy entries do not have a normalized key.
  const rows = await tx.ledgerEntry.findMany({where:{direction:d.direction,docNumber:{not:null}},select:{
    id:true,docNumber:true,contactId:true,supplierName:true,supplierVat:true,date:true,ttc:true,
    contact:{select:{vat:true}},
  }});
  const vat = normVat(d.supplierVat);
  const possible = rows.filter(e => norm(e.docNumber) === norm(d.docNumber) && (
    (vat && normVat(e.supplierVat || e.contact?.vat) === vat) ||
    (d.contactId && e.contactId === d.contactId) ||
    (norm(d.supplierName) && norm(e.supplierName) === norm(d.supplierName)) ||
    (!e.supplierName && !e.contactId)
  ));
  const exact = possible.filter(e => {
    const eVat = normVat(e.supplierVat || e.contact?.vat);
    const identity = vat && eVat ? vat === eVat : !!d.contactId && d.contactId === e.contactId;
    return identity && complete(d) && e.ttc != null && Math.abs(Math.abs(e.ttc)-Math.abs(d.ttc!)) <= 0.020001 &&
      e.date?.toISOString().slice(0,10) === d.date;
  });
  return {exact,possible};
}
async function serial<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt=0;;attempt++) {
    try { return await prisma.$transaction(fn,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000}); }
    catch (e) {
      if (attempt>=3 || !(e instanceof Prisma.PrismaClientKnownRequestError) || !['P2034','P2002'].includes(e.code)) throw e;
    }
  }
}
export async function receivePurchase(input: {sourceRef:string;source:'email'|'peppol';data:PurchaseData;pdfPath:string|null;xmlPath?:string|null;reason?:string|null}) {
  return serial(async tx => {
    const old = await tx.purchaseReceipt.findUnique({where:{sourceRef:input.sourceRef}});
    if (old) return old;
    const d = input.data;
    const matches = await purchaseMatches(tx,d);
    let ledgerEntryId: string | null = null;
    let reason = input.reason || (!complete(d) ? 'Données incomplètes : vérifier le document.' : null);
    if (!reason && matches.exact.length===1 && matches.possible.length===1) {
      ledgerEntryId = matches.exact[0]!.id;
      // Retain payment allocations, worksite and Fox tracking. Only fill a missing attachment.
      if (input.pdfPath) await tx.ledgerEntry.updateMany({where:{id:ledgerEntryId,pdfPath:null},data:{pdfPath:input.pdfPath}});
    } else if (!reason && matches.possible.length) {
      reason = 'Doublon possible : ' + matches.possible.map(e=>e.id).join(', ');
    } else if (!reason) {
      const date = new Date(d.date!);
      const row = await tx.ledgerEntry.create({data:{
        direction:d.direction,docType:d.direction==='credit_note'?'Note de crédit':d.direction==='delivery_slip'?'Bordereau':"Facture d'achat",
        docNumber:d.docNumber,supplierName:d.supplierName,supplierVat:d.supplierVat,contactId:d.contactId,
        date,dueDate:d.dueDate?new Date(d.dueDate):null,year:date.getFullYear(),month:String(date.getMonth()+1),quarter:'T'+Math.ceil((date.getMonth()+1)/3),
        ht:Math.abs(d.ht!),ttc:Math.abs(d.ttc!),vatRate:d.vatRate,worksiteId:d.worksiteId,worksiteRef:d.worksiteRef,
        pdfPath:input.pdfPath,source:input.source,paymentStatus:'Non payé',
      }});
      ledgerEntryId=row.id;
    }
    return tx.purchaseReceipt.create({data:{
      sourceRef:input.sourceRef,source:input.source,payload:d as unknown as Prisma.InputJsonValue,pdfPath:input.pdfPath,xmlPath:input.xmlPath,
      ledgerEntryId,status:ledgerEntryId?'imported':'review',reason,
    }});
  });
}
/** Explicit manual link only: ambiguous documents never create a second expense automatically. */
export async function linkPurchaseReceipt(id: string, entryId: string, actorId: string) {
  return serial(async tx => {
    const receipt = await tx.purchaseReceipt.findUnique({where:{id}});
    const entry = await tx.ledgerEntry.findUnique({where:{id:entryId}});
    if (!receipt || !entry) throw new HttpError(404,'Document ou achat introuvable.');
    if (receipt.status !== 'review') throw new HttpError(409,'Ce document est déjà traité.');
    const d=receipt.payload as unknown as PurchaseData;
    if (entry.direction!==d.direction) throw new HttpError(422,'Le type facture / note de crédit doit correspondre.');
    if (!entry.pdfPath && receipt.pdfPath) await tx.ledgerEntry.update({where:{id:entryId},data:{pdfPath:receipt.pdfPath}});
    const updated=await tx.purchaseReceipt.update({where:{id},data:{ledgerEntryId:entryId,status:'imported',reason:null}});
    await tx.auditLog.create({data:{actorId,action:'link_receipt',entity:'ledgerEntry',entityId:entryId,meta:{receiptId:id}}});
    return updated;
  });
}

export async function createReviewedPurchase(id:string,d:PurchaseData,actorId:string) {
  if(!complete(d)) throw new HttpError(422,'Complétez le fournisseur, le numéro, la date et les montants.');
  return serial(async tx=>{
    const receipt=await tx.purchaseReceipt.findUnique({where:{id}});
    if(!receipt) throw new HttpError(404,'Document introuvable.');
    if(receipt.status!=='review') throw new HttpError(409,'Document déjà traité.');
    const date=new Date(d.date!);
    const row=await tx.ledgerEntry.create({data:{
      direction:d.direction,docType:d.direction==='credit_note'?'Note de crédit':"Facture d'achat",
      docNumber:d.docNumber,supplierName:d.supplierName,supplierVat:d.supplierVat,contactId:d.contactId,
      date,dueDate:d.dueDate?new Date(d.dueDate):null,year:date.getFullYear(),month:String(date.getMonth()+1),quarter:'T'+Math.ceil((date.getMonth()+1)/3),
      ht:Math.abs(d.ht!),ttc:Math.abs(d.ttc!),pdfPath:receipt.pdfPath,source:receipt.source,paymentStatus:'Non payé',createdById:actorId,
    }});
    await tx.purchaseReceipt.update({where:{id},data:{ledgerEntryId:row.id,status:'imported',reason:null}});
    await tx.auditLog.create({data:{actorId,action:'create_from_receipt',entity:'ledgerEntry',entityId:row.id,meta:{receiptId:id,manualReview:true}}});
    return row;
  });
}
