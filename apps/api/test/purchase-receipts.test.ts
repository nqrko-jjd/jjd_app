import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {prisma} from '../src/db.js';
import {receivePurchase,linkPurchaseReceipt,type PurchaseData} from '../src/lib/purchase-receipts.js';
import {mapReceivedDocument,setPeppolReception,syncPeppolInbox} from '../src/lib/peppol-inbox.js';
import {env} from '../src/env.js';
const prefix='receive-test-'+Date.now();
const ids:string[]=[];
let contactId='';
before(async()=>{
  contactId=(await prisma.contact.create({data:{name:prefix,normalizedName:prefix,type:'supplier',vat:'BE0123456789'}})).id;
});
after(async()=>{
  const rows=await prisma.purchaseReceipt.findMany({where:{sourceRef:{startsWith:prefix}}});
  const entries=[...ids,...rows.map(r=>r.ledgerEntryId).filter((id):id is string=>!!id)];
  await prisma.purchaseReceipt.deleteMany({where:{sourceRef:{startsWith:prefix}}});
  await prisma.auditLog.deleteMany({where:{entity:'ledgerEntry',entityId:{in:entries}}});
  await prisma.ledgerEntry.deleteMany({where:{id:{in:entries}}});
  await prisma.contact.delete({where:{id:contactId}});
});
const data=(number:string):PurchaseData=>({direction:'purchase',docNumber:number,supplierName:prefix,supplierVat:'BE0123456789',contactId,date:'2026-10-15',ht:100,ttc:121});
const receive=(key:string,d:PurchaseData,source:'email'|'peppol'='email',reason?:string)=>receivePurchase({sourceRef:prefix+key,source,data:d,pdfPath:'/uploads/test.pdf',xmlPath:source==='peppol'?'/uploads/test.xml':null,reason});
test('mail then Peppol links to one purchase and preserves payment, worksite-independent state and Fox transmission',async()=>{
  const mail=await receive('mail-a',data(prefix+'A'));
  assert.equal(mail.status,'imported');assert.ok(mail.ledgerEntryId);
  await prisma.ledgerEntry.update({where:{id:mail.ledgerEntryId!},data:{paymentStatus:'Payé',foxTransmittedAt:new Date('2026-10-15')}});
  const peppol=await receive('peppol-a',data(prefix+'A'),'peppol');
  assert.equal(peppol.ledgerEntryId,mail.ledgerEntryId);
  const row=await prisma.ledgerEntry.findUniqueOrThrow({where:{id:mail.ledgerEntryId!}});
  assert.equal(row.paymentStatus,'Payé');assert.ok(row.foxTransmittedAt);
  assert.equal((await receive('peppol-a',data(prefix+'A'),'peppol')).id,peppol.id);
});
test('Peppol then mail, rounded cents and repeated concurrent import remain a single purchase',async()=>{
  const original=await receive('peppol-b',data(prefix+'B'),'peppol');
  const mail=await receive('mail-b',{...data(prefix+'B'),ttc:121.02});
  assert.equal(mail.ledgerEntryId,original.ledgerEntryId);
  const result=await Promise.all([receive('race',data(prefix+'C')),receive('race',data(prefix+'C'))]);
  assert.equal(result[0].id,result[1].id);
});
test('same number from another supplier or a credit note is a different document',async()=>{
  const a=await receive('supplier-a',data(prefix+'D'));
  const b=await receive('supplier-b',{...data(prefix+'D'),supplierVat:'BE0987654321',contactId:null,supplierName:'Another supplier'});
  const nc=await receive('credit',{...data(prefix+'D'),direction:'credit_note'});
  assert.notEqual(a.ledgerEntryId,b.ledgerEntryId);assert.notEqual(a.ledgerEntryId,nc.ledgerEntryId);
});
test('conflicting amounts, uncertain identities and invalid documents stay in review',async()=>{
  await receive('original',data(prefix+'E'));
  const conflict=await receive('conflict',{...data(prefix+'E'),ttc:150},'peppol');
  assert.equal(conflict.status,'review');assert.equal(conflict.ledgerEntryId,null);
  const incomplete=await receive('incomplete',{...data(prefix+'F'),docNumber:null});
  assert.equal(incomplete.status,'review');
  const invalid=await receive('invalid',data(prefix+'G'),'peppol','Validation Peppol à vérifier.');
  assert.equal(invalid.status,'review');
});
test('legacy invoice without imported receipt is matched by supplier VAT without altering payments',async()=>{
  const row=await prisma.ledgerEntry.create({data:{direction:'purchase',docNumber:prefix+'LEGACY',contactId,supplierName:prefix,date:new Date('2026-10-15'),ht:100,ttc:121,paymentStatus:'Payé'}});
  ids.push(row.id);
  const receipt=await receive('legacy',data(prefix+'LEGACY'),'peppol');
  assert.equal(receipt.ledgerEntryId,row.id);
});
test('mapping uses original totals, distinguishes credit notes and rejects other companies and outgoing documents',()=>{
  const doc={id:'doc',companyId:'co',direction:'incoming',type:'invoice',xml:'<Invoice/>',validation:{result:'valid'},parsed:{invoiceNumber:'INV',issueDate:'2026-10-15',currency:'EUR',seller:{name:'Supplier',vatNumber:'BE0123456789'},totals:{taxExclusiveAmount:'100.00',taxInclusiveAmount:'121.00'}}};
  assert.equal(mapReceivedDocument(doc,'co').data.ttc,121);
  assert.equal(mapReceivedDocument({...doc,type:'creditNote',parsed:{...doc.parsed,creditNoteNumber:'NC'}},'co').data.direction,'credit_note');
  assert.throws(()=>mapReceivedDocument({...doc,direction:'outgoing'},'co'));
  assert.throws(()=>mapReceivedDocument(doc,'other'));
  assert.ok(mapReceivedDocument({...doc,parsed:{...doc.parsed,currency:'USD'}},'co').reason);
  assert.equal(mapReceivedDocument({...doc,parsed:{...doc.parsed,issueDate:'bad'}},'co').data.date,null);
});
test('activation refuses an unregistered receiver and disabled sync never calls the provider',async()=>{
  const old={...env.peppol};const oldFetch=globalThis.fetch;
  const setting=await prisma.setting.findUnique({where:{key:'peppolReception'}});
  try{
    Object.assign(env.peppol,{apiKey:'test',apiSecret:'test',companyId:'test',baseUrl:'https://test.invalid'});
    globalThis.fetch=async()=>new Response(JSON.stringify({company:{id:'test',isSmpRecipient:false,isVerified:true}}),{status:200});
    await assert.rejects(()=>setPeppolReception(true));
    await setPeppolReception(false);
    globalThis.fetch=async()=>{throw new Error('Must not call provider');};
    const r=await syncPeppolInbox() as {disabled?:boolean};
    assert.equal(r.disabled,true);
  }finally{
    Object.assign(env.peppol,old);globalThis.fetch=oldFetch;
    if(setting)await prisma.setting.update({where:{key:'peppolReception'},data:{value:setting.value!}});
    else await prisma.setting.deleteMany({where:{key:'peppolReception'}});
  }
});

