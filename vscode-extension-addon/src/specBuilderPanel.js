'use strict';
/* "SAP Spec Builder" panel: the builder (the self-contained dist HTML file, copied to media/spec-builder.html)
   runs as a VS Code webview. The panel gives it what a browser tab cannot have inside VS Code:
   - persistent storage (globalState), save dialogs and the VS Code clipboard;
   - GitHub sign-in status (VS Code's own GitHub authentication – the panel never receives a token);
   - read-only SAP discovery, automatic (discoveryRunner.js) or in Copilot Chat (fsDiscovery.js + submitPackTool.js);
   - "Open in Copilot Chat" for the development spec (dewa-abap). */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const runner = require('./discoveryRunner');
const drafter = require('./draftRunner');
const fsDiscovery = require('./fsDiscovery');
const submitTool = require('./submitPackTool');

const VIEW_TYPE = 'dewaSpecBuilder';
const STORAGE_KEY = 'dewaSpecBuilder.storage';
const CHAT_AGENTS = ['dewa-abap', 'dewa-codereview', 'dewa-fs-discovery'];
const SAVE_TYPES = { '.md': 'Markdown', '.docx': 'Word document', '.json': 'JSON' };
const MAX_VALUE = 5 * 1024 * 1024;
const CHAT_SUFFIX = '\n\nWhen the context pack is ready, call the ' + submitTool.TOOL_NAME + ' tool with it so it is imported into the SAP Spec Builder.';

/* Strict CSP + nonce on every <script>, and the host seed (storage, version) before the app scripts. */
function buildHtml(raw, opts) {
  const nonce = opts.nonce;
  const csp = "default-src 'none'; img-src " + opts.cspSource + " data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-" + nonce + "';";
  const seed = JSON.stringify({ kind: 'vscode', version: opts.version || '', storage: opts.storage || {} }).replace(/</g, '\\u003c'); // no </script> break-out
  let html = String(raw).replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  html = html.replace(/<script(?![^>]*\bnonce=)(?=[\s>])/gi, '<script nonce="' + nonce + '"');
  return html.replace(/<head([^>]*)>/i, '<head$1>\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n<script nonce="' + nonce + '">window.APB_HOST = ' + seed + ';</script>');
}

function missingHtml(file) {
  return '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h2>SAP Spec Builder is not packaged</h2>' +
    '<p>Expected <code>' + String(file).replace(/[<>&]/g, '') + '</code>. Run <code>node scripts/build-single.js</code> in the builder repository and copy ' +
    '<code>dist/SAP-Development-Specification-Builder.html</code> to <code>media/spec-builder.html</code> of the extension (see INSTALL.md).</p></body></html>';
}

function safeName(name) {
  const base = path.basename(String(name || 'specification.md')).replace(/[^\w.\- ()]+/g, '_').slice(0, 150);
  return SAVE_TYPES[path.extname(base).toLowerCase()] ? base : base + '.md';
}

