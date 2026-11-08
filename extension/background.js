importScripts('lib/core.js', 'lib/translation.js');
importScripts('portable-config.js');
const DEFAULTS = {auto: true, translate: true, token: '', language: 'auto', translationProvider: 'google', deepseekKey: '', deepseekURL: 'https://api.deepseek.com/chat/completions', deepseekModel: 'deepseek-flash', glossary: '', auddKey: ''};
const videos = new Map(), jobs = new Map(), translations = new Map();
let captureTab = null;
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  if (globalThis.TK_PORTABLE_TOKEN) {
    const stored = (await chrome.storage.local.get('settings')).settings || {};
    await chrome.storage.local.set({settings: {...DEFAULTS, ...stored, token: globalThis.TK_PORTABLE_TOKEN}});
  }
  const stored = await chrome.storage.session.get(['videos', 'captureTab']);
  Object.entries(stored.videos || {}).forEach(([id, v]) => videos.set(Number(id), v));
  captureTab = stored.captureTab ?? null;
})();
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install' && globalThis.TK_PORTABLE_TOKEN) {
    chrome.tabs.create({url: chrome.runtime.getURL('setup.html')});
  }
});
const settings = async () => ({...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings});
async function persist() { await chrome.storage.session.set({videos: Object.fromEntries(videos), captureTab}); }
async function offscreen(message) {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
  if (contexts.length) return chrome.runtime.sendMessage({target: 'offscreen', ...message});
}
async function fetchText(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(20000), credentials: 'omit'});
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
  const text = await response.text();
  if (text.length > 3000000) throw new Error('字幕文件过大');
  return text;
}
async function translateOne(text) {
  if (translations.has(text)) return translations.get(text);
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({client: 'gtx', sl: 'auto', tl: 'zh-CN', dt: 't', q: text});
  const data = JSON.parse(await fetchText(url.href));
  if (!Array.isArray(data?.[0])) throw new Error('翻译服务返回格式异常');
  const zh = data[0].map(x => x[0] || '').join('');
  if (!zh) throw new Error('翻译结果为空');
  translations.set(text, zh);
  if (translations.size > 1000) translations.delete(translations.keys().next().value);
  return zh;
}
async function translateRows(rows, stillCurrent, context = []) {
  const opts = await settings();
  if (opts.translationProvider === 'deepseek') {
    const output = await TKTranslation.translate(rows, {key: opts.deepseekKey, model: opts.deepseekModel, url: opts.deepseekURL, glossary: opts.glossary, context, stillCurrent});
    if (output && stillCurrent()) rows.forEach((row, i) => { row.zh = output[i]; });
    return rows;
  }
  let next = 0;
  await Promise.all(Array.from({length: Math.min(3, rows.length)}, async () => {
    while (next < rows.length && stillCurrent()) {
      const row = rows[next++];
      if (!row.zh) row.zh = await translateOne(row.text.slice(0, 3500));
    }
  }));
  return rows;
}
// Do not let slow network translation block capture or create unbounded requests.
let activeLiveTranslations = 0;
const liveTranslationQueue = [];
function enqueueLiveTranslation(task) {
  if (liveTranslationQueue.length >= 32) return Promise.reject(new Error('翻译队列已满，请稍后点击重新翻译'));
  return new Promise((resolve, reject) => {
    liveTranslationQueue.push({task, resolve, reject});
    pumpLiveTranslations();
  });
}
function pumpLiveTranslations() {
  while (activeLiveTranslations < 3 && liveTranslationQueue.length) {
    const entry = liveTranslationQueue.shift(); activeLiveTranslations++;
    Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => { activeLiveTranslations--; pumpLiveTranslations(); });
  }
}
async function archive(v) {
  if (!v.rows?.length) return;
  const {history = []} = await chrome.storage.local.get('history');
  await chrome.storage.local.set({history: [{...v, updated: Date.now()}, ...history.filter(x => x.id !== v.id)].slice(0, 20)});
}
function validVideo(v) {
  return v && typeof v.id === 'string' && v.id.length <= 2000 && Array.isArray(v.tracks) && v.tracks.length <= 100;
}
async function readCaptions(tabId, key, force = false) {
  const opts = await settings();
  if (!opts.auto && !force) return;
  if (jobs.get(tabId)?.key === key && !force) return;
  const job = {key}; jobs.set(tabId, job);
  const isCurrent = () => videos.get(tabId)?.id === key && jobs.get(tabId) === job;
  const state = videos.get(tabId);
  if (!state) return;
  if (state.rows?.length && state.source === '字幕' && !force) return;
  const hasCaptions = state.native?.length || state.tracks?.length;
  if (!hasCaptions) {
    if (force && state.rows?.length && opts.translate) {
      state.status = '正在重新翻译已识别文案…'; state.stage = 'translating'; await persist();
      try {
        await translateRows(state.rows, isCurrent);
        if (isCurrent()) { state.status = '文案翻译完成'; state.stage = 'done'; await persist(); await archive(state); }
      } catch (error) { if (isCurrent()) { state.status = `原文已保留；翻译失败：${error.message}`; state.stage = 'error'; await persist(); } }
      return;
    }
    state.status = captureTab === tabId ? '网页音频已授权，请播放并取消静音（每约 7 秒识别一次）' : '未发现字幕。点击浏览器工具栏中的插件图标，授权音频识别。';
    state.stage = 'waiting'; await persist(); return;
  }
  state.status = '正在提取视频字幕…'; state.stage = 'loading'; await persist();
  try {
    let rows = [];
    let captionLanguage = '';
    let captionSource = '';
    // Prefer source captions; Chinese translations on TikTok may be machine generated.
    const trackRank = track => (String(track.source).toUpperCase() === 'MT' ? 100 : 0) + (/^zh/i.test(track.lang) ? 10 : 0);
    const tracks = [...state.tracks].sort((a, b) => trackRank(a) - trackRank(b));
    let lastError;
    for (const track of tracks) {
      if (rows.length || !isCurrent()) break;
      const url = TKCore.captionURL(track.url);
      if (!url) continue;
      try {
        rows = TKCore.parseCaptions(await fetchText(url));
        if (rows.length) { captionLanguage = track.lang || ''; captionSource = track.source || ''; }
      } catch (error) { lastError = error; }
    }
    if (!isCurrent()) return;
    if (!rows.length) rows = TKCore.normalize(state.native || []);
    if (!rows.length) throw lastError || new Error('没有可读取的字幕');
    state.captionLanguage = captionLanguage; state.captionSource = captionSource;
    state.rows = TKCore.mergeSentences(rows).slice(0, 1500); state.source = '字幕'; state.stage = 'translating';
    state.status = opts.translate ? '字幕已提取，正在翻译…' : '字幕已提取'; await persist();
    await offscreen({type: 'VIDEO', tabId, video: {...state, needsASR: false}});
    if (opts.translate) await translateRows(state.rows, isCurrent);
    if (!isCurrent()) return;
    state.stage = 'done'; state.status = opts.translate ? '提取与翻译完成' : '原文已提取（在线翻译已关闭）'; await persist(); await archive(state);
  } catch (error) {
    if (!isCurrent()) return;
    state.stage = 'error'; state.status = state.rows?.length ? `原文已保留；翻译失败：${error.message}` : `字幕读取失败，可使用音频识别：${error.message}`;
    await persist();
    if (!state.rows?.length) await offscreen({type: 'VIDEO', tabId, video: {...state, needsASR: true}});
  }
}
async function startCapture(tab) {
  await ready;
  if (!tab?.id || !TKCore.webURL(tab.url)) throw new Error('请切换到普通 HTTP / HTTPS 视频网页；浏览器内部页无法捕获。');
  // Called directly from action.onClicked: Chrome requires an explicit extension action gesture.
  if (captureTab === tab.id) {
    await chrome.storage.session.remove('captureError');
    await chrome.tabs.sendMessage(tab.id, {type: 'RESCAN'}).catch(() => {});
    return;
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
  if (!(await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']})).length) {
    await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: '读取用户授权的当前网页标签页音频，交给本机离线语音识别服务'});
  }
  const opts = await settings();
  const response = await offscreen({type: 'START', streamId, tabId: tab.id, settings: opts});
  if (!response?.ok) throw new Error(response?.error || '音频授权失败');
  const previous = captureTab;
  captureTab = tab.id;
  if (previous != null && previous !== tab.id) await chrome.action.setBadgeText({text: '', tabId: previous}).catch(() => {});
  await chrome.storage.session.remove('captureError');
  if (!TKCore.isTikTok(tab.url)) {
    try {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['lib/core.js', 'generic-content.js']});
    } catch (error) {
      // Chrome internal/protected pages reject activeTab script access.
      await offscreen({type: 'STOP'}); captureTab = null; await persist();
      throw new Error('此网页不允许访问播放器，请换一个普通视频网页后重试。');
    }
  }
  const state = videos.get(tab.id);
  if (state && state.source !== '字幕') {
    state.stage = opts.token ? 'listening' : 'waiting';
    state.status = !opts.auto ? '自动跟随已关闭，可在设置中开启' : opts.token ? '音频已授权，正在聆听（每约 7 秒识别一次）' : '音频已授权，请在设置中填写本机服务配对码';
  }
  await persist();
  await chrome.action.setBadgeText({text: 'ON', tabId: tab.id});
  await chrome.action.setBadgeBackgroundColor({color: '#0b827b', tabId: tab.id});
  await chrome.tabs.sendMessage(tab.id, {type: 'RESCAN'}).catch(() => {});
}
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({tabId: tab.id}).catch(() => {});
  startCapture(tab).catch(async error => { await chrome.storage.session.set({captureError: error.message}); });
});
async function handle(message, sender) {
  await ready;
  if (message.type === 'VIDEO_STATE') {
    const tabId = sender.tab?.id;
    if (!tabId || sender.frameId !== 0 || !validVideo(message.video)) return;
    const tikTok = TKCore.isTikTok(sender.url);
    if (!tikTok && !(tabId === captureTab && TKCore.webURL(sender.url) && message.video.kind === 'web')) return;
    const v = {...message.video, url: sender.url, ...(tikTok ? {} : {tracks: [], native: []})}, old = videos.get(tabId), changed = old?.id !== v.id;
    const richer = !changed && ((!old?.tracks?.length && v.tracks.length > 0) || (!old?.native?.length && v.native?.length > 0));
    const next = changed ? {...v, rows: [], status: '已检测到视频', stage: 'waiting', source: ''} : Object.assign(old, v);
    videos.set(tabId, next);
    const opts = await settings();
    await offscreen({type: 'VIDEO', tabId, video: {...next, needsASR: opts.auto && !(next.source === '字幕' && next.rows.length)}});
    await persist();
    if (changed || richer || (!jobs.has(tabId) && !next.rows.length)) readCaptions(tabId, v.id, richer).catch(console.error);
    return {ok: true};
  }
  if (message.type === 'VIDEO_IDLE') {
    const tabId = sender.tab?.id;
    if (!tabId || sender.frameId !== 0 || (!TKCore.isTikTok(sender.url) && tabId !== captureTab)) return;
    await offscreen({type: 'VIDEO', tabId, video: null});
    if (videos.has(tabId)) { videos.get(tabId).playing = false; await persist(); }
    return;
  }
  // Privileged commands originate only in extension pages, never TikTok content scripts.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message.type === 'MUSIC_RECOGNIZE') {
    const current = videos.get(message.tabId);
    if (captureTab !== message.tabId || !current || current.id !== message.videoId) throw new Error('请先在当前视频网页点击插件图标授权音频');
    const opts = await settings();
    if (!opts.auddKey) throw new Error('请先在设置中填写并保存 AudD API Token');
    const result = await offscreen({type: 'MUSIC_RECOGNIZE', tabId: message.tabId, videoId: current.id, token: opts.auddKey});
    if (!result?.ok) throw new Error(result?.error || '音频识别未启动，请重新授权');
    if (videos.get(message.tabId)?.id !== current.id) throw new Error('视频已切换，请在当前视频重新识别');
    return {ok: true, music: result.music};
  }
  if (message.type === 'REWRITE') {
    const opts = await settings();
    const text = await TKTranslation.rewrite(message.text, {key: opts.deepseekKey, model: opts.deepseekModel, url: opts.deepseekURL, prompt: message.prompt});
    return {ok: true, text};
  }
  if (message.type === 'RETRY') {
    const v = videos.get(message.tabId);
    if (v?.rows?.length && (await settings()).translate) {
      const original = v.rows; const copy = original.map(r => ({...r, zh: ''}));
      const stillCurrent = () => videos.get(message.tabId) === v && v.rows === original;
      v.stage = 'translating'; v.status = '正在按当前设置重新翻译…'; await persist();
      try { await translateRows(copy, stillCurrent); if (stillCurrent()) { v.rows = copy; v.stage = 'done'; v.status = '重新翻译完成'; await persist(); await archive(v); } }
      catch (error) { if (stillCurrent()) { v.stage = 'error'; v.status = `原译文已保留；重新翻译失败：${error.message}`; await persist(); } }
    } else if (v) await readCaptions(message.tabId, v.id, true);
    return {ok: true};
  }
  if (message.type === 'STOP') {
    const previous = captureTab; await offscreen({type: 'STOP'}); captureTab = null;
    if (previous != null) await chrome.action.setBadgeText({text: '', tabId: previous}).catch(() => {});
    const stopped = videos.get(previous);
    if (stopped && stopped.source !== '字幕') { stopped.status = '音频识别已停止；再次点击插件图标可重新授权'; stopped.stage = 'done'; stopped.playing = false; }
    await persist(); return {ok: true};
  }
  if (message.type === 'CONFIG') {
    await offscreen({type: 'CONFIG', settings: await settings()});
    for (const [tabId, v] of videos) await offscreen({type: 'VIDEO', tabId, video: {...v, needsASR: (await settings()).auto && v.source !== '字幕'}});
    return {ok: true};
  }
  if (message.type === 'CAPTURE_ENDED') {
    if (captureTab != null) await chrome.action.setBadgeText({text: '', tabId: captureTab}).catch(() => {});
    captureTab = null; await persist(); return;
  }
  if (message.type === 'ASR_STATUS') {
    const v = videos.get(message.tabId);
    if (v?.id === message.videoId && v.source !== '字幕') { v.status = message.status; v.stage = message.stage || 'listening'; await persist(); }
    return;
  }
  if (message.type === 'ASR_RESULT') {
    const v = videos.get(message.tabId);
    if (v?.id !== message.videoId || v.source === '字幕') return;
    if (message.language) v.captionLanguage = message.language;
    const rows = TKCore.mergeSentences(message.rows || []).filter(r => !v.duration || r.start < v.duration).map(r => ({...r, end: v.duration ? Math.min(r.end, v.duration) : r.end})), opts = await settings();
    const stillCurrent = () => videos.get(message.tabId)?.id === v.id && videos.get(message.tabId)?.source !== '字幕';
    if (!stillCurrent()) return;
    const added = rows.filter(row => !v.rows.some(r => Math.abs(r.start - row.start) < 1.5 && r.text === row.text));
    const context = v.rows.slice(-3);
    v.rows = [...v.rows, ...added].sort((a, b) => a.start - b.start).slice(-1500); v.source = '本机语音';
    v.stage = 'listening'; v.status = opts.translate && added.length ? '原文已识别，正在翻译…' : '已识别播放片段，继续聆听中…';
    await persist(); await archive(v);
    if (opts.translate && added.length) {
      const pending = added.map(row => ({...row}));
      try {
        await enqueueLiveTranslation(() => stillCurrent() ? translateRows(pending, stillCurrent, context) : undefined);
        if (!stillCurrent()) return;
        for (let i = 0; i < added.length; i++) if (v.rows.includes(added[i]) && !added[i].zh) added[i].zh = pending[i].zh;
        v.stage = 'listening'; v.status = '已识别播放片段，继续聆听中…';
      } catch (error) { if (!stillCurrent()) return; v.stage = 'error'; v.status = `原文已保留；翻译失败：${error.message}`; }
      await persist(); await archive(v);
    }
    return;
  }
  if (message.type === 'CLEAR') { await offscreen({type: 'RESET'}); videos.clear(); jobs.clear(); await chrome.storage.local.remove(['history', 'rewrites']); await persist(); return {ok: true}; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === 'offscreen') return false;
  handle(message, sender).then(result => respond(result || {ok: true})).catch(error => respond({ok: false, error: error.message}));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  await ready; videos.delete(tabId); jobs.delete(tabId);
  if (captureTab === tabId) { await offscreen({type: 'STOP'}); captureTab = null; }
  await persist();
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url && change.status !== 'loading') return;
  await ready;
  const previous = videos.get(tabId);
  let leaving = false;
  try { leaving = !!change.url && !!previous?.url && new URL(change.url).origin !== new URL(previous.url).origin; } catch { leaving = true; }
  if (leaving || change.status === 'loading') {
    videos.delete(tabId); jobs.delete(tabId);
    await offscreen({type: 'VIDEO', tabId, video: null});
    if (captureTab === tabId) {
      await offscreen({type: 'STOP'}); captureTab = null;
      await chrome.action.setBadgeText({text: '', tabId}).catch(() => {});
    }
    await persist();
  }
});
