const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const ts=require('../apps/mobile/node_modules/typescript');
const js=ts.transpileModule(fs.readFileSync('apps/mobile/lib/VoiceNote.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function setup({permission=true,fail=false}={}) {
 const states=[],refs=[],alerts=[],uploads=[];let si=0,ri=0,sent=0;
 const recorder={uri:'file:///test.m4a',isRecording:false,prepareToRecordAsync:async()=>{},record(){this.isRecording=true},async stop(){this.isRecording=false}};
 const react={useState:x=>{const i=si++;if(!(i in states))states[i]=x;return[states[i],v=>states[i]=v]},useRef:x=>{const i=ri++;return refs[i]??(refs[i]={current:x})},useEffect:()=>{},useCallback:f=>f};
 const audio={useAudioRecorder:()=>recorder,useAudioRecorderState:()=>({isRecording:recorder.isRecording,durationMillis:3000}),RecordingPresets:{HIGH_QUALITY:{}},requestRecordingPermissionsAsync:async()=>({granted:permission}),setAudioModeAsync:async()=>{}};
 class Form {constructor(){this.items=[]}append(...x){this.items.push(x)}}
 const context={exports:{},console,setTimeout,clearTimeout,AbortController,AbortSignal:{},FormData:Form,fetch:async(url,init)=>{uploads.push({url,...init});return {ok:!fail}},require:n=>n==='react'?react:n==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'}:n==='react-native'?{View:'View',Pressable:'Pressable',Alert:{alert:(...x)=>alerts.push(x)},AppState:{addEventListener:()=>({remove(){}})}}:n==='expo-audio'?audio:n==='expo-router'?{useFocusEffect:()=>{}}:n==='@expo/vector-icons'?{Feather:'Feather'}:n==='./AppText'?{Text:'Text'}:n==='./api'?{API_URL:'https://isolated.invalid',getToken:async()=>'test-token'}:{T:{}}};
 vm.runInNewContext(js,context);
 function render(){si=0;ri=0;return context.exports.VoiceNote({endpoint:'/voice',onSent:()=>sent++})}
 function text(n){if(typeof n==='string')return n;if(Array.isArray(n))return n.map(text).join('');return n?.props?text(n.props.children):''}
 function find(n,label){if(!n)return;if(Array.isArray(n)){for(const x of n){const r=find(x,label);if(r)return r}}else if(n.props){if(n.type==='Pressable'&&text(n).includes(label))return n;return find(n.props.children,label)}}
 async function tap(label){const node=find(render(),label);assert.ok(node,label);await node.props.onPress()}
 return {tap,uploads,alerts,recorder,sent:()=>sent,setFail:v=>fail=v};
}
test('native voice uses supported abort API and sends authenticated audio',async()=>{
 const x=setup();await x.tap('Enregistrer');assert.equal(x.recorder.isRecording,true);await x.tap('Arrêter');await x.tap('Envoyer');
 assert.equal(x.uploads.length,1);assert.equal(x.uploads[0].headers.authorization,'Bearer test-token');assert.equal(x.uploads[0].body.items[0][1].type,'audio/mp4');assert.equal(x.sent(),1);
});
test('failed voice upload keeps draft and reuses request ID on retry',async()=>{
 const x=setup({fail:true});await x.tap('Enregistrer');await x.tap('Arrêter');await x.tap('Envoyer');assert.equal(x.sent(),0);assert.equal(x.alerts[0][0],'Note non envoyée');x.setFail(false);await x.tap('Envoyer');
 assert.equal(x.sent(),1);assert.equal(x.uploads[0].body.items[1][1],x.uploads[1].body.items[1][1]);
});
test('denied microphone permission does not start recording or upload',async()=>{
 const x=setup({permission:false});await x.tap('Enregistrer');assert.equal(x.recorder.isRecording,false);assert.equal(x.uploads.length,0);assert.equal(x.alerts[0][0],'Microphone désactivé');
});
