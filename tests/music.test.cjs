const test=require('node:test');const assert=require('node:assert/strict');const {RollingAudio,recognize}=require('../extension/lib/music.js');
test('rolling sample keeps only the latest authorized audio and clears on video change',()=>{
 const r=new RollingAudio(2,3);r.push(Float32Array.from([1,2,3,4]));r.push(Float32Array.from([5,6,7,8]));assert.deepEqual(Array.from(r.samples()),[3,4,5,6,7,8]);assert.equal(r.count,6);r.clear();assert.equal(r.count,0);assert.equal(r.samples().length,0);
});
test('music recognition sends short audio only on invocation and sanitizes song link',async()=>{
 let calls=0;
 const result=await recognize(new Uint8Array([1,2,3]),'test-token',async(url,request)=>{calls++;assert.equal(url,'https://api.audd.io/');assert.equal(request.method,'POST');assert.equal(request.redirect,'error');assert.equal(request.body.get('api_token'),'test-token');assert.equal(request.body.get('file').type,'audio/wav');return {ok:true,json:async()=>({status:'success',result:{title:'Song',artist:'Artist',song_link:'https://lis.tn/song'}})}});
 assert.equal(calls,1);assert.deepEqual(result,{title:'Song',artist:'Artist',url:'https://lis.tn/song'});
 const unsafe=await recognize(new Uint8Array([1]),'test',async()=>({ok:true,json:async()=>({status:'success',result:{title:'Song',artist:'A',song_link:'javascript:alert(1)'}})}));assert.equal(unsafe.url,'');
});
test('music recognition reports missing token, no match, provider errors',async()=>{
 await assert.rejects(recognize(new Uint8Array([1]),''),/Token/);
 assert.equal(await recognize(new Uint8Array([1]),'test',async()=>({ok:true,json:async()=>({status:'success',result:null})})),null);
 await assert.rejects(recognize(new Uint8Array([1]),'test',async()=>({ok:false,status:401})),/401/);
 await assert.rejects(recognize(new Uint8Array([1]),'test',async()=>({ok:true,json:async()=>({status:'error'})})),/失败/);
});
test('offscreen capture buffers locally and uploads only after authorized request for the same video',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),core=require('../extension/lib/core.js');
 let listener,processor,recognitions=0,release;
 const track={addEventListener(){},stop(){}};const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const connector=()=>({connect(){},disconnect(){}});
 class AudioContext {constructor(){this.sampleRate=16000;this.state='running';this.destination={};} async resume(){} async close(){this.state='closed';}createMediaStreamSource(){return connector();}createScriptProcessor(){processor=connector();return processor;}createGain(){return {...connector(),gain:{value:1}};}}
 const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async()=>({}),onMessage:{addListener:f=>listener=f}}};
 const music={RollingAudio,recognize:async()=>{recognitions++;return await new Promise(resolve=>{release=resolve})}};
 const sandbox=vm.createContext({chrome,TKCore:core,TKMusic:music,navigator:{mediaDevices:{getUserMedia:async()=>stream}},AudioContext,Float32Array,AbortController,setTimeout,clearTimeout,fetch:async()=>{throw Error('unexpected network')},console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/offscreen.js'),'utf8'),sandbox);
 const send=(message,url='chrome-extension://test/background.js')=>new Promise(resolve=>listener({target:'offscreen',...message},{url},resolve));
 assert.equal((await send({type:'START',tabId:8,streamId:'test',settings:{auto:false}})).ok,true);
 await send({type:'VIDEO',tabId:8,video:{id:'first',time:0,playing:true,needsASR:false,playbackRate:1}});
 const samples=new Float32Array(16000*6);samples.fill(0.25);processor.onaudioprocess({inputBuffer:{getChannelData:()=>samples}});assert.equal(recognitions,0);
 assert.equal((await send({type:'MUSIC_RECOGNIZE',tabId:8,videoId:'first',token:'test'},'https://www.tiktok.com/')).ok,false);assert.equal(recognitions,0);
 const pending=send({type:'MUSIC_RECOGNIZE',tabId:8,videoId:'first',token:'test'});while(!release)await new Promise(r=>setImmediate(r));assert.equal(recognitions,1);
 await send({type:'VIDEO',tabId:8,video:{id:'second',time:0,playing:true,needsASR:false,playbackRate:1}});release({title:'Old song'});
 const result=await pending;assert.equal(result.ok,false);assert.match(result.error,/视频已切换/);
 const tooShort=await send({type:'MUSIC_RECOGNIZE',tabId:8,videoId:'second',token:'test'});assert.equal(tooShort.ok,false);assert.match(tooShort.error,/至少 5 秒/);
});
