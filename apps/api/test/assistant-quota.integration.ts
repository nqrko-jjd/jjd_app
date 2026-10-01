import {test,before,after,beforeEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
// This suite runs only against the ephemeral DB created by scripts/test-assistant-quota.sh.
if(!process.env.DATABASE_URL?.includes('/jjd-ai-quota-test-'))throw new Error('Use the isolated quota test runner.');
process.env.ANTHROPIC_API_KEY='test-not-a-real-key';
const {prisma}=await import('../src/db.js');
const {assistantRouter,runTool}=await import('../src/routes/assistant.js');
const {attachUser,signToken}=await import('../src/lib/auth.js');
const {errorMiddleware}=await import('../src/lib/http.js');
const Q=await import('../src/lib/assistant-quota.js');
let server:ReturnType<ReturnType<typeof express>['listen']>,base:string;
let david:any,julien:any,melvina:any,worker:any,otherAdmin:any;
let paidCalls=0,behavior='normal';
const rate={model:'claude-test',inputUsdPerMillion:1,outputUsdPerMillion:2,eurPerUsd:1};
const config={enabled:true,globalMonthlyMicro:1_000_000,directionMonthlyMicro:500_000,pricing:rate};
const msgs=[{role:'user',content:'Où retrouver le chantier JJD ?'}];
const response=(text:string)=>({id:'fake',type:'message',role:'assistant',model:'claude-test',stop_reason:'end_turn',stop_sequence:null,content:[{type:'text',text}],usage:{input_tokens:100,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0}});
async function call(user:any,path:string,body?:unknown){return fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+signToken(user.id),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
before(async()=>{
 for(const [email,role] of [['david@jjd-consult.be','admin'],['julien@jjd-consult.be','admin'],['melvina@test.invalid','office'],['worker@test.invalid','worker'],['admin@test.invalid','admin']])await prisma.user.create({data:{email:email!,role:role!,passwordHash:'not-used'}});
 [david,julien,melvina,worker,otherAdmin]=await Promise.all(['david@jjd-consult.be','julien@jjd-consult.be','melvina@test.invalid','worker@test.invalid','admin@test.invalid'].map(email=>prisma.user.findUniqueOrThrow({where:{email}})));
 mock.method(Anthropic.Messages.prototype,'countTokens',async()=>({input_tokens:100}));
 mock.method(Anthropic.Messages.prototype,'create',async(args:any)=>{
  paidCalls++;await new Promise(r=>setTimeout(r,10));
  if(behavior==='timeout')throw new Error('simulated unknown provider outcome');
  if(args.system.startsWith('Classifie'))return response(behavior==='offtopic'?'HORS_SUJET':'JJD');
  if(behavior==='write-tool')return {...response(''),stop_reason:'tool_use',content:[{type:'tool_use',id:'bad',name:'create_task_draft',input:{title:'Forbidden'}}]};
  return response('Voici où consulter les informations du chantier JJD.');
 });
 const app=express();app.use(express.json());app.use(attachUser);app.use(assistantRouter);app.use(errorMiddleware);server=app.listen(0);await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(async()=>{paidCalls=0;behavior='normal';await prisma.setting.deleteMany({where:{key:{startsWith:'assistant:v1:'}}});await Q.saveConfig(david,config);});
after(async()=>{server?.close();mock.restoreAll();await prisma.$disconnect();});
test('Belgian calendar resets across month/year and both DST transitions',()=>{
 assert.equal(Q.periods(new Date('2026-03-28T23:30:00Z')).dailyResetAt,'2026-03-29T22:00:00.000Z');
 assert.equal(Q.periods(new Date('2026-10-24T22:30:00Z')).dailyResetAt,'2026-10-25T23:00:00.000Z');
 assert.equal(Q.periods(new Date('2026-12-31T20:00:00Z')).monthlyResetAt,'2026-12-31T23:00:00.000Z');
});
test('pilot rejects worker, Melvina and unrelated admins; legacy creation helper also denied',async()=>{
 for(const u of [worker,melvina,otherAdmin]){assert.equal((await (await call(u,'/status')).json()).previewAllowed,false);assert.equal((await call(u,'/chat',{requestId:randomUUID(),messages:msgs})).status,403);}
 await assert.rejects(()=>runTool('create_devis_draft',{lines:[]},melvina.id));
 await assert.rejects(()=>runTool('create_devis_draft',{lines:[]},david.id));assert.equal(paidCalls,0);
});
test('fail closed without explicit budgets, even if API key exists',async()=>{
 await Q.saveConfig(david,{...config,directionMonthlyMicro:0});assert.equal((await (await call(david,'/status')).json()).enabled,false);
 assert.equal((await call(david,'/chat',{requestId:randomUUID(),messages:msgs})).status,503);assert.equal(paidCalls,0);
});
test('actual classifier + answer usage billed; replay is free and changed payload rejected',async()=>{
 const id=randomUUID();const r=await call(david,'/chat',{requestId:id,messages:msgs});assert.equal(r.status,200);const data=await r.json();assert.equal(data.actions.length,0);assert.equal(data.quota.spentEuro,0.00028);assert.equal(paidCalls,2);
 assert.equal((await call(david,'/chat',{requestId:id,messages:msgs})).status,200);assert.equal(paidCalls,2);
 assert.equal((await call(david,'/chat',{requestId:id,messages:[{role:'user',content:'autre chantier'}]})).status,409);
});
test('simultaneous duplicate request and distinct turn cannot double spend',async()=>{
 const id=randomUUID();const results=await Promise.all([call(david,'/chat',{requestId:id,messages:msgs}),call(david,'/chat',{requestId:id,messages:msgs}),call(david,'/chat',{requestId:randomUUID(),messages:msgs})]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(paidCalls,2);assert.equal((await Q.quota(david)).reservedEuro,0);
});
test('shared global cap protects against concurrent different users',async()=>{
 await Q.saveConfig(david,{...config,globalMonthlyMicro:500});
 const results=await Promise.all([call(david,'/chat',{requestId:randomUUID(),messages:msgs}),call(julien,'/chat',{requestId:randomUUID(),messages:msgs})]);
 assert.ok(results.some(r=>r.status===429));assert.ok(paidCalls<=2);
 const row=await prisma.setting.findUniqueOrThrow({where:{key:`assistant:v1:global:${Q.periods().month}`}});const b:any=row.value;assert.ok(b.spent+b.reserved<=500);
});
test('timeout keeps conservative provision; replay does not retry paid call',async()=>{
 behavior='timeout';const id=randomUUID();assert.equal((await call(david,'/chat',{requestId:id,messages:msgs})).status,503);
 assert.equal((await Q.quota(david)).spentEuro,0.00044);assert.equal(paidCalls,1);
 assert.equal((await call(david,'/chat',{requestId:id,messages:msgs})).status,409);assert.equal(paidCalls,1);
});
test('off-topic rejected after only the metered classifier',async()=>{
 behavior='offtopic';const r=await call(david,'/chat',{requestId:randomUUID(),messages:[{role:'user',content:'Écris ma dissertation personnelle'}]});assert.equal(r.status,200);assert.match((await r.json()).reply,/uniquement/);assert.equal(paidCalls,1);
});
test('unexpected model write tool cannot create tasks',async()=>{
 behavior='write-tool';const before=await prisma.worksiteTask.count();const r=await call(david,'/chat',{requestId:randomUUID(),messages:msgs});assert.equal(r.status,200);assert.equal(await prisma.worksiteTask.count(),before);assert.equal(paidCalls,7);
});
test('direction has no daily 10-message limit, worker allowance is 1 euro/10 daily and grants expire by period',async()=>{
 const p=Q.periods();await prisma.setting.create({data:{key:`assistant:v1:day:${p.day}:${david.id}`,value:{requests:100,spent:0,reserved:0,extra:0,extraRequests:0}}});
 assert.equal((await call(david,'/chat',{requestId:randomUUID(),messages:msgs})).status,200);
 const w=await Q.quota(worker);assert.equal(w.monthlyLimitEuro,1);assert.equal(w.dailyRemaining,10);
 const id=randomUUID();await Q.grant(david,worker.id,id,500000,3);await Q.grant(david,worker.id,id,500000,3);
 assert.equal((await Q.quota(worker)).monthlyLimitEuro,1.5);assert.equal((await Q.quota(worker)).dailyRemaining,13);
 assert.equal((await Q.quota(worker,new Date('2030-01-01T12:00:00Z'))).monthlyLimitEuro,1);
 await assert.rejects(()=>Q.grant(julien,worker.id,randomUUID(),500000,0));
});
test('daily/monthly buckets do not reset on reconnection or new request id',async()=>{
 await call(david,'/chat',{requestId:randomUUID(),messages:msgs});const q=await Q.quota(david);assert.equal((await (await call(david,'/quota')).json()).spentEuro,q.spentEuro);
 await call(david,'/chat',{requestId:randomUUID(),messages:msgs});assert.equal((await Q.quota(david)).spentEuro,2*q.spentEuro);
});
