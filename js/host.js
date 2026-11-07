/* Where the builder runs: a normal browser tab, or the "SAP Spec Builder" panel inside VS Code (DEWA extension,
   vscode-extension-addon/src/specBuilderPanel.js). In VS Code, storage, downloads and the clipboard go through the
   extension (webviews cannot download files), and system discovery runs in VS Code with GitHub Copilot. */
(function (APB) {
  'use strict';

  const api = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : null;
  const info = api && window.APB_HOST && typeof window.APB_HOST === 'object' ? window.APB_HOST : {};
  const store = info.storage && typeof info.storage === 'object' ? Object.assign({}, info.storage) : {};
  const handlers = {};
  const pending = {};
  let seq = 0;

  if (api) {
    window.addEventListener('message', function (e) {
      const m = e.data;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      if (m.type === 'reply' && pending[m.id]) {
        const p = pending[m.id];
        delete pending[m.id];
        if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'failed'));
        return;
      }
      (handlers[m.type] || []).forEach(function (fn) { try { fn(m); } catch (err) { console.error(err); } });
    });
  }

  function post(msg) { if (api) api.postMessage(msg); }

  /* Request / reply over postMessage (e.g. reading the clipboard through VS Code). */
  function request(type, payload) {
    if (!api) return Promise.reject(new Error('not in VS Code'));
    return new Promise(function (resolve, reject) {
      const id = 'r' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      post(Object.assign({ type: type, id: id }, payload || {}));
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('timeout')); } }, 30000);
    });
  }

  APB.host = {
    kind: api ? 'vscode' : 'browser',
    isVscode: !!api,
    version: info.version || '',
    post: post,
    request: request,
    on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    /* Key/value store kept by the extension in VS Code's globalState (survives restarts). */
    storage: {
      get: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      set: function (k, v) { store[k] = v; post({ type: 'storage', key: k, value: v }); return true; }
    },
    /* VS Code marks the webview body with its theme kind. */
    prefersDark: function () { return !!document.body && /vscode-(dark|high-contrast)(?!-light)/.test(document.body.className); }
  };
})(window.APB = window.APB || {});
