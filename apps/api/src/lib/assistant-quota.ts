/** Persistent AI budget ledger. Integer micro-euros; all changes serialized in the DB.
 * No schema change: namespaced Setting rows and one dedicated Counter lock.
 * Never delete unresolved reservations automatically: a timeout may still be billed.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from './http.js';
import type { AuthUser } from './auth.js';

export const EURO = 1_000_000;
export const isDirection = (u: Pick<AuthUser, 'email' | 'role'>) =>
  ['admin', 'office'].includes(u.role) && ['david@jjd-consult.be','julien@jjd-consult.be'].includes(u.email.toLowerCase());
export const isBudgetManager = (u: Pick<AuthUser, 'email' | 'role'>) => u.role === 'admin' && u.email.toLowerCase() === 'david@jjd-consult.be';
export function assertPilot(u: AuthUser) { if (!isDirection(u)) throw new HttpError(403, 'Compagnon est actuellement réservé à Julien et David.'); }
export type Pricing = { model: string; inputUsdPerMillion: number; outputUsdPerMillion: number; eurPerUsd: number };
export type Config = { enabled: boolean; globalMonthlyMicro: number; directionMonthlyMicro: number; pricing: Pricing | null };
const PREFIX='assistant:v1:';
async function currentPilot(tx:Tx,u:AuthUser){const row=await tx.user.findUnique({where:{id:u.id}});if(!row||!row.active||!isDirection(row as AuthUser))throw new HttpError(403,'Accès IA retiré.');}
const CONFIG=PREFIX+'config';
const defaults:Config={enabled:false,globalMonthlyMicro:0,directionMonthlyMicro:0,pricing:null};
type Bucket={spent:number;reserved:number;requests:number;extra:number;extraRequests:number};
const empty=():Bucket=>({spent:0,reserved:0,requests:0,extra:0,extraRequests:0});
type RequestRecord={userId:string;hash:string;status:'running'|'completed'|'failed';day:string;month:string;startedAt:string;reserved:number;spent:number;counted:boolean;pricing:Pricing;reply?:string};
type Tx=Prisma.TransactionClient;
async function get<T>(tx:Tx,key:string,fallback:T):Promise<T>{const r=await tx.setting.findUnique({where:{key:PREFIX+key}});return r?r.value as unknown as T:fallback;}
async function put(tx:Tx,key:string,value:unknown){await tx.setting.upsert({where:{key:PREFIX+key},create:{key:PREFIX+key,value:value as Prisma.InputJsonValue},update:{value:value as Prisma.InputJsonValue}});}
export async function atomic<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{
 for(let n=0;n<6;n++)try{return await prisma.$transaction(async tx=>{
  // A real row lock on PostgreSQL; a write lock on SQLite. No process-local mutex.
  await tx.counter.upsert({where:{name:PREFIX+'lock'},create:{name:PREFIX+'lock',value:0},update:{value:0}});
  return fn(tx);
 },{maxWait:10000,timeout:15000});}catch(e){
  if(n===5||!(e instanceof Prisma.PrismaClientKnownRequestError)||!['P2034','P2002','P1008','P2028'].includes(e.code))throw e;
  await new Promise(r=>setTimeout(r,20*(n+1)));
 }
 throw new Error('Quota transaction failed');
}
export function periods(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const day=`${p.year}-${p.month}-${p.day}`;
 function midnight(y:number,m:number,d:number){
  // Resolve Belgian local midnight using Intl offset, including DST transitions.
  let t=Date.UTC(y,m-1,d);
  for(let i=0;i<3;i++){
   const q=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
   t+=Date.UTC(y,m-1,d)-Date.UTC(+q.year!,+q.month!-1,+q.day!,+q.hour!,+q.minute!,+q.second!);
  }return new Date(t).toISOString();
 }
 const next=new Date(Date.UTC(+p.year!,+p.month!-1,+p.day!+1));
 const nextMonth=new Date(Date.UTC(+p.year!,+p.month!,1));
 return {day,month:day.slice(0,7),dailyResetAt:midnight(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate()),monthlyResetAt:midnight(nextMonth.getUTCFullYear(),nextMonth.getUTCMonth()+1,1)};
}
export async function configuration(tx:Tx=prisma):Promise<Config>{return get(tx,'config',defaults);}
export function cost(pricing:Pricing,input:number,output:number){
 if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)throw new Error('Invalid provider usage');
 const value=Math.ceil((input*pricing.inputUsdPerMillion+output*pricing.outputUsdPerMillion)*pricing.eurPerUsd);
 if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid provider cost');return value;
}
export function ready(c:Config){return c.enabled&&!!c.pricing&&c.globalMonthlyMicro>0&&c.directionMonthlyMicro>0;}
export async function quota(u:AuthUser,now=new Date(),tx:Tx=prisma){
 const p=periods(now), c=await configuration(tx), b=await get(tx,`month:${p.month}:${u.id}`,empty()),d=await get(tx,`day:${p.day}:${u.id}`,empty());
 const direction=isDirection(u),limit=(direction?c.directionMonthlyMicro:EURO)+b.extra;
 return {direction,allowed:isDirection(u),enabled:ready(c),monthlyLimitEuro:limit?limit/EURO:null,spentEuro:b.spent/EURO,reservedEuro:b.reserved/EURO,
  remainingPercent:limit?Math.max(0,Math.floor((limit-b.spent-b.reserved)*100/limit)):null,
  dailyLimit:direction?null:10+d.extraRequests,dailyRemaining:direction?null:Math.max(0,10+d.extraRequests-d.requests),...p};
}
export async function begin(u:AuthUser,id:string,messages:unknown,now=new Date()){
 assertPilot(u);const hash=createHash('sha256').update(JSON.stringify(messages)).digest('hex');
 return atomic(async tx=>{
  await currentPilot(tx,u);
  const key=`request:${u.id}:${id}`,old=await get<RequestRecord|null>(tx,key,null);
  if(old){if(old.hash!==hash)throw new HttpError(409,'Identifiant de demande déjà utilisé pour un autre message.');
   if(old.status==='completed')return {replay:true,reply:old.reply!};
   throw new HttpError(409,'Cette demande a déjà été prise en charge. Consulte son état avant de réessayer.');}
  const c=await configuration(tx);if(!ready(c))throw new HttpError(503,'IA en attente d’activation : budgets direction/global et tarifs à confirmer.');
  const active=await get<{until:number}|null>(tx,`active:${u.id}`,null);
  if(active&&active.until>now.getTime())throw new HttpError(429,'Une demande IA est déjà en cours.');
  const p=periods(now);
  await put(tx,key,{userId:u.id,hash,status:'running',day:p.day,month:p.month,startedAt:now.toISOString(),reserved:0,spent:0,counted:false,pricing:c.pricing});
  await put(tx,`active:${u.id}`,{id,until:now.getTime()+10*60*1000});
  return {replay:false,pricing:c.pricing!};
 });
}
export async function reserve(u:AuthUser,id:string,amount:number){
 assertPilot(u);if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Invalid reservation');
 return atomic(async tx=>{
  await currentPilot(tx,u);
  const key=`request:${u.id}:${id}`,r=await get<RequestRecord|null>(tx,key,null);if(!r||r.status!=='running'||r.reserved)throw new HttpError(409,'Demande indisponible.');
  const c=await configuration(tx);if(!ready(c))throw new HttpError(503,'IA désactivée.');
  // Charge the period in which the paid call starts, even if a multi-round turn crosses midnight.
  const p=periods(),mk=`month:${p.month}:${u.id}`,gk=`global:${p.month}`,dk=`day:${p.day}:${u.id}`;
  const b=await get(tx,mk,empty()),g=await get(tx,gk,empty()),d=await get(tx,dk,empty());
  const limit=(isDirection(u)?c.directionMonthlyMicro:EURO)+b.extra;
  if(b.spent+b.reserved+amount>limit||g.spent+g.reserved+amount>c.globalMonthlyMicro)throw new HttpError(429,'Crédit insuffisant pour cette demande. Demande une rallonge ou attends le renouvellement.');
  if(!isDirection(u)&&!r.counted&&d.requests>=10+d.extraRequests)throw new HttpError(429,'Quota quotidien atteint.');
  b.reserved+=amount;g.reserved+=amount;if(!r.counted)d.requests++;
  r.reserved=amount;r.counted=true;r.day=p.day;r.month=p.month;
  await put(tx,mk,b);await put(tx,gk,g);await put(tx,dk,d);await put(tx,key,r);
 });
}
export async function settle(u:AuthUser,id:string,amount:number|null){
 return atomic(async tx=>{
  const key=`request:${u.id}:${id}`,r=await get<RequestRecord|null>(tx,key,null);if(!r||!r.reserved)return;
  // Unknown provider outcome keeps the full provision. No automatic refund after timeouts.
  const billed=amount===null?r.reserved:amount;
  if(!Number.isSafeInteger(billed)||billed<0)throw new Error('Invalid settlement');
  const mk=`month:${r.month}:${u.id}`,gk=`global:${r.month}`;
  for(const k of [mk,gk]){const b=await get(tx,k,empty());b.reserved-=r.reserved;b.spent+=billed;await put(tx,k,b);}
  if(billed>r.reserved){const c=await configuration(tx);await put(tx,'config',{...c,enabled:false});}
  await tx.auditLog.create({data:{actorId:u.id,action:amount===null?'assistant.cost.provision':'assistant.cost.settled',entity:'AssistantRequest',entityId:id,meta:{microEuro:billed,reservedMicro:r.reserved,model:r.pricing.model}}});
  r.spent+=billed;r.reserved=0;await put(tx,key,r);
 });
}
export async function finish(u:AuthUser,id:string,reply?:string){
 return atomic(async tx=>{const key=`request:${u.id}:${id}`,r=await get<RequestRecord|null>(tx,key,null);if(!r)return;
  r.status=reply===undefined?'failed':'completed';if(reply!==undefined)r.reply=reply;await put(tx,key,r);
  const active=await get<{id:string}|null>(tx,`active:${u.id}`,null);if(active?.id===id)await tx.setting.delete({where:{key:PREFIX+`active:${u.id}`}});
 });
}
export async function saveConfig(u:AuthUser,value:Config){
 if(!isBudgetManager(u))throw new HttpError(403,'Réservé à David.');
 await atomic(async tx=>{await put(tx,'config',value);await tx.auditLog.create({data:{actorId:u.id,action:'assistant.budget.config',entity:'AssistantBudget',meta:value as unknown as Prisma.InputJsonValue}});});
}
export async function grant(u:AuthUser,target:string,id:string,extraMicro:number,extraRequests:number){
 if(!isBudgetManager(u))throw new HttpError(403,'Réservé à David.');
 await atomic(async tx=>{if(await get(tx,`grant:${id}`,false))return;
  if(!await tx.user.findUnique({where:{id:target}}))throw new HttpError(404,'Utilisateur introuvable.');
  const p=periods(),mk=`month:${p.month}:${target}`,dk=`day:${p.day}:${target}`,b=await get(tx,mk,empty()),d=await get(tx,dk,empty());
  b.extra+=extraMicro;d.extraRequests+=extraRequests;await put(tx,mk,b);await put(tx,dk,d);await put(tx,`grant:${id}`,true);
  await tx.auditLog.create({data:{actorId:u.id,action:'assistant.budget.grant',entity:'User',entityId:target,meta:{extraMicro,extraRequests,...p}}});});
}
