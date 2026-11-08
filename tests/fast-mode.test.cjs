const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const core=require('../extension/lib/core.js');
test('ASR publishes original immediately and independent translations cannot overwrite another video',async()=>{
 const session={},local={settings:{auto:true,translate:true,translationProvider:'deepseek',deepseekKey:'test'}};const events={};const pending=[];
 const e=n=>({addListener:f=>events[n]=f});const storage=data=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async x=>Object.assign(data,x),remove:async()=>{},setAccessLevel:async()=>{}});
 const chrome={storage:{local:storage(local),session:storage(session)},runtime:{onInstalled:e('install'),onMessage:e('message'),getURL:p=>'chrome-extension://test/'+p,getContexts:async()=>[],sendMessage:async()=>({})},tabs:{onRemoved:e('remove'),onUpdated:e('update')},action:{onClicked:e('action')},sidePanel:{}};
 const TKTranslation={translate:async rows=>await new Promise(resolve=>pending.push(()=>resolve(rows.map(r=>'译：'+r.text))))};
 const ctx=vm.createContext({chrome,TKCore:core,TKTranslation,importScripts(){},URL,URLSearchParams,AbortSignal,console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),ctx);await vm.runInContext('ready',ctx);
 vm.runInContext("videos.set(1,{id:'one',source:'',rows:[],duration:0})",ctx);
 const send=(id,text,start)=>ctx.handle({type:'ASR_RESULT',tabId:1,videoId:id,rows:[{start,end:start+1,text}]},{url:'chrome-extension://test/offscreen.html'});
 const first=send('one','first',0);while(pending.length<1)await new Promise(r=>setImmediate(r));
 assert.equal(session.videos[1].rows[0].text,'first');assert.equal(session.videos[1].rows[0].zh,undefined);
 const second=send('one','second',2);while(pending.length<2)await new Promise(r=>setImmediate(r));assert.equal(session.videos[1].rows.length,2);
 pending[1]();await second;pending[0]();await first;assert.deepEqual(Array.from(session.videos[1].rows,r=>r.zh),['译：first','译：second']);
 const third=send('one','third',4);while(pending.length<3)await new Promise(r=>setImmediate(r));vm.runInContext("videos.set(1,{id:'two',source:'',rows:[]})",ctx);pending[2]();await third;assert.equal(vm.runInContext('videos.get(1).rows.length',ctx),0);
});
test('live translation concurrency is limited and backlog is bounded',async()=>{
 const noop={addListener(){}};const storage={get:async()=>({}),set:async()=>{},setAccessLevel:async()=>{}};
 const chrome={storage:{local:storage,session:storage},runtime:{onInstalled:noop,onMessage:noop},tabs:{onRemoved:noop,onUpdated:noop},action:{onClicked:noop}};
 const ctx=vm.createContext({chrome,TKCore:core,importScripts(){},URL,URLSearchParams,AbortSignal,console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),ctx);await vm.runInContext('ready',ctx);
 const release=[];let active=0,max=0;const task=()=>new Promise(resolve=>{active++;max=Math.max(max,active);release.push(()=>{active--;resolve()})});
 const promises=Array.from({length:35},()=>ctx.enqueueLiveTranslation(task));
 await new Promise(r=>setImmediate(r)); assert.equal(max,3);await assert.rejects(ctx.enqueueLiveTranslation(task),/队列已满/);
 while(release.length||active){const f=release.shift();if(f)f();await new Promise(r=>setImmediate(r));}
 await Promise.all(promises);assert.equal(max,3);
});
