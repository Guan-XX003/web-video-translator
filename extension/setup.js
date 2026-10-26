async function check() {
  const el = document.getElementById('connection');
  el.textContent = '正在检查本机模型连接…'; el.className = '';
  try {
    const {settings = {}} = await chrome.storage.local.get('settings');
    const response = await fetch('http://127.0.0.1:8765/health', {headers: {'X-TK-Token': settings.token || ''}, signal: AbortSignal.timeout(5000)});
    const state = await response.json();
    if (!response.ok || !state.ok) throw new Error('配对失败，请关闭此专用浏览器后，重新双击「一键启动.bat」。');
    el.textContent = state.loaded ? '插件已加载 · 配对完成 · 本机模型已就绪' : '配对完成 · 本机模型将在识别时加载';
  } catch (error) {
    el.className = 'error';
    el.textContent = error.name === 'TypeError' || error.name === 'TimeoutError' ? '未连接本机服务，请先双击「一键启动.bat」并保留启动窗口。' : error.message;
  }
}
document.getElementById('check').onclick = check;
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) check(); });
check();
