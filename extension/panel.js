const $ = id => document.getElementById(id);
let current = null, currentTab = null, view = 'bilingual', saved = {}, renderedKey = '', toastTimer, historyChoice = '', historySignature = '';
const send = message => chrome.runtime.sendMessage(message);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3200); }
function showSettings(show) { $('settings').hidden = !show; $('workspace').hidden = show; $('actions').hidden = show; document.body.classList.toggle('settingsOpen', show); $('settingsToggle').setAttribute('aria-expanded', String(show)); }
async function loadSettings() {
  saved = {auto: true, translate: true, token: '', language: 'auto', translationProvider: 'google', deepseekKey: '', deepseekURL: 'https://api.deepseek.com/chat/completions', deepseekModel: 'deepseek-flash', glossary: '', auddKey: '', ...(await chrome.storage.local.get('settings')).settings};
  document.querySelector('footer p').textContent = `本机识别 · ${saved.translate ? '在线翻译' : '仅提取原文'} · 最近 20 条保存在此设备`;
  $('auddKey').value = saved.auddKey; $('auto').checked = saved.auto; $('translate').checked = saved.translate; $('token').value = saved.token; $('language').value = saved.language;
  $('translationProvider').value = saved.translationProvider; $('deepseekKey').value = saved.deepseekKey; $('deepseekURL').value = saved.deepseekURL; $('deepseekModel').value = saved.deepseekModel; $('glossary').value = saved.glossary; $('deepseekSettings').hidden = false;
  $('autoState').textContent = saved.auto ? '自动跟随' : '自动已关闭'; $('autoDot').style.background = saved.auto ? '' : '#bcc5c1';
}
async function saveSettings(requestAccess = false) {
  let deepseekURL = saved.deepseekURL;
  if (requestAccess) {
    try {
      deepseekURL = TKTranslation.endpoint($('deepseekURL').value.trim());
      const parsed = new URL(deepseekURL);
      if (parsed.hostname !== 'api.deepseek.com') {
        const granted = await chrome.permissions.request({origins: [`https://${parsed.hostname}/*`]});
        if (!granted) { toast('未授权此地址，设置未保存'); return; }
      }
    } catch (error) { toast(error.message || '地址无效或授权失败'); return; }
  }
  await chrome.storage.local.set({settings: {auto: $('auto').checked, translate: $('translate').checked, token: $('token').value.trim(), language: $('language').value, translationProvider: $('translationProvider').value, deepseekKey: $('deepseekKey').value.trim(), deepseekURL, deepseekModel: $('deepseekModel').value.trim() || 'deepseek-flash', glossary: $('glossary').value.trim(), auddKey: saved.auddKey}});
  await send({type: 'CONFIG'}); await loadSettings(); toast('设置已保存');
}
function renderRows(force = false) {
  const rows = current?.rows || [];
  const rewriting = view === 'rewrite';
  $('rewritePanel').hidden = !rewriting;
  document.querySelector('.transcriptHeading').hidden = rewriting;
  $('transcript').hidden = rewriting;
  $('followRow').hidden = rewriting || !rows.length || !!historyChoice;
  const srt = $('format').querySelector('option[value="srt"]'); srt.disabled = rewriting;
  if (rewriting && $('format').value === 'srt') $('format').value = 'txt';
  if (rewriting) { renderRewrite(); return; }
  const key = `${current?.id}|${view}|${JSON.stringify(rows)}`;
  if (key === renderedKey && !force) { highlight(); return; }
  renderedKey = key;
  if (rows.length) {
    $('transcript').replaceChildren(...rows.map(row => {
      const div = document.createElement('div'); div.className = 'cue'; div.dataset.start = row.start; div.dataset.end = row.end;
      const time = document.createElement('button'); time.className = 'time'; time.textContent = TKCore.timecode(row.start).slice(3, 8); time.title = '跳转到此句'; time.setAttribute('aria-label', `跳转到 ${time.textContent} 的口播`);
      time.disabled = current?.timeline === 'capture';
      time.title = time.disabled ? '本次授权后的录音时间，无法跳转嵌入视频' : '跳转到此句';
      time.onclick = () => { if (historyChoice) { toast('请先打开这条记录对应的视频'); return; } if (currentTab != null) chrome.tabs.sendMessage(currentTab, {type: 'SEEK', id: current.id, time: row.start}).then(result => { if (!result?.ok) toast('此播放器无法按时间跳转'); }).catch(() => toast('请重新点击插件图标授权后重试')); };
      const content = document.createElement('div'); content.className = 'cueText';
      if (view !== 'zh') { const p = document.createElement('p'); p.className = 'original'; p.dir = 'auto'; p.textContent = row.text; content.append(p); }
      if (view !== 'original') { const p = document.createElement('p'); p.className = row.zh ? 'zh' : 'pending'; p.textContent = row.zh || (saved.translate ? '等待翻译 / 可重新翻译' : '在线翻译已关闭'); content.append(p); }
      div.append(time, content); return div;
    }));
  } else {
    $('transcript').innerHTML = '<div class="empty"><div class="emptyGlyph">“</div><h3>让口播变成可用的文案</h3><p>优先提取视频字幕<br>没有字幕，也能在本机听写</p></div>';
  }
  $('rowCount').textContent = rows.length ? `${rows.length} 段` : '等待读取';
  $('transcript').dataset.view = view;
  $('copy').disabled = !(view === 'original' ? rows.length : rows.some(r => r.zh));
  $('copyLabel').textContent = view === 'original' ? '复制原文文案' : view === 'bilingual' ? '复制双语文案' : '复制中文文案';
  $('export').disabled = !rows.length; $('followRow').hidden = !rows.length || !!historyChoice;
  document.querySelector('#followRow span').textContent = current?.timeline === 'capture' ? '时间为本次授权后的录音时间' : '点击时间可跳转视频';
  highlight();
}
function highlight() {
  for (const el of $('transcript').querySelectorAll('.cue')) el.classList.toggle('active', !historyChoice && current?.time >= Number(el.dataset.start) && current?.time < Number(el.dataset.end));
}
async function refresh() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true}); currentTab = tabs[0]?.id;
  const state = await chrome.storage.session.get(['videos', 'captureTab', 'captureError']);
  const {history = []} = await chrome.storage.local.get('history');
  const signature = history.map(v => `${v.id}:${v.updated}`).join('|');
  if (signature !== historySignature) {
    historySignature = signature;
    const option = document.createElement('option'); option.value = ''; option.textContent = '跟随当前视频';
    $('historySelect').replaceChildren(option, ...history.map(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = `${v.author ? '@' + v.author : '视频'} · ${v.title || v.rows?.[0]?.text || v.id}`; return o; }));
    if (!history.some(v => v.id === historyChoice)) historyChoice = '';
    $('historySelect').value = historyChoice;
  }
  current = historyChoice ? history.find(v => v.id === historyChoice) || null : state.videos?.[currentTab] || null;
  currentCapturing = state.captureTab === currentTab;
  if (musicVideoId !== current?.id) { musicVideoId = current?.id; musicSequence++; musicBusy = false; $('musicStatus').textContent = ''; $('musicResult').hidden = true; $('musicRecognize').disabled = false; }
  $('videoAuthor').textContent = current ? (current.author ? `@${current.author}` : current.site || '当前播放视频') : '等待网页视频';
  $('videoTitle').textContent = current ? (current.title || '此视频没有附带描述') : '播放网页视频，再点击插件图标授权';
  const url = current?.url || ''; const valid = TKCore.webURL(url);
  $('videoLink').hidden = !valid; if (valid) $('videoLink').href = url;
  $('statusText').textContent = current?.status || 'TikTok 自动提取字幕；其他网页请点击插件图标授权音频';
  const rawLanguage = current?.captionLanguage || '';
  const languageCode = rawLanguage.split(/[-_]/)[0].toLowerCase();
  const isoCodes = {ara: 'ar', eng: 'en', zho: 'zh', cmn: 'zh', spa: 'es', por: 'pt', jpn: 'ja', kor: 'ko', fra: 'fr', deu: 'de', ind: 'id', tha: 'th', vie: 'vi'};
  let languageName = '';
  try { if (languageCode) languageName = new Intl.DisplayNames(['zh-CN'], {type: 'language'}).of(isoCodes[languageCode] || languageCode); } catch { /* Unknown TikTok language codes fall back to the generic label. */ }
  $('languagePair').textContent = `${languageName || '语言自动识别'}${saved.translate ? ' → 简体中文' : ' · 仅提取原文'}`;
  $('status').className = `status ${current?.stage || ''}`;
  const capturing = state.captureTab === currentTab;
  document.querySelector('.captureHelp').classList.toggle('capturing', capturing);
  $('captureState').textContent = capturing ? '标签页音频已授权 · 本机识别' : '音频尚未授权'; $('stop').hidden = state.captureTab == null;
  $('captureError').textContent = state.captureError || ''; $('captureError').hidden = !state.captureError;
  $('sourceBadge').textContent = current?.source === '字幕' ? '视频字幕' : current?.source || ''; $('sourceBadge').hidden = !current?.source;
  $('retry').disabled = !current || !!historyChoice;
  renderRows();
  scheduleAutoRewrite();
}
$('historySelect').onchange = () => { historyChoice = $('historySelect').value; refresh().then(() => renderRows(true)); };
$('settingsToggle').onclick = () => showSettings($('settings').hidden);
$('closeSettings').onclick = () => showSettings(false);
$('save').onclick = () => saveSettings(true);
$('saveTranslation').onclick = () => saveSettings(true);
$('saveMusic').onclick = async () => {
  const key = $('auddKey').value.trim();
  if (key) {
    try { if (!await chrome.permissions.request({origins: ['https://api.audd.io/*']})) { toast('未授权 AudD，设置未保存'); return; } }
    catch { toast('AudD 授权失败，设置未保存'); return; }
  }
  const {settings = {}} = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({settings: {...settings, auddKey: key}}); await loadSettings(); toast(key ? '音乐识别设置已保存' : '音乐识别 Token 已清除');
};
for (const name of ['auto', 'translate', 'language', 'translationProvider']) $(name).onchange = () => saveSettings(false);
$('health').onclick = async () => {
  $('serviceStatus').textContent = '检测中…';
  try {
    const response = await fetch('http://127.0.0.1:8765/health', {headers: {'X-TK-Token': $('token').value.trim()}, signal: AbortSignal.timeout(5000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    $('serviceStatus').textContent = `已连接 · ${data.model} · ${data.loaded ? '模型就绪' : '首次识别时加载模型'}`;
  } catch (error) { $('serviceStatus').textContent = error.name === 'TypeError' ? '未启动，请双击本机启动脚本' : error.message; }
};
$('retry').onclick = () => { if (current) { toast('正在重新翻译…'); send({type: 'RETRY', tabId: currentTab}); } };
$('stop').onclick = async () => { await send({type: 'STOP'}); toast('已停止音频捕获'); refresh(); };
$('clear').onclick = async () => { rewriteSequence++; clearTimeout(rewriteTimer); rewriteFingerprint = ''; await send({type: 'CLEAR'}); toast('已清空本机文案记录'); refresh(); };
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(b => { b.setAttribute('aria-selected', String(b === button)); b.tabIndex = b === button ? 0 : -1; });
  renderRows(true);
});
const viewTabs = [...document.querySelectorAll('[data-view]')];
viewTabs.forEach(button => {
  button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1;
  button.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? viewTabs.length - 1 : (viewTabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + viewTabs.length) % viewTabs.length;
    viewTabs[next].click(); viewTabs[next].focus();
  };
});
function textOutput() {
  if (view === 'rewrite') return rewriteResult()?.text || '';
  return (current?.rows || []).map(r => view === 'original' ? r.text : view === 'zh' ? r.zh || '' : [r.text, r.zh].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(textOutput()); toast('文案已复制'); } catch { toast('复制失败，请用导出保存'); } };
