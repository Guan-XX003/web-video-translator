// Injected only after an explicit extension action through activeTab.
(() => {
  if (globalThis.__speechWebObserver) { globalThis.__speechWebObserver.restart(); return; }
  let session = crypto.randomUUID();
  const ids = new WeakMap(), identities = new Map();
  let serial = 0, currentId = '', currentMedia = null, seenMedia = false, started = performance.now();
  function mediaElements(root = document) {
    const result = [...root.querySelectorAll('video,audio')];
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot) result.push(...mediaElements(node.shadowRoot));
    return result;
  }
  function active() {
    const candidates = mediaElements();
    const playing = candidates.filter(v => !v.paused && !v.ended && v.readyState > 0);
    playing.sort((a, b) => TKCore.visibleScore(b, innerWidth, innerHeight) - TKCore.visibleScore(a, innerWidth, innerHeight));
    const media = playing[0] || candidates.find(v => v === currentMedia);
    if (!media && seenMedia) return null;
    if (media) {
      seenMedia = true; currentMedia = media;
      if (!ids.has(media)) ids.set(media, ++serial);
      // Different source/SPA URL creates a new document-local identity; unrelated
      // players and sites cannot collide with TikTok IDs or archived transcripts.
      const identity = JSON.stringify([location.href, ids.get(media), media.currentSrc || media.src]);
      if (!identities.has(identity)) identities.set(identity, crypto.randomUUID());
      while (identities.size > 100) identities.delete(identities.keys().next().value);
      return {id: `web:${session}:${identities.get(identity)}`, url: location.href, title: document.title.slice(0, 500), author: '', site: location.hostname, kind: 'web', tracks: [], native: [],
        time: media.currentTime || 0, duration: Number.isFinite(media.duration) ? media.duration : 0,
        playing: !media.paused && !media.ended, playbackRate: media.playbackRate || 1, timeline: 'media'};
    }
    // Cross-origin iframes, closed shadow roots and Web Audio remain capturable
    // as tab audio, without requiring access to the embedded page.
    return {id: `web:${session}:tab`, url: location.href, title: document.title.slice(0, 500), author: '', site: location.hostname, kind: 'web', tracks: [], native: [],
      time: (performance.now() - started) / 1000, duration: 0, playing: true, playbackRate: 1, timeline: 'capture'};
  }
  function report() {
    const state = active();
    currentId = state?.id || '';
    chrome.runtime.sendMessage(state ? {type: 'VIDEO_STATE', video: state} : {type: 'VIDEO_IDLE'}).catch(() => {});
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'RESCAN') { report(); respond({ok: true}); }
    if (message.type === 'SEEK') {
      if (currentMedia && currentId === message.id) { currentMedia.currentTime = Math.max(0, Number(message.time) || 0); respond({ok: true}); }
      else respond({ok: false, error: '嵌入播放器只提供录音时间，无法跳转视频'});
    }
  });
  globalThis.__speechWebObserver = {report, restart() { session = crypto.randomUUID(); started = performance.now(); seenMedia = false; currentMedia = null; identities.clear(); report(); }};
  setInterval(report, 1000);
  for (const name of ['play', 'pause', 'seeked', 'ended', 'loadedmetadata']) document.addEventListener(name, report, true);
  report();
})();
