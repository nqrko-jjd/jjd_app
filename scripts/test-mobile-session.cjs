const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('../apps/mobile/node_modules/typescript');
const js = ts.transpileModule(fs.readFileSync('apps/mobile/lib/session.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
class ApiError extends Error { constructor(status) {super('HTTP '+status);this.status=status;} }
function setup({reply,cache,token='A'}) {
  const state=[], effects=[], storage=new Map(cache ? [['jjd_session_cache',JSON.stringify(cache)]] : []);
  const react={createContext:()=>({Provider:'provider'}),useState:initial=>{const i=state.length;state.push(initial);return [initial,v=>{state[i]=v}]},useEffect:fn=>effects.push(fn)};
  const api={ApiError,storageKey:k=>k,getToken:async()=>token,setToken:async t=>{token=t},apiGet:reply};
  const context={exports:{},require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props})}:name==='./api'?api:{getItem:async k=>storage.get(k)??null,setItem:async(k,v)=>storage.set(k,v),removeItem:async k=>storage.delete(k)}};
  vm.runInNewContext(js,context);
  const component=context.exports.SessionProvider({children:null});
  effects.forEach(fn=>fn());
  return {state,session:component.props.value,token:()=>token};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('a late profile response cannot log the user back in after logout',async()=>{
  let resolve;const pending=new Promise(r=>{resolve=r});const x=setup({reply:()=>pending});
  await settle();await x.session.signOut();resolve({user:{id:'userA'},person:null});await settle();
  assert.equal(x.token(),null);assert.equal(x.state[0],null);
});
test('temporary failure restores only the matching cached session',async()=>{
  const x=setup({reply:async()=>{throw new TypeError('offline')},cache:{token:'A',user:{id:'userA'},person:{id:'personA'}}});
  await settle();assert.equal(x.state[0].id,'userA');assert.equal(x.state[1].id,'personA');assert.equal(x.token(),'A');assert.equal(x.state[2],false);
  const y=setup({reply:async()=>{throw new TypeError('offline')},cache:{token:'B',user:{id:'userB'},person:null}});
  await settle();assert.equal(y.state[0],null);
});
test('authentication rejection clears the session even when a cache exists',async()=>{
  const x=setup({reply:async()=>{throw new ApiError(401)},cache:{token:'A',user:{id:'userA'},person:null}});
  await settle();assert.equal(x.token(),null);assert.equal(x.state[0],null);
});