/* Message router (one per panel). deps: { post, chat, getAuth, signIn, agentInstructions, config } */
function createRouter(vscode, context, deps) {
  let cts = null;
  const chat = deps.chat || fsDiscovery.create(vscode);

  function reply(m, ok, value) { if (m.id) deps.post(ok ? { type: 'reply', id: m.id, ok: true, value: value } : { type: 'reply', id: m.id, ok: false, error: String(value) }); }
  function str(v, max) { return typeof v === 'string' && v.length <= (max || MAX_VALUE); }

  const routes = {
    storage: function (m) {
      if (!str(m.key, 200) || m.key.indexOf('apb.') !== 0 || !(m.value === null || str(m.value))) return false;
      const all = Object.assign({}, context.globalState.get(STORAGE_KEY, {}));
      if (m.value === null) delete all[m.key]; else all[m.key] = m.value;
      return context.globalState.update(STORAGE_KEY, all);
    },
    'clipboard-write': async function (m) {
      if (!str(m.text)) return false;
      await vscode.env.clipboard.writeText(m.text);
      reply(m, true, true);
    },
    'clipboard-read': async function (m) { reply(m, true, await vscode.env.clipboard.readText()); },
    'save-file': async function (m) {
      if (!str(m.name, 300) || !str(m.base64, MAX_VALUE * 2)) return false;
      const name = safeName(m.name);
      const ext = path.extname(name).toLowerCase();
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      const defaultUri = folder ? vscode.Uri.joinPath(folder.uri, name) : vscode.Uri.file(path.join(require('os').homedir(), name));
      const filters = {};
      filters[SAVE_TYPES[ext]] = [ext.slice(1)];
      const uri = await vscode.window.showSaveDialog({ defaultUri: defaultUri, filters: filters, saveLabel: 'Save' });
      if (!uri) return true;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(m.base64, 'base64'));
      deps.post({ type: 'saved', path: uri.fsPath });
      const pick = await vscode.window.showInformationMessage('Saved ' + path.basename(uri.fsPath), 'Open');
      if (pick === 'Open') {
        if (ext === '.docx') await vscode.env.openExternal(uri);
        else await vscode.window.showTextDocument(uri);
      }
      return true;
    },
    'auth-status': async function () { deps.post(Object.assign({ type: 'auth' }, await deps.getAuth())); },
    'sign-in': async function () {
      try { await deps.signIn(); } catch (e) { /* user closed the sign-in */ }
      deps.post(Object.assign({ type: 'auth' }, await deps.getAuth()));
    },
    discover: async function (m) {
      if (!str(m.prompt, 200000) || m.prompt.indexOf(fsDiscovery.MARKER) !== 0 || ['auto', 'chat'].indexOf(m.mode) < 0) return false;
      const auth = await deps.getAuth();
      if (!auth.copilot) { deps.post({ type: 'discovery-error', code: 'NO_COPILOT', message: 'GitHub Copilot Chat is not installed in VS Code.' }); return true; }
      if (!auth.signedIn) { deps.post({ type: 'discovery-error', code: 'SIGNED_OUT', message: 'Sign in to GitHub Copilot first.' }); return true; }
      if (m.mode === 'chat') {
        const how = await chat.openChat(m.prompt + CHAT_SUFFIX);
        deps.post({ type: 'discovery-progress', key: 'chat', status: 'done', text: how === 'agent' ? 'Copilot Chat is open with dewa-fs-discovery – press Enter there; the pack comes back here automatically' : 'Copilot Chat is open in agent mode – select dewa-fs-discovery if listed, press Enter; the pack comes back here automatically' });
        return true;
      }
      if (cts) { deps.post({ type: 'discovery-error', code: 'BUSY', message: 'A discovery is already running.' }); return true; }
      cts = new vscode.CancellationTokenSource();
      const cfg = deps.config();
      try {
        const text = await runner.run(vscode, {
          prompt: m.prompt,
          instructions: deps.agentInstructions(),
          allowPatterns: cfg.get('discoveryTools', []),
          maxRounds: cfg.get('maxToolRounds', 25),
          model: cfg.get('model', ''),
          exclude: [submitTool.TOOL_NAME],
          token: cts.token,
          onProgress: function (p) { deps.post(Object.assign({ type: 'discovery-progress' }, p)); }
        });
        deps.post({ type: 'discovery-result', text: text });
      } catch (e) {
        deps.post({ type: 'discovery-error', code: e.code || 'FAILED', message: String(e && e.message || e) });
      } finally {
        if (cts) cts.dispose();
        cts = null;
      }
      return true;
    },
    draft: async function (m) {
      if (!str(m.prompt, 200000) || m.prompt.indexOf(drafter.MARKER) !== 0) return false;
      const auth = await deps.getAuth();
      if (!auth.copilot) { deps.post({ type: 'draft-error', code: 'NO_COPILOT', message: 'GitHub Copilot Chat is not installed in VS Code.' }); return true; }
      if (!auth.signedIn) { deps.post({ type: 'draft-error', code: 'SIGNED_OUT', message: 'Sign in to GitHub Copilot first.' }); return true; }
      if (cts) { deps.post({ type: 'draft-error', code: 'BUSY', message: 'Copilot is already working on a request.' }); return true; }
      cts = new vscode.CancellationTokenSource();
      try {
        const text = await drafter.run(vscode, {
          prompt: m.prompt,
          model: deps.config().get('model', ''),
          token: cts.token,
          onProgress: function (p) { deps.post({ type: 'draft-progress', text: p.text }); }
        });
        deps.post({ type: 'draft-result', text: text });
      } catch (e) {
        deps.post({ type: 'draft-error', code: e.code || 'FAILED', message: String(e && e.message || e) });
      } finally {
        if (cts) cts.dispose();
        cts = null;
      }
      return true;
    },
    stop: function () { if (cts) cts.cancel(); return true; },
    'open-chat': async function (m) {
      if (CHAT_AGENTS.indexOf(m.agent) < 0 || !str(m.prompt, 400000)) return false;
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: m.prompt, isPartialQuery: true, mode: m.agent });
      } catch (e) {
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: 'Act as the ' + m.agent + ' agent and follow its instructions.\n\n' + m.prompt, isPartialQuery: true, mode: 'agent' });
      }
      return true;
    }
  };

  /* Returns false for anything that is not a known, well-formed message. */
  async function handle(m) {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(routes, m.type)) return false;
    try {
      const r = await routes[m.type](m);
      if (r === false) reply(m, false, 'invalid message');
      return r !== false;
    } catch (e) {
      reply(m, false, e && e.message || e);
      return false;
    }
  }

  return { handle: handle, cancel: function () { if (cts) cts.cancel(); } };
}