test('provider polling archives invoice PDF/XML once, does not consume unarchived documents and surfaces malformed responses',async()=>{
  const old={...env.peppol},oldFetch=globalThis.fetch;
  const settings=await prisma.setting.findMany({where:{key:{in:['peppolReception','peppolReceptionLast']}}});
  const providerId=prefix+'-provider';
  const sourceRef='peppol:test:'+providerId;
  const contacts=await prisma.contact.findMany({where:{id:contactId}});
  let pdfCalls=0;
  try{
    Object.assign(env.peppol,{apiKey:'test',apiSecret:'test',companyId:'test',baseUrl:'https://test.invalid'});
    globalThis.fetch=async input=>{
      const url=String(input);
      if(url.includes('/companies/'))return new Response(JSON.stringify({company:{id:'test',isSmpRecipient:true,isVerified:true}}));
      if(url.includes('/documents?'))return new Response(JSON.stringify({documents:[{id:providerId}],pagination:{total:1}}));
      if(url.endsWith('/render/pdf')){pdfCalls++;return new Response('%PDF-1.4\nmock\n%%EOF');}
      if(url.endsWith('/documents/'+providerId))return new Response(JSON.stringify({document:{id:providerId,companyId:'test',direction:'incoming',type:'invoice',xml:'<Invoice/>',validation:{result:'valid'},parsed:{invoiceNumber:prefix+'PROVIDER',issueDate:'2026-10-15',currency:'EUR',seller:{name:prefix,vatNumber:contacts[0]!.vat},totals:{taxExclusiveAmount:'100.00',taxInclusiveAmount:'121.00'}}}}));
      throw new Error('Unexpected provider call: '+url);
    };
    await setPeppolReception(true);
    const first=await syncPeppolInbox() as {imported:number;errors:string[]};
    assert.equal(first.imported,1);assert.deepEqual(first.errors,[]);
    const receipt=await prisma.purchaseReceipt.findUniqueOrThrow({where:{sourceRef}});
    assert.ok(receipt.pdfPath);assert.ok(receipt.xmlPath);assert.ok(receipt.ledgerEntryId);
    ids.push(receipt.ledgerEntryId!);
    const second=await syncPeppolInbox() as {imported:number};
    assert.equal(second.imported,0);assert.equal(pdfCalls,1);
    globalThis.fetch=async()=>new Response('{}');
    const failure=await syncPeppolInbox() as {errors:string[]};
    assert.ok(failure.errors.length>0);
  }finally{
    Object.assign(env.peppol,old);globalThis.fetch=oldFetch;
    await prisma.purchaseReceipt.deleteMany({where:{sourceRef}});
    await prisma.setting.deleteMany({where:{key:{in:['peppolReception','peppolReceptionLast']}}});
    for(const setting of settings)await prisma.setting.create({data:{key:setting.key,value:setting.value!}});
  }
});
