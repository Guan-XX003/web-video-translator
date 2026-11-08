const test = require('node:test');
const assert = require('node:assert/strict');
const {translate} = require('../extension/lib/translation.js');
test('context translation keeps segments aligned, groups long transcripts and carries context', async () => {
  const requests = [];
  const rows = Array.from({length: 10}, (_, i) => ({text: `line ${i}`}));
  const result = await translate(rows, {key: 'test-only-key', glossary: 'widget=小组件', context: [{text: 'earlier'}], fetcher: async (url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
    requests.push({url, input, auth: options.headers.Authorization});
    return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({translations: input.segments.map(x => `译 ${x}`)})}}]})};
  }});
  assert.deepEqual(result, rows.map(r => `译 ${r.text}`));
  assert.equal(requests.length, 2); assert.equal(requests[0].input.context, 'earlier');
  assert.match(requests[1].input.context, /line 7/); assert.equal(requests[0].input.glossary, 'widget=小组件');
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
});
test('missing key and malformed model output fail without applying translations', async () => {
  await assert.rejects(translate([{text: 'hello'}], {key: ''}), /API Key/);
  const rows = [{text: 'hello', zh: '旧译文'}];
  await assert.rejects(translate(rows, {key: 'x', fetcher: async () => ({ok: true, json: async () => ({choices: [{message: {content: '{"translations":[]}'}}]})})}), /数量不匹配/);
  assert.equal(rows[0].zh, '旧译文');
});
test('rewrite sends the full source and user preset, returns only the generated script', async () => {
  const {rewrite} = require('../extension/lib/translation.js');
  const result = await rewrite('Hello, this is the original speech.', {key:'test', model:'sample', prompt:'用轻松口吻改写', fetcher:async (url, req) => {
    const body=JSON.parse(req.body), user=JSON.parse(body.messages[1].content);
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(user.source_transcript, 'Hello, this is the original speech.');
    assert.equal(user.rewrite_instructions, '用轻松口吻改写');
    assert.match(body.messages[0].content, /不凭空编造/);
    return {ok:true,json:async()=>({choices:[{message:{content:'  大家好！  '},finish_reason:'stop'}]})};
  }});
  assert.equal(result,'大家好！');
});
test('rewrite rejects missing key, oversized inputs, truncated output and API failure', async () => {
  const {rewrite}=require('../extension/lib/translation.js');
  await assert.rejects(rewrite('source',{key:'',prompt:'x'}),/API Key/);
  await assert.rejects(rewrite('x'.repeat(30001),{key:'k',prompt:'x'}),/30000/);
  await assert.rejects(rewrite('source',{key:'k',prompt:'x',fetcher:async()=>({ok:false,status:401})}),/401/);
  await assert.rejects(rewrite('source',{key:'k',prompt:'x',fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'partial'}}]})})}),/截断/);
});
test('custom HTTPS endpoint accepts base URL and prevents redirect or unsafe URL', async () => {
 const {endpoint,translate,rewrite}=require('../extension/lib/translation.js');
 assert.equal(endpoint('https://gateway.example/v1'),'https://gateway.example/v1/chat/completions');
 assert.equal(endpoint('https://gateway.example/custom'),'https://gateway.example/custom');
 for(const v of ['http://example.com/v1','https://user:secret@example.com/','https://example.com/?token=secret','javascript:alert(1)']) assert.throws(()=>endpoint(v));
 let opts;
 await translate([{text:'hi'}],{key:'test',url:'https://gateway.example/v1',fetcher:async(url,o)=>{assert.equal(url,'https://gateway.example/v1/chat/completions');opts=o;return {ok:true,json:async()=>({choices:[{message:{content:'{"translations":["你好"]}'}}]})}}});
 assert.equal(opts.redirect,'error');
 await rewrite('hi',{key:'test',prompt:'translate',url:'https://gateway.example/v1',fetcher:async(url,o)=>{assert.equal(url,'https://gateway.example/v1/chat/completions');assert.equal(o.redirect,'error');return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'你好'}}]})}}});
});