/* Panel lifecycle: one builder tab, restored after a restart, plus the chat-to-panel pack delivery. */
function createSpecBuilder(vscode, context, opts) {
  opts = opts || {};
  const htmlFile = path.join(context.extensionPath, opts.htmlPath || 'media/spec-builder.html');
  const agentFile = path.join(context.extensionPath, opts.agentPath || 'agents/dewa-fs-discovery.agent.md');
  let current = null; // { panel, router }

  async function getAuth() {
    const copilot = !!vscode.extensions.getExtension(fsDiscovery.COPILOT_CHAT);
    let session = null;
    try { session = await vscode.authentication.getSession('github', ['user:email'], { silent: true }); } catch (e) { session = null; }
    return { copilot: copilot, signedIn: !!session, account: session && session.account ? session.account.label : '' };
  }

  function attach(panel) {
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    let raw = null;
    try { raw = fs.readFileSync(htmlFile, 'utf8'); } catch (e) { raw = null; }
    panel.webview.html = raw === null ? missingHtml(htmlFile) : buildHtml(raw, {
      nonce: crypto.randomBytes(16).toString('base64'),
      cspSource: panel.webview.cspSource,
      version: (context.extension && context.extension.packageJSON && context.extension.packageJSON.version) || '',
      storage: context.globalState.get(STORAGE_KEY, {})
    });
    const post = function (msg) { return panel.webview.postMessage(msg); };
    const router = createRouter(vscode, context, {
      post: post,
      getAuth: getAuth,
      signIn: function () { return vscode.authentication.getSession('github', ['user:email'], { createIfNone: true }); },
      agentInstructions: function () { try { return runner.instructionsFromAgentFile(fs.readFileSync(agentFile, 'utf8')); } catch (e) { return ''; } },
      config: function () { return vscode.workspace.getConfiguration('dewaSpecBuilder'); }
    });
    const subs = [
      panel.webview.onDidReceiveMessage(router.handle),
      vscode.authentication.onDidChangeSessions(async function (e) { if (e.provider && e.provider.id === 'github') post(Object.assign({ type: 'auth' }, await getAuth())); })
    ];
    panel.onDidDispose(function () { router.cancel(); subs.forEach(function (d) { d.dispose(); }); if (current && current.panel === panel) current = null; });
    current = { panel: panel, router: router, post: post };
    return current;
  }

  function open() {
    if (current) { current.panel.reveal(); return current.panel; }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'SAP Spec Builder', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    attach(panel);
    return panel;
  }

  /* From the dewa_submitContextPack tool (Copilot Chat run). */
  async function deliverPack(pack) {
    if (!current) return false;
    await current.post({ type: 'discovery-result', text: JSON.stringify(pack) });
    current.panel.reveal(undefined, true);
    return true;
  }

  return { open: open, attach: attach, deliverPack: deliverPack, getAuth: getAuth };
}

module.exports = { VIEW_TYPE: VIEW_TYPE, STORAGE_KEY: STORAGE_KEY, buildHtml: buildHtml, createRouter: createRouter, createSpecBuilder: createSpecBuilder, safeName: safeName };
