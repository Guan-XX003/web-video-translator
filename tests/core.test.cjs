const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/lib/core.js');

test('parse WebVTT settings, multiline markup and numeric entities', () => {
  const rows = core.parseCaptions('\uFEFFWEBVTT\n\n1\n00:00.100 --> 00:02.300 align:start\n<v Alex>Hello &amp; welcome</v>\nTry this.\n\n2\n00:02.500 --> 00:04.000\nSecond line\n');
  assert.deepEqual(rows, [{start:.1,end:2.3,text:'Hello & welcome\nTry this.'},{start:2.5,end:4,text:'Second line'}]);
});
test('parse SRT and TikTok creator-caption JSON milliseconds', () => {
  assert.equal(core.parseCaptions('1\n00:01:02,100 --> 00:01:04,200\nHello\n')[0].start,62.1);
  assert.deepEqual(core.parseCaptions(JSON.stringify({utterances:[{start_time:1500,end_time:2500,text:'hello'}]})),[{start:1.5,end:2.5,text:'hello'}]);
  assert.deepEqual(core.parseCaptions('not subtitles'),[]);
});
test('metadata associates captions with exact video IDs and rejects hostile hosts', () => {
  const a = '7422000000000000001', b = '7422000000000000002';
  const result = core.extractItems({feed:[{id:a,desc:'first',author:{uniqueId:'alice'},video:{subtitleInfos:[{Url:'https://v.tiktokcdn.com/caption/a',LanguageCodeName:'en'},{Url:'https://tiktokcdn.com.attacker.test/x'}]}},{id:b,desc:'second',video:{subtitleInfos:[{Url:'https://v.tiktok.com/caption/b'}]}}]});
  assert.equal(result[0].id,a); assert.equal(result[0].tracks.length,1); assert.equal(result[1].tracks[0].url,'https://v.tiktok.com/caption/b');
  for (const url of ['http://127.0.0.1/a','https://tiktokcdn.com.evil.test/a','javascript:alert(1)','https://tiktokcdn.com@evil.test/a']) assert.equal(core.captionURL(url),'');
});
test('visible playing player wins and hidden player is rejected', () => {
  const v = (paused,left,right) => ({paused,ended:false,getBoundingClientRect:()=>({left,right,top:0,bottom:600,width:right-left,height:600})});
  assert.ok(core.visibleScore(v(false,0,300),1000,800)>core.visibleScore(v(true,400,700),1000,800));
  assert.equal(core.visibleScore(v(false,1200,1500),1000,800),0);
});
test('Chinese SRT export keeps timestamps and original fallback', () => {
  assert.equal(core.exportSrt([{start:1.25,end:3,text:'hello',zh:'你好'},{start:3,end:4,text:'test'}]),'1\n00:00:01,250 --> 00:00:03,000\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\ntest\n');
});
test('16 kHz PCM WAV has correct duration, sizes, signed samples', () => {
  const input = new Float32Array(48000); input.fill(.5);
  const down = core.downsample(input,48000); assert.equal(down.length,16000);
  const buffer = core.wav(down), data = new DataView(buffer);
  assert.equal(Buffer.from(buffer).subarray(0,4).toString(),'RIFF'); assert.equal(data.getUint32(24,true),16000); assert.equal(data.getUint32(40,true),32000); assert.equal(data.getInt16(44,true),16383);
});

test('merge fragmented captions and ASR segments into complete translation sentences', () => {
  assert.deepEqual(core.mergeSentences([{start:0,end:2,text:'Leave your phone outside'},{start:2,end:4,text:'the bedroom.'},{start:4,end:6,text:'Then take a break.'}]),[{start:0,end:4,text:'Leave your phone outside the bedroom.'},{start:4,end:6,text:'Then take a break.'}]);
  assert.equal(core.mergeSentences([{start:0,end:1,text:'First'},{start:5,end:6,text:'Second'}]).length,2);
});

test('retain TikTok source provenance so original ASR can precede machine translations', () => {
  const [item] = core.extractItems({id:'7465431281766092050',video:{subtitleInfos:[{Url:'https://v.tiktokcdn.com/en',LanguageCodeName:'eng-US',Source:'MT'},{Url:'https://v.tiktokcdn.com/ar',LanguageCodeName:'ara-SA',Source:'ASR'}]}});
  assert.equal(item.tracks[0].source,'MT'); assert.equal(item.tracks[1].source,'ASR');
  assert.equal(core.parseCaptions('WEBVTT\n\n00:00:40.840 --> 00:00:42.5\nThanks\n')[0].end,42.5);
});

test('generic capture accepts ordinary web URLs and keeps TikTok detection exact', () => {
  for (const url of ['https://www.youtube.com/watch?v=abc','http://localhost:8123/player','https://example.org/video']) assert.equal(core.webURL(url),true);
  for (const url of ['chrome://settings','file:///C:/video.mp4','javascript:alert(1)','data:text/html,test','chrome-extension://abc/panel.html']) assert.equal(core.webURL(url),false);
  assert.equal(core.isTikTok('https://www.tiktok.com/@a/video/1'),true);
  assert.equal(core.isTikTok('https://www.tiktok.com.evil.test/video/1'),false);
  assert.equal(core.isTikTok('https://tiktok.com@evil.test/'),false);
});
