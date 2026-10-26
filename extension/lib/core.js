/* Shared pure functions; no page text is ever evaluated as code. */
(function (root) {
  const webURL = value => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };
  const isTikTok = value => { try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)tiktok\.com$/i.test(u.hostname); } catch { return false; } };
  const videoId = value => String(value || '').match(/\/video\/(\d+)/)?.[1] || '';
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function clean(text) {
    return String(text || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  }
  function normalize(rows) {
    return rows.map(r => ({start: Math.max(0, finite(r.start)), end: Math.max(finite(r.start), finite(r.end, finite(r.start) + 2)), text: clean(r.text)})).filter(r => r.text).sort((a, b) => a.start - b.start);
  }
  function timestamp(text) {
    const parts = text.trim().replace(',', '.').split(':').map(Number);
    return parts.reduce((total, n) => total * 60 + n, 0);
  }
  function parseCaptions(raw) {
    let data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch { /* VTT/SRT below */ }
    }
    if (typeof data === 'object' && data) {
      const rows = data.utterances || data.captions || data.segments || (Array.isArray(data) ? data : []);
      return normalize(rows.map(r => ({start: r.start_time != null ? r.start_time / 1000 : r.start, end: r.end_time != null ? r.end_time / 1000 : r.end, text: r.text || r.content})));
    }
    const lines = String(raw).replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{1,3})/);
      if (!match) continue;
      let text = '';
      while (++i < lines.length && lines[i].trim()) text += (text ? '\n' : '') + lines[i];
      rows.push({start: timestamp(match[1]), end: timestamp(match[2]), text});
    }
    return normalize(rows);
  }
  function mergeSentences(rows) {
    const result = []; let pending = null;
    for (const row of normalize(rows)) {
      if (pending && (row.start - pending.end > 1.5 || row.end - pending.start > 18 || pending.text.length + row.text.length > 600)) { result.push(pending); pending = null; }
      if (!pending) pending = {...row};
      else { pending.end = Math.max(pending.end, row.end); pending.text += ' ' + row.text; }
      if (/[.!?。！？]["'”’)]?$/.test(pending.text)) { result.push(pending); pending = null; }
    }
    if (pending) result.push(pending);
    return result;
  }
  function captionURL(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|byteoversea\.com|ibytedtos\.com|muscdn\.com)$/.test(u.hostname) ? u.href : '';
    } catch { return ''; }
  }
  function extractItems(data) {
    const found = new Map();
    const seen = new WeakSet();
    let count = 0;
    function visit(node, depth) {
      if (!node || typeof node !== 'object' || depth > 24 || seen.has(node) || ++count > 50000) return;
      seen.add(node);
      const id = String(node.id || node.aweme_id || '');
      const video = node.video;
      if (/^\d{10,30}$/.test(id) && video && typeof video === 'object') {
        const tracks = [...(video.subtitleInfos || []), ...(video.cla_info?.caption_infos || [])].map(c => ({url: captionURL(c.Url || c.url), lang: c.LanguageCodeName || c.lang || '', format: c.Format || '', source: c.Source || c.source || ''})).filter(c => c.url);
        const mediaURLs = [];
        const mediaSeen = new WeakSet();
        function media(value, depth = 0) {
          if (depth > 8) return;
          if (typeof value === 'string' && value.startsWith('https://')) { mediaURLs.push(value); return; }
          if (value && typeof value === 'object' && !mediaSeen.has(value)) { mediaSeen.add(value); Object.values(value).forEach(v => media(v, depth + 1)); }
        }
        media(video.playAddr); media(video.play_addr); media(video.bitrateInfo);
        const author = node.author?.uniqueId || node.author?.unique_id || '';
        found.set(id, {id, title: String(node.desc || '').slice(0, 500), author, mediaURLs: mediaURLs.slice(0, 30), url: `https://www.tiktok.com/@${encodeURIComponent(author || '_')}/video/${id}`, tracks});
      }
      for (const value of Object.values(node)) visit(value, depth + 1);
    }
    visit(data, 0);
    return [...found.values()];
  }
  function visibleScore(video, width, height) {
    const r = video.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, width) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, height) - Math.max(r.top, 0));
    if (!area || r.width < 60 || r.height < 60) return 0;
    return area * (!video.paused && !video.ended ? 3 : 1);
  }
  function timecode(seconds, srt = false) {
    const ms = Math.max(0, Math.round(finite(seconds) * 1000));
    const pad = (n, size = 2) => String(n).padStart(size, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${srt ? ',' : '.'}${pad(ms % 1000, 3)}`;
  }
  function exportSrt(rows) {
    return rows.map((r, i) => `${i + 1}\n${timecode(r.start, true)} --> ${timecode(r.end, true)}\n${r.zh || r.text}`).join('\n\n') + '\n';
  }
  function downsample(samples, rate, target = 16000) {
    const length = Math.floor(samples.length * target / rate);
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * rate / target), end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * rate / target)));
      let sum = 0; for (let j = start; j < end; j++) sum += samples[j];
      output[i] = sum / (end - start);
    }
    return output;
  }
  function wav(samples, rate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
    const str = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767), true));
    return buffer;
  }
  const api = {webURL, isTikTok, videoId, clean, normalize, parseCaptions, mergeSentences, captionURL, extractItems, visibleScore, timecode, exportSrt, downsample, wav};
  root.TKCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
