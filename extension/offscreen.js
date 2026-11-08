let stream, context, source, processor, silent, tabId, video, musicAudio, opts = {}, chunks = [], count = 0, startTime = 0, lastTime = 0, queue = [], busy = false, captureEpoch = 0, requestController;
const notify = message => chrome.runtime.sendMessage(message).catch(() => {});
function reset() { chunks = []; count = 0; startTime = video?.time || 0; }
function status(text, stage = 'listening', target = video) { if (target) notify({type: 'ASR_STATUS', tabId, videoId: target.id, status: text, stage}); }
async function stop() {
  captureEpoch++; requestController?.abort(); queue = []; reset();
  processor?.disconnect(); source?.disconnect(); silent?.disconnect();
  stream?.getTracks().forEach(t => t.stop());
  if (context && context.state !== 'closed') await context.close();
  stream = context = source = processor = silent = null; video = null; musicAudio?.clear(); musicAudio = null;
}
function flush() {
  if (!count || !video || !context) { reset(); return; }
  const duration = count / context.sampleRate;
  if (duration < 0.65) { reset(); return; }
  const samples = new Float32Array(count); let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  let energy = 0; for (const s of samples) energy += s * s;
  if (Math.sqrt(energy / samples.length) > 0.001) {
    if (queue.length < 8) queue.push({samples: TKCore.downsample(samples, context.sampleRate), video: {...video}, start: startTime, rate: video.playbackRate || 1, tabId, epoch: captureEpoch});
    else status('本机识别跟不上播放速度，请暂停等待，或改用 tiny 模型。', 'error');
  }
  reset(); processQueue();
}
async function processQueue() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const item = queue.shift();
    if (item.epoch !== captureEpoch) continue;
    if (!opts.token) { status('请在设置中填写本机服务配对码，然后重新播放。', 'error', item.video); continue; }
    status('本机正在识别口播…', 'loading', item.video);
    try {
      requestController = new AbortController();
      const requestTimer = setTimeout(() => requestController.abort(), 300000);
      let response;
      try { response = await fetch(`http://127.0.0.1:8765/transcribe?language=${encodeURIComponent(opts.language || 'auto')}`, {
        method: 'POST', headers: {'Content-Type': 'audio/wav', 'X-TK-Token': opts.token}, body: TKCore.wav(item.samples), signal: requestController.signal
      }); } finally { clearTimeout(requestTimer); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (item.epoch !== captureEpoch) continue;
      const rows = (data.segments || []).map(r => ({start: item.start + r.start * item.rate, end: item.start + r.end * item.rate, text: r.text}));
      notify({type: 'ASR_RESULT', tabId: item.tabId, videoId: item.video.id, rows, language: data.language});
    } catch (error) {
      if (item.epoch === captureEpoch) status(error.name === 'TypeError' ? '连接不到本机识别服务，请先运行包内本机启动脚本。' : `本机识别失败：${error.message}`, 'error', item.video);
    }
  }
  busy = false;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen') return false;
  (async () => {
    if (message.type === 'MUSIC_RECOGNIZE') {
      if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('请求来源无效');
      if (message.tabId !== tabId || !stream || !context || !video || message.videoId !== video.id) throw new Error('请先在当前视频网页点击插件图标授权音频');
      if (!musicAudio || musicAudio.count < context.sampleRate * 5) throw new Error('请先播放有背景音乐的视频至少 5 秒再识别');
      const epoch = captureEpoch, videoId = video.id;
      const captured = musicAudio.samples();
      let energy = 0; for (const sample of captured) energy += sample * sample;
      if (Math.sqrt(energy / captured.length) < 0.001) throw new Error('未检测到声音，请确认视频正在播放且没有静音');
      const samples = TKCore.downsample(captured, context.sampleRate);
      const result = await TKMusic.recognize(TKCore.wav(samples), message.token);
      if (captureEpoch !== epoch || video?.id !== videoId) throw new Error('视频已切换，请在当前视频重新识别');
      return {music: result};
    }
    if (message.type === 'STOP') { await stop(); await notify({type: 'CAPTURE_ENDED'}); return; }
    if (message.type === 'RESET') { captureEpoch++; requestController?.abort(); queue = []; reset(); return; }
    if (message.type === 'CONFIG') { opts = message.settings; if (!opts.auto) { queue = []; reset(); } return; }
    if (message.type === 'START') {
      await stop(); tabId = message.tabId; opts = message.settings;
      stream = await navigator.mediaDevices.getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId}}, video: false});
      context = new AudioContext(); await context.resume(); musicAudio = new TKMusic.RollingAudio(context.sampleRate, 12); source = context.createMediaStreamSource(stream);
      // tabCapture suppresses the tab's normal audio output; restore it exactly once.
      source.connect(context.destination);
      processor = context.createScriptProcessor(4096, 1, 1); silent = context.createGain(); silent.gain.value = 0;
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      processor.onaudioprocess = event => {
        if (video?.playing) musicAudio?.push(event.inputBuffer.getChannelData(0));
        if (!opts.auto || !video?.playing || !video.needsASR) return;
        const data = event.inputBuffer.getChannelData(0).slice(); chunks.push(data); count += data.length;
        if (count / context.sampleRate >= 7) flush();
      };
      stream.getAudioTracks()[0].addEventListener('ended', () => { stop().then(() => notify({type: 'CAPTURE_ENDED'})); }, {once: true});
      return;
    }
    if (message.type === 'VIDEO' && message.tabId === tabId) {
      const next = message.video;
      const discontinuity = !next || next.id !== video?.id || Math.abs((next.time || 0) - lastTime) > 3 || next.playbackRate !== video?.playbackRate;
      if (discontinuity || (video?.playing && !next?.playing) || (video?.needsASR && !next?.needsASR) || (lastTime > (next?.time || 0) + 0.5)) flush();
      if (next?.id !== video?.id) { queue = queue.filter(item => item.video.id === next?.id); musicAudio?.clear(); }
      video = next; lastTime = next?.time || 0;
      if (!count) startTime = next?.time || 0;
    }
  })().then(value => respond({ok: true, ...value})).catch(error => respond({ok: false, error: error.message}));
  return true;
});
