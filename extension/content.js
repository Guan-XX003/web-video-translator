(() => {
  const items = new Map();
  let current = '', lastReport = 0;
  function cache(incoming) {
    for (const item of incoming.slice(0, 100)) {
      if (!/^\d{10,30}$/.test(item.id)) continue;
      const old = items.get(item.id);
      items.set(item.id, {...item, tracks: item.tracks?.length ? item.tracks : old?.tracks || []});
    }
    while (items.size > 200) items.delete(items.keys().next().value);
  }
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'tk-zh-items-v1' && Array.isArray(event.data.items)) { cache(event.data.items); report(true); }
  });
  function scanJSON() {
    for (const selector of ['#__UNIVERSAL_DATA_FOR_REHYDRATION__', '#SIGI_STATE', 'script[type="application/json"]']) {
      document.querySelectorAll(selector).forEach(el => {
        try { cache(TKCore.extractItems(JSON.parse(el.textContent))); } catch { /* Other script. */ }
      });
    }
  }
  function active() {
    const video = [...document.querySelectorAll('video')].sort((a, b) => TKCore.visibleScore(b, innerWidth, innerHeight) - TKCore.visibleScore(a, innerWidth, innerHeight))[0];
    if (!video || !TKCore.visibleScore(video, innerWidth, innerHeight)) return null;
    // The visible player container takes precedence over the SPA URL, which can lag behind scrolling.
    let parent = video, id = '', link = '';
    for (let i = 0; parent && i < 9; i++, parent = parent.parentElement) {
      const anchors = [...parent.querySelectorAll('a[href*="/video/"]')];
      const ids = [...new Set(anchors.map(a => TKCore.videoId(a.href)).filter(Boolean))];
      if (ids.length === 1) { id = ids[0]; link = anchors.find(a => TKCore.videoId(a.href) === id).href; break; }
      if (ids.length > 1) break;
    }
    if (!id && video.currentSrc && !video.currentSrc.startsWith('blob:')) {
      const src = video.currentSrc.split('?')[0];
      const matches = [...items.values()].filter(item => (item.mediaURLs || []).some(url => url.split('?')[0] === src));
      if (matches.length === 1) id = matches[0].id;
    }
    id ||= TKCore.videoId(location.href);
    // An unknown player must not be assigned another video's captions.
    const key = id || `player:${video.currentSrc || video.src || location.pathname}`;
    const meta = items.get(id) || {id: key, url: link || location.href, title: '当前播放视频', author: '', tracks: []};
    const tracks = [...(meta.tracks || []), ...[...video.querySelectorAll('track')].map(t => ({url: TKCore.captionURL(t.src), lang: t.srclang || ''})).filter(t => t.url)];
    const native = [];
    try {
      for (const track of video.textTracks) if (track.cues?.length) {
        for (const cue of track.cues) native.push({start: cue.startTime, end: cue.endTime, text: cue.text});
        if (native.length) break;
      }
    } catch { /* Browser may not expose cues. */ }
    return {...meta, id: key, tracks, native, time: video.currentTime || 0, duration: Number.isFinite(video.duration) ? video.duration : 0, playing: !video.paused && !video.ended, muted: video.muted, playbackRate: video.playbackRate};
  }
  function report(force = false) {
    const state = active();
    if (!state) {
      if (current) { current = ''; chrome.runtime.sendMessage({type: 'VIDEO_IDLE'}).catch(() => {}); }
      return;
    }
    if (state.id !== current || force || Date.now() - lastReport > 900) {
      current = state.id; lastReport = Date.now();
      chrome.runtime.sendMessage({type: 'VIDEO_STATE', video: state}).catch(() => {});
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'RESCAN') { scanJSON(); report(true); respond({ok: true}); }
    if (message.type === 'SEEK') {
      const v = [...document.querySelectorAll('video')].sort((a, b) => TKCore.visibleScore(b, innerWidth, innerHeight) - TKCore.visibleScore(a, innerWidth, innerHeight))[0];
      if (v && active()?.id === message.id) { v.currentTime = Math.max(0, Number(message.time) || 0); respond({ok: true}); }
      else respond({ok: false});
    }
  });
  scanJSON(); report();
  setInterval(report, 1000);
  document.addEventListener('play', () => report(true), true);
  document.addEventListener('pause', () => report(true), true);
  document.addEventListener('seeked', () => report(true), true);
})();
