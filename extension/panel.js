const $ = id => document.getElementById(id);
let current = null, currentTab = null, view = 'bilingual', saved = {}, renderedKey = '', toastTimer, historyChoice = '', historySignature = '';
const send = message => chrome.runtime.sendMessage(message);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3200); }
function showSettings(show) { $('settings').hidden = !show; $('workspace').hidden = show; $('actions').hidden = show; document.body.classList.toggle('settingsOpen', show); $('settingsToggle').setAttribute('aria-expanded', String(show)); }
async function loadSettings() {
  saved = {auto: true, translate: true, token: '', language: 'auto', ...(await chrome.storage.local.get('settings')).settings};
  document.querySelector('footer p').textContent = `本机识别 · ${saved.translate ? '在线翻译' : '仅提取原文'} · 最近 20 条保存在此设备`;
  $('auto').checked = saved.auto; $('translate').checked = saved.translate; $('token').value = saved.token; $('language').value = saved.language;
  $('autoState').textContent = saved.auto ? '自动跟随' : '自动已关闭'; $('autoDot').style.background = saved.auto ? '' : '#bcc5c1';
}
async function saveSettings() {
  await chrome.storage.local.set({settings: {auto: $('auto').checked, translate: $('translate').checked, token: $('token').value.trim(), language: $('language').value}});
  await send({type: 'CONFIG'}); await loadSettings(); toast('设置已保存');
}
function renderRows(force = false) {
  const rows = current?.rows || [];
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
      if (view !== 'original') { const p = document.createElement('p'); p.className = row.zh ? 'zh' : 'pending'; p.textContent = row.zh || (saved.translate ? '等待翻译 / 可重新提取' : '在线翻译已关闭'); content.append(p); }
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
}
$('historySelect').onchange = () => { historyChoice = $('historySelect').value; refresh().then(() => renderRows(true)); };
$('settingsToggle').onclick = () => showSettings($('settings').hidden);
$('closeSettings').onclick = () => showSettings(false);
$('save').onclick = saveSettings;
for (const name of ['auto', 'translate', 'language']) $(name).onchange = saveSettings;
$('health').onclick = async () => {
  $('serviceStatus').textContent = '检测中…';
  try {
    const response = await fetch('http://127.0.0.1:8765/health', {headers: {'X-TK-Token': $('token').value.trim()}, signal: AbortSignal.timeout(5000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    $('serviceStatus').textContent = `已连接 · ${data.model} · ${data.loaded ? '模型就绪' : '首次识别时加载模型'}`;
  } catch (error) { $('serviceStatus').textContent = error.name === 'TypeError' ? '未启动，请双击本机启动脚本' : error.message; }
};
$('retry').onclick = () => { if (current) { toast('正在重新提取…'); send({type: 'RETRY', tabId: currentTab}); } };
$('stop').onclick = async () => { await send({type: 'STOP'}); toast('已停止音频捕获'); refresh(); };
$('clear').onclick = async () => { await send({type: 'CLEAR'}); toast('已清空本机文案记录'); refresh(); };
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
  return (current?.rows || []).map(r => view === 'original' ? r.text : view === 'zh' ? r.zh || '' : [r.text, r.zh].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(textOutput()); toast('文案已复制'); } catch { toast('复制失败，请用导出保存'); } };
$('export').onclick = () => {
  const format = $('format').value;
  const data = format === 'json' ? JSON.stringify({video: current.url, title: current.title, source: current.source, segments: current.rows}, null, 2) : format === 'srt' ? TKCore.exportSrt(current.rows.map(r => view === 'original' ? {...r, zh: r.text} : view === 'bilingual' ? {...r, zh: [r.text, r.zh].filter(Boolean).join('\n')} : r)) : textOutput();
  const blob = new Blob([format === 'txt' ? '\uFEFF' : '', data], {type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `speech-${current.id.replace(/[^\w-]/g, '_').slice(0, 60)}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
};
$('follow').onclick = () => $('transcript').querySelector('.active')?.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session') refresh(); if (area === 'local' && changes.history) refresh(); if (area === 'local' && changes.settings) loadSettings().then(() => renderRows(true)); });
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, change) => { if (id === currentTab && change.url) refresh(); });
loadSettings().then(refresh);
