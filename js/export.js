/* Download / copy / share link / VS Code hand-off. All client-side. */
(function (APB) {
  'use strict';

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ---- share link: the whole spec travels inside the URL fragment (never sent to any server) ---- */
  function toB64Url(bytes) {
    let bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64Url(str) {
    const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(b, function (c) { return c.charCodeAt(0); });
  }

  async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }

  async function shareLink(state) {
    const json = new TextEncoder().encode(JSON.stringify(state));
    let token;
    if (typeof CompressionStream === 'function') token = 'z' + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
    else token = 'r' + toB64Url(json);
    return location.href.split('#')[0] + '#s=' + token;
  }

  async function readShareLink(hash) {
    const m = /^#s=([zr])([A-Za-z0-9_-]+)$/.exec(hash || '');
    if (!m) return null;
    const bytes = fromB64Url(m[2]);
    const json = m[1] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    const s = APB.state.migrate(JSON.parse(new TextDecoder().decode(json)));
    s.id = APB.state.uid();
    return s;
  }

  /* Copy synchronously inside the click, so the same click can still launch VS Code afterwards. */
  function copyNow(text) {
    if (fallbackCopy(text)) return true;
    if (navigator.clipboard) { navigator.clipboard.writeText(text).catch(function () {}); return true; }
    return false;
  }

  /* Hand over to VS Code through its registered vscode:// protocol (the browser may ask for permission once).
     Browsers only allow this directly inside a click, never after an await. */
  function launchVscode() { window.location.href = 'vscode://'; }

  APB.exporter = { copyNow: copyNow, launchVscode: launchVscode, download: download, copy: copy, shareLink: shareLink, readShareLink: readShareLink };
})(window.APB = window.APB || {});
