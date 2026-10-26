const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../extension/lib/core.js');
const script = fs.readFileSync(require('node:path').join(__dirname, '../extension/generic-content.js'), 'utf8');

function observer() {
  let media = [], tick, listener, uuid = 0, now = 1000;
  const reports = [];
  const context = vm.createContext({TKCore: core, crypto: {randomUUID: () => String(++uuid)},
    performance: {now: () => now}, location: {href: 'https://example.org/watch/one', hostname: 'example.org'},
    document: {title: 'A lesson', querySelectorAll: selector => selector === 'video,audio' ? media : [], addEventListener() {}},
    innerWidth: 1000, innerHeight: 800, setInterval: fn => tick = fn,
    chrome: {runtime: {sendMessage: async msg => { reports.push(msg); }, onMessage: {addListener: fn => listener = fn}}}});
  vm.runInContext(script, context);
  return {context, reports, setMedia: value => media = value, tick: () => tick(), advance: ms => now += ms,
    seek: (id, time) => { let result; listener({type: 'SEEK', id, time}, {}, r => result = r); return result; },
    last: () => reports.at(-1).video};
}
const player = () => ({paused: false, ended: false, readyState: 4, currentTime: 10, duration: 60, playbackRate: 1,
  currentSrc: 'https://cdn.example.org/one.mp4', getBoundingClientRect: () => ({left: 0, right: 600, top: 0, bottom: 400, width: 600, height: 400})});

test('generic observer isolates sources and SPA videos, preserves paused media and supports seek', () => {
  const o = observer(), v = player(); o.setMedia([v]); o.tick();
  const first = o.last().id;
  assert.equal(o.last().timeline, 'media'); assert.equal(o.last().playing, true);
  v.paused = true; o.tick(); assert.equal(o.last().id, first); assert.equal(o.last().playing, false);
  assert.equal(o.seek(first, 22).ok, true); assert.equal(v.currentTime, 22);
  v.currentSrc = 'https://cdn.example.org/two.mp4'; o.tick(); assert.notEqual(o.last().id, first);
  const second = o.last().id; o.context.location.href = 'https://example.org/watch/two'; o.tick(); assert.notEqual(o.last().id, second);
  o.setMedia([]); o.tick(); assert.equal(o.reports.at(-1).type, 'VIDEO_IDLE');
});

test('inaccessible embedded player uses elapsed recording time, cannot seek, and reauthorization starts fresh', () => {
  const o = observer(), first = o.last().id;
  o.advance(2500); o.tick(); assert.equal(o.last().timeline, 'capture'); assert.equal(o.last().time, 2.5);
  assert.equal(o.seek(first, 20).ok, false);
  vm.runInContext(script, o.context);
  assert.notEqual(o.last().id, first); assert.equal(o.last().time, 0);
  assert.equal(o.last().kind, 'web'); assert.equal(o.last().tracks.length, 0);
});
