const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../extension/lib/core.js');

test('generic reports require explicit current-tab capture and top frame; navigation releases capture', async () => {
  const session = {}, local = {settings: {auto: false}}, events = {}, offscreen = [];
  const event = name => ({addListener: fn => events[name] = fn});
  const storage = data => ({get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])),
    set: async value => Object.assign(data, value), remove: async key => { delete data[key]; }, setAccessLevel: async () => {}});
  const chrome = {storage: {local: storage(local), session: storage(session)},
    runtime: {onInstalled: event('install'), onMessage: event('message'), getURL: p => 'chrome-extension://test/' + p,
      getContexts: async () => [{}], sendMessage: async message => { offscreen.push(message); return {ok: true}; }},
    tabs: {onRemoved: event('remove'), onUpdated: event('update'), sendMessage: async () => {}, create: async () => {}},
    action: {onClicked: event('action'), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}},
    sidePanel: {open: async () => {}}, tabCapture: {getMediaStreamId: async () => 'native-authorized-stream'},
    scripting: {executeScript: async () => {}}, offscreen: {createDocument: async () => {}}};
  const context = vm.createContext({chrome, TKCore: core, importScripts() {}, URL, URLSearchParams, AbortSignal, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const report = (tabId, frameId = 0, url = 'https://example.org/video') => new Promise(resolve => events.message({type: 'VIDEO_STATE',
    video: {id: 'web:one', kind: 'web', tracks: [{url: 'https://attacker.test/caption'}], native: [{text: 'untrusted'}], playing: true}},
    {tab: {id: tabId}, frameId, url}, resolve));
  await report(1); assert.equal(Object.keys(session.videos || {}).length, 0);
  await vm.runInContext("startCapture({id:1,url:'https://example.org/video'})", context);
  await report(2); await report(1, 2); assert.equal(Object.keys(session.videos || {}).length, 0);
  await report(1); assert.equal(session.videos[1].kind, 'web');
  assert.equal(session.videos[1].tracks.length, 0); assert.equal(session.videos[1].native.length, 0);
  await events.update(1, {status: 'loading'}); assert.equal(session.captureTab, null); assert.equal(Object.keys(session.videos).length, 0);
  assert.ok(offscreen.some(m => m.type === 'STOP'));
  await report(1); assert.equal(Object.keys(session.videos).length, 0);
});
