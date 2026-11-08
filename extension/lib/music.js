// Rolling audio stays in memory. A sample is sent only on explicit user request.
(function (root) {
  class RollingAudio {
    constructor(sampleRate, seconds = 12) { this.limit = Math.ceil(sampleRate * seconds); this.parts = []; this.count = 0; }
    clear() { this.parts = []; this.count = 0; }
    push(samples) {
      if (!samples.length) return;
      const chunk = samples.slice(); this.parts.push(chunk); this.count += chunk.length;
      while (this.count > this.limit && this.parts.length) {
        const excess = this.count - this.limit, first = this.parts[0];
        if (first.length <= excess) { this.parts.shift(); this.count -= first.length; }
        else { this.parts[0] = first.subarray(excess); this.count -= excess; }
      }
    }
    samples() { const out = new Float32Array(this.count); let pos = 0; for (const part of this.parts) { out.set(part, pos); pos += part.length; } return out; }
  }
  async function recognize(wav, token, fetcher = fetch) {
    if (!token || typeof token !== 'string') throw new Error('请先在设置中填写并保存 AudD API Token');
    const form = new FormData(); form.append('api_token', token); form.append('file', new Blob([wav], {type: 'audio/wav'}), 'sample.wav');
    const response = await fetcher('https://api.audd.io/', {method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`音乐识别服务请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (data.status !== 'success') throw new Error('音乐识别失败，请检查 AudD Token、额度或稍后重试');
    if (!data.result) return null;
    const title = String(data.result.title || '').slice(0, 300), artist = String(data.result.artist || '').slice(0, 300);
    if (!title) return null;
    let url = '';
    try { const u = new URL(data.result.song_link); if (u.protocol === 'https:') url = u.href; } catch {}
    return {title, artist, url};
  }
  root.TKMusic = {RollingAudio, recognize};
  if (typeof module !== 'undefined') module.exports = root.TKMusic;
})(globalThis);
