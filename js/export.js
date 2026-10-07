/* Download / copy / project JSON / share link. All client-side. */
(function (APB) {
  'use strict';
  const FORMAT = 'sap-development-specification-builder';
  const LEGACY_FORMATS = ['abap-copilot-prompt-builder'];

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

  function projectJson(state) {
    return JSON.stringify({ format: FORMAT, version: state.schema, exportedAt: new Date().toISOString(), state: state }, null, 2);
  }

  function parseProject(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON.'); }
    const payload = data && (data.format === FORMAT || LEGACY_FORMATS.indexOf(data.format) >= 0) ? data.state : data;
    if (!payload || typeof payload !== 'object' || !('requirement' in payload || 'types' in payload)) throw new Error('This does not look like a project exported from this tool.');
    const s = APB.state.migrate(payload);
    s.id = APB.state.uid(); // imports never overwrite an existing draft
    return s;
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

  /* vscode://file/<absolute path> opens a file or folder in VS Code (Windows paths become D:/folder). */
  function vscodeUrl(folder) {
    const p = folder.replace(/\\/g, '/').replace(/\/+$/, '');
    return 'vscode://file' + (p.charAt(0) === '/' ? '' : '/') + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  function openVscode(folder) {
    const a = document.createElement('a');
    a.href = vscodeUrl(folder);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  APB.exporter = { vscodeUrl: vscodeUrl, openVscode: openVscode, download: download, copy: copy, projectJson: projectJson, parseProject: parseProject, shareLink: shareLink, readShareLink: readShareLink };
})(window.APB = window.APB || {});
