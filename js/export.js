/* Download / copy / share link / VS Code hand-off. All client-side. Inside the VS Code panel, files and the
   clipboard go through the extension (save dialog, VS Code clipboard). */
(function (APB) {
  'use strict';
  const H = APB.host;

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function download(name, text, mime) {
    if (H.isVscode) { downloadBytes(name, new TextEncoder().encode(text), mime || 'text/plain'); return; }
    saveBlob(name, new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
  }

  function downloadBytes(name, bytes, mime) {
    if (H.isVscode) { H.post({ type: 'save-file', name: name, mime: mime || 'application/octet-stream', base64: toBase64(bytes) }); return; }
    saveBlob(name, new Blob([bytes], { type: mime || 'application/octet-stream' }));
  }

  function saveBlob(name, blob) {
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
    if (H.isVscode) return H.request('clipboard-write', { text: text }).then(function () { return true; }, function () { return false; });
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

  /* Compressed state token (share links and the data block of downloaded .md files). */
  async function encodeState(state) {
    const json = new TextEncoder().encode(JSON.stringify(state));
    if (typeof CompressionStream === 'function') return 'z' + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
    return 'r' + toB64Url(json);
  }

  async function decodeState(token) {
    const m = /^([zr])([A-Za-z0-9_-]+)$/.exec(token || '');
    if (!m) return null;
    const bytes = fromB64Url(m[2]);
    const json = m[1] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    const s = APB.state.migrate(JSON.parse(new TextDecoder().decode(json)));
    s.id = APB.state.uid();
    return s;
  }

  async function shareLink(state) {
    return location.href.split('#')[0] + '#s=' + await encodeState(state);
  }

  async function readShareLink(hash) {
    const m = /^#s=([zr][A-Za-z0-9_-]+)$/.exec(hash || '');
    return m ? decodeState(m[1]) : null;
  }

  /* Copy synchronously inside the click, so the same click can still launch VS Code afterwards. */
  function copyNow(text) {
    if (H.isVscode) { H.post({ type: 'clipboard-write', text: text }); return true; }
    if (fallbackCopy(text)) return true;
    if (navigator.clipboard) { navigator.clipboard.writeText(text).catch(function () {}); return true; }
    return false;
  }

  /* Hand over to VS Code through its registered vscode:// protocol (the browser may ask for permission once).
     Browsers only allow this directly inside a click, never after an await. A URL such as
     vscode://<extension-id>/discover?… is routed to that extension's URI handler. */
  function launchVscode(url) { window.location.href = url || 'vscode://'; }

  APB.exporter = { copyNow: copyNow, launchVscode: launchVscode, download: download, downloadBytes: downloadBytes, copy: copy, shareLink: shareLink, readShareLink: readShareLink, encodeState: encodeState, decodeState: decodeState };
})(window.APB = window.APB || {});
