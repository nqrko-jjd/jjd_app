const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('../apps/mobile/node_modules/typescript');
function compiled(file) { return ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText; }
const js = compiled('apps/mobile/lib/api.ts');
function setup(data = new Map()) {
  const requests = []; let reply = async () => { throw new TypeError('offline'); };
  const storage = {getItem:async k=>data.get(k)??null,setItem:async(k,v)=>data.set(k,v),removeItem:async k=>data.delete(k)};
  const context = {exports:{}, process:{env:{}}, __DEV__:false, console, TypeError, Error, Date, Math, JSON, AbortController, setTimeout, clearTimeout,
    require:name=> name==='expo-constants'?{expoConfig:{extra:{apiUrl:'https://test.invalid'}}}:storage,
    fetch:async(url,options)=>{ requests.push({url,options}); return reply(url,options); }};
  vm.runInNewContext(js,context);
  return {api:context.exports,data,requests,reply:fn=>{reply=fn},status:code=>{reply=async()=>({ok:code===200,status:code,text:async()=>JSON.stringify(code===200?{ok:true}:{error:'Server '+code})})}};
}
const start = {worksiteId:'site',startedAt:'2026-10-18T06:00:00.000Z'};
async function queued() { const x=setup();await x.api.setToken('A','userA');await x.api.apiSend('/api/timesheet/timer/start','POST',start);return x; }
test('500/401/403/409/429 preserve action and expose the failure', async()=>{
  for(const code of [500,401,403,409,429]) {const x=await queued();x.status(code);assert.equal(await x.api.flushQueue(),0);assert.equal(await x.api.pendingCount(),1);assert.match((await x.api.queueStatus()).error,/Server/);}
});
test('another account cannot replay or inspect pending actions; same user new token can',async()=>{
  const x=await queued();await x.api.setToken(null);await x.api.setToken('B','userB');x.status(200);const n=x.requests.length;
  assert.equal(await x.api.flushQueue(),0);assert.equal(x.requests.length,n);assert.equal(await x.api.pendingCount(),0);
  await x.api.setToken('A-renewed','userA');assert.equal(await x.api.flushQueue(),1);assert.equal(x.requests.at(-1).options.headers.authorization,'Bearer A-renewed');
});
test('pending stop cannot overtake start and retry keeps operation ID',async()=>{
  const x=await queued();const first=JSON.parse(x.requests[0].options.body).operationId;x.status(200);
  await x.api.apiSend('/api/timesheet/timer/stop','POST',{endedAt:'2026-10-18T08:00:00Z'});
  assert.deepEqual(x.requests.slice(1).map(r=>r.url.split('/').at(-1)),['start','stop']);
  assert.equal(JSON.parse(x.requests[1].options.body).operationId,first);assert.equal(await x.api.pendingCount(),0);
});
test('parallel enqueue and flush lose no entries',async()=>{
  const x=await queued();await Promise.all([x.api.flushQueue(),...Array.from({length:8},(_,i)=>x.api.apiSend('/pending/'+i,'POST',{i}))]);
  assert.equal(await x.api.pendingCount(),9);x.status(200);assert.equal(await x.api.flushQueue(),9);
});
test('restart restores queue, owner and original timestamps',async()=>{
  const x=await queued();const y=setup(x.data);assert.equal(await y.api.pendingCount(),1);y.status(200);await y.api.flushQueue();assert.equal(JSON.parse(y.requests[0].options.body).startedAt,start.startedAt);
});
test('unowned legacy queue retained without transmission or guessed ownership',async()=>{
  const x=setup(new Map([['jjd_offline_queue',JSON.stringify([{id:'old',path:'/old',method:'POST'}])]]));await x.api.setToken('A','userA');x.status(200);await x.api.flushQueue();assert.equal(x.requests.length,0);assert.equal((await x.api.queueStatus()).legacyCount,1);
});
test('account switch during replay does not send following action',async()=>{
  const x=await queued();await x.api.apiSend('/second','POST',{});x.reply(async()=>{await x.api.setToken('B','userB');return {ok:true,status:200,text:async()=>'{}'};});const n=x.requests.length;
  assert.equal(await x.api.flushQueue(),1);assert.equal(x.requests.length,n+1);assert.equal(x.requests.at(-1).options.headers.authorization,'Bearer A');await x.api.setToken('A','userA');assert.equal(await x.api.pendingCount(),1);
});
test('malformed server response is retained',async()=>{const x=await queued();x.reply(async()=>({ok:false,status:502,text:async()=>'<html>offline</html>'}));await x.api.flushQueue();assert.equal(await x.api.pendingCount(),1);});
test('fresh explicit validation rejection reaches the form without a phantom timer',async()=>{
  const x=setup();await x.api.setToken('A','userA');x.status(409);
  await assert.rejects(x.api.apiSend('/api/timesheet/timer/start','POST',start),/Server 409/);
  assert.equal(await x.api.pendingCount(),0);
});
test('offline timer projection survives start, navigation and stop',()=>{
  const c={exports:{}};vm.runInNewContext(compiled('apps/mobile/lib/timer-state.ts'),c);
  const q=[{id:'one',path:'/api/timesheet/timer/start',body:start}];const events=[{worksite:{id:'site',ref:'R-TEST',title:'Test'}}];
  const timer=c.exports.projectTimer(null,q,events);assert.equal(timer.startedAt,start.startedAt);assert.equal(timer.worksite.ref,'R-TEST');
  assert.equal(c.exports.projectTimer(timer,[...q,{id:'two',path:'/api/timesheet/timer/stop'}],events),null);
});

test('demo and team cannot share tokens or offline entries, even with the same user id',async()=>{
  const x=await queued();
  await assert.rejects(x.api.selectEnvironment(true),/Déconnectez/);
  await x.api.setToken(null);
  await x.api.selectEnvironment(true);
  assert.equal(await x.api.getToken(),null);
  await x.api.setToken('demo-token','userA');
  assert.equal(await x.api.pendingCount(),0);
  await x.api.apiSend('/demo-action','POST',{});
  assert.equal(x.requests.at(-1).url,'https://new.jjd-consult.be/jjd-demo-api/demo-action');
  const y=setup(x.data);
  assert.equal(await y.api.getToken(),'demo-token');
  assert.equal(y.api.isDemoEnvironment(),true);
  await y.api.setToken(null);await y.api.selectEnvironment(false);
  await y.api.setToken('team-new','userA');
  assert.equal(await y.api.pendingCount(),1);
  y.status(200);await y.api.flushQueue();
  assert.equal(y.requests[0].url,'https://test.invalid/api/timesheet/timer/start');
  assert.equal(y.requests.length,1);
});