$('export').onclick = () => {
  const format = $('format').value;
  const data = format === 'json' ? JSON.stringify(view === 'rewrite' ? {video: current.url, title: current.title, rewrite: rewriteResult()} : {video: current.url, title: current.title, source: current.source, segments: current.rows}, null, 2) : format === 'srt' ? TKCore.exportSrt(current.rows.map(r => view === 'original' ? {...r, zh: r.text} : view === 'bilingual' ? {...r, zh: [r.text, r.zh].filter(Boolean).join('\n')} : r)) : textOutput();
  const blob = new Blob([format === 'txt' ? '\uFEFF' : '', data], {type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `speech-${current.id.replace(/[^\w-]/g, '_').slice(0, 60)}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
};
let currentCapturing = false, musicVideoId = null, musicSequence = 0, musicBusy = false;
$('musicRecognize').onclick = async () => {
  if (musicBusy) return;
  if (!saved.auddKey) { $('musicStatus').textContent = '请在右上角设置中填写并保存 AudD API Token。'; return; }
  if (historyChoice || !currentCapturing || !current?.id) { $('musicStatus').textContent = '请在当前视频网页点击插件图标，授权标签页音频。'; return; }
  const sequence = ++musicSequence, videoId = current.id, tabId = currentTab;
  musicBusy = true; $('musicRecognize').disabled = true; $('musicStatus').textContent = '正在发送音频并识别歌曲…'; $('musicResult').hidden = true;
  try {
    const response = await send({type: 'MUSIC_RECOGNIZE', tabId, videoId});
    if (sequence !== musicSequence || current?.id !== videoId || currentTab !== tabId) return;
    if (!response?.ok) throw new Error(response?.error || '识别失败，请重试');
    if (!response.music) { $('musicStatus').textContent = '没有匹配到歌曲；可以换一段音乐更清晰的片段再试。'; return; }
    $('musicStatus').textContent = '识别结果，请自行核对'; $('musicTitle').textContent = response.music.title; $('musicArtist').textContent = response.music.artist || '未知歌手';
    const link = $('musicLink'); link.hidden = !response.music.url; if (response.music.url) link.href = response.music.url;
    $('musicResult').hidden = false;
  } catch (error) { if (sequence === musicSequence) $('musicStatus').textContent = `识别失败：${error.message}`; }
  finally { if (sequence === musicSequence) { musicBusy = false; $('musicRecognize').disabled = false; } }
};
$('follow').onclick = () => $('transcript').querySelector('.active')?.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session') refresh(); if (area === 'local' && changes.history) refresh(); if (area === 'local' && changes.settings) loadSettings().then(() => renderRows(true)); if (area === 'local' && (changes.rewritePresets || changes.rewrites || changes.rewriteOptions)) loadRewriteState().then(() => renderRows(true)); });
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, change) => { if (id === currentTab && change.url) refresh(); });
// Rewrite results and editable presets are kept locally, separate from timestamped subtitles.
const defaultPreset = {id: 'default', name: '自然口播', prompt: '将原文改写成简体中文短视频口播稿，语言自然口语化，开头直接点出重点，保留关键信息和事实，不添加未经证实的内容。'};
let rewritePresets = [], rewrites = {}, rewriteOptions = {}, rewriteTimer, rewriteFingerprint = '', rewriteSequence = 0, rewriteBusy = false, rewriteMessage = '';
function rewriteResult() { return current?.id ? rewrites[current.id] : null; }
function sourceText() { return (current?.rows || []).map(r => r.text || '').filter(Boolean).join('\n'); }
function selectedPreset() { return rewritePresets.find(p => p.id === $('rewritePreset').value) || rewritePresets[0]; }
function signature() { const p = selectedPreset(); return current?.id && sourceText() && p ? JSON.stringify([current.id, sourceText(), p.id, p.prompt]) : ''; }
async function loadRewriteState() {
  const data = await chrome.storage.local.get(['rewritePresets', 'rewrites', 'rewriteOptions']);
  rewritePresets = Array.isArray(data.rewritePresets) && data.rewritePresets.length ? data.rewritePresets : [defaultPreset];
  rewrites = data.rewrites || {}; rewriteOptions = data.rewriteOptions || {};
  const selected = $('rewritePreset').value || rewriteOptions.presetId || rewritePresets[0].id;
  $('rewritePreset').replaceChildren(...rewritePresets.map(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; return o; }));
  $('rewritePreset').value = rewritePresets.some(p => p.id === selected) ? selected : rewritePresets[0].id;
  $('rewriteAuto').checked = !!rewriteOptions.auto;
  if (!$('presetEditor').open) fillPresetEditor();
}
function fillPresetEditor() { const p = selectedPreset(); $('presetName').value = p?.name || ''; $('presetPrompt').value = p?.prompt || ''; }
function renderRewrite() {
  const result = rewriteResult();
  $('rewriteOutput').textContent = result?.text || '改写稿会显示在这里。';
  $('rewriteOutput').classList.toggle('emptyRewrite', !result?.text);
  $('rewriteExpand').hidden = !result?.text;
  if ($('rewriteReader').open) $('readerContent').textContent = result?.text || '';
  $('rewriteStatus').textContent = rewriteMessage || (result?.text ? `已保存 · ${result.presetName}${result.fingerprint !== signature() ? ' · 原文或提示词已变化，请重新生成' : ''}` : '');
  $('rewriteRun').disabled = rewriteBusy || !sourceText();
  $('rewriteRun').textContent = rewriteBusy ? '正在生成…' : result ? '重新生成口播稿' : '生成中文口播稿';
  $('copy').disabled = !result?.text; $('copyLabel').textContent = '复制改写稿'; $('export').disabled = !result?.text;
}
function scheduleAutoRewrite() {
  const next = !historyChoice && rewriteOptions.auto ? signature() : '';
  if (next === rewriteFingerprint) return;
  rewriteFingerprint = next; clearTimeout(rewriteTimer); rewriteSequence++;
  if (!next || rewriteResult()?.fingerprint === next) return;
  rewriteTimer = setTimeout(() => runRewrite(true), 20000);
}
async function runRewrite(automatic = false) {
  const preset = selectedPreset(), text = sourceText(), fingerprint = signature(), videoId = current?.id;
  if (!videoId || !text || !preset || rewriteBusy) return;
  if (!saved.deepseekKey) { rewriteMessage = '请先在设置中填写并保存 DeepSeek API Key'; renderRows(true); return; }
  clearTimeout(rewriteTimer);
  const run = ++rewriteSequence; rewriteBusy = true; rewriteMessage = automatic ? '原文已稳定，正在自动改写…' : '正在生成中文口播稿…'; renderRows(true);
  try {
    const response = await send({type: 'REWRITE', text, prompt: preset.prompt});
    if (!response?.ok) throw new Error(response?.error || '改写失败，请重试');
    if (run !== rewriteSequence || current?.id !== videoId || signature() !== fingerprint) { rewriteMessage = '原文已变化，请重新生成'; return; }
    rewrites[videoId] = {text: response.text, presetId: preset.id, presetName: preset.name, fingerprint, updated: Date.now()};
    const entries = Object.entries(rewrites).sort((a,b) => b[1].updated - a[1].updated).slice(0,20);
    rewrites = Object.fromEntries(entries); await chrome.storage.local.set({rewrites});
    rewriteMessage = '改写完成';
  } catch (error) { if (run === rewriteSequence) rewriteMessage = `改写失败：${error.message}`; }
  finally { rewriteBusy = false; renderRows(true); if (run !== rewriteSequence) { rewriteFingerprint = ''; scheduleAutoRewrite(); } }
}
$('rewriteExpand').onclick = () => { const result = rewriteResult(); if (!result?.text) return; $('readerContent').textContent = result.text; $('rewriteReader').showModal(); $('readerClose').focus(); };
$('readerClose').onclick = () => $('rewriteReader').close();
$('readerDone').onclick = () => $('rewriteReader').close();
$('readerCopy').onclick = async () => { try { await navigator.clipboard.writeText($('readerContent').textContent); $('readerCopy').textContent = '已复制'; setTimeout(() => $('readerCopy').textContent = '复制改写稿', 2500); } catch { $('readerCopy').textContent = '复制失败'; } };
$('rewriteRun').onclick = () => runRewrite(false);
$('rewriteAuto').onchange = async () => { rewriteOptions = {...rewriteOptions, auto: $('rewriteAuto').checked, presetId: $('rewritePreset').value}; await chrome.storage.local.set({rewriteOptions}); rewriteFingerprint = ''; scheduleAutoRewrite(); };
$('rewritePreset').onchange = async () => { rewriteOptions = {...rewriteOptions, presetId: $('rewritePreset').value}; await chrome.storage.local.set({rewriteOptions}); fillPresetEditor(); rewriteMessage = ''; renderRows(true); rewriteFingerprint = ''; scheduleAutoRewrite(); };
$('presetEditor').ontoggle = () => { if ($('presetEditor').open) fillPresetEditor(); };
$('presetNew').onclick = () => { $('rewritePreset').value = ''; $('presetName').value = ''; $('presetPrompt').value = ''; $('presetName').focus(); };
$('presetSave').onclick = async () => {
  const name = $('presetName').value.trim(), prompt = $('presetPrompt').value.trim();
  if (!name || !prompt) { toast('请填写预设名称和改写要求'); return; }
  const old = rewritePresets.find(p => p.id === $('rewritePreset').value);
  const preset = {id: old?.id || crypto.randomUUID(), name, prompt};
  rewritePresets = [...rewritePresets.filter(p => p.id !== preset.id), preset];
  rewriteOptions = {...rewriteOptions, presetId: preset.id};
  await chrome.storage.local.set({rewritePresets, rewriteOptions}); await loadRewriteState(); $('rewritePreset').value = preset.id; fillPresetEditor(); rewriteMessage = ''; rewriteFingerprint = ''; scheduleAutoRewrite(); toast('提示词预设已保存'); renderRows(true);
};
$('presetDelete').onclick = async () => {
  if (rewritePresets.length <= 1) { toast('请至少保留一套提示词'); return; }
  const p = selectedPreset(); if (!p) return;
  rewritePresets = rewritePresets.filter(item => item.id !== p.id); rewriteOptions = {...rewriteOptions, presetId: rewritePresets[0].id};
  $('rewritePreset').value = ''; await chrome.storage.local.set({rewritePresets, rewriteOptions}); await loadRewriteState(); fillPresetEditor(); rewriteMessage = ''; rewriteFingerprint = ''; scheduleAutoRewrite(); toast('提示词预设已删除'); renderRows(true);
};
loadSettings().then(loadRewriteState).then(refresh);
