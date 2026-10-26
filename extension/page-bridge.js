(() => {
  const send = data => {
    try {
      const items = TKCore.extractItems(data);
      if (items.length) window.postMessage({source: 'tk-zh-items-v1', items}, location.origin);
    } catch { /* Ignore unrelated / malformed API data. */ }
  };
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = originalFetch.apply(this, args);
    const url = String(args[0]?.url || args[0] || '');
    if (/\/api\/(item|post|recommend|related|search|user|following)/.test(url)) {
      result.then(response => { if (response.ok) response.clone().json().then(send).catch(() => {}); }).catch(() => {});
    }
    return result;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (/\/api\//.test(String(url))) this.addEventListener('load', () => {
      try { send(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch { /* Non JSON. */ }
    }, {once: true});
    return open.call(this, method, url, ...rest);
  };
})();
