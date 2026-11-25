'use strict';
/* SAP Fiori + UI5 MCP servers for the dewa-fiori agent, provided by this extension (on by default).

   VS Code 1.101+ : registered through vscode.lm.registerMcpServerDefinitionProvider – they appear in Copilot Chat
                    like servers from mcp.json, no file to edit. VS Code still asks once to trust / start them.
   older VS Code  : one notice with "Add to my mcp.json" (merges the two entries into the user's mcp.json; an entry
                    with the same name is never overwritten).

   Server names match the agent's tool references: fiori-mcp/*, ui5-mcp/*. A server the user already defines in
   their own mcp.json (user or workspace) under the same name is left to them. Versions are pinned (settings). */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const PROVIDER_ID = 'dewa.fioriMcp';
const NAMES = { fiori: 'fiori-mcp', ui5: 'ui5-mcp' };
const DEFAULTS = { fioriServerVersion: '1.17.0', ui5ServerVersion: '0.3.3', allowedDomains: 'localhost', caCertFile: '' };
const MIN_NODE = [20, 17, 0];
const NODE_URL = 'https://nodejs.org/en/download';
const NOTICE_KEY = 'dewaSpecBuilder.fioriMcpNotice';

function cfg(vscode) {
  const c = vscode.workspace.getConfiguration('dewaSpecBuilder');
  const get = function (k) { const v = c.get('fioriMcp.' + k); return v === undefined || v === null ? DEFAULTS[k] : v; };
  return {
    enabled: c.get('fioriMcp.enabled', true) !== false,
    fioriVersion: String(get('fioriServerVersion') || DEFAULTS.fioriServerVersion).trim(),
    ui5Version: String(get('ui5ServerVersion') || DEFAULTS.ui5ServerVersion).trim(),
    allowedDomains: String(get('allowedDomains') || DEFAULTS.allowedDomains).trim(),
    caCertFile: String(get('caCertFile') || '').trim()
  };
}

/* The two server configurations (mcp.json shape). platform: process.platform */
function servers(c, platform) {
  const npx = (platform || process.platform) === 'win32' ? 'npx.cmd' : 'npx';
  const ca = c.caCertFile ? { NODE_EXTRA_CA_CERTS: c.caCertFile } : {};
  return [
    { name: NAMES.fiori, command: npx, args: ['--yes', '--ignore-scripts', '@sap-ux/fiori-mcp-server@' + c.fioriVersion, 'fiori-mcp'],
      env: Object.assign({ SAP_UX_FIORI_TOOLS_DISABLE_TELEMETRY: 'true', LOG_LEVEL: 'error' }, ca), version: c.fioriVersion },
    { name: NAMES.ui5, command: npx, args: ['--yes', '@ui5/mcp-server@' + c.ui5Version],
      env: Object.assign({ UI5_MCP_SERVER_ALLOWED_DOMAINS: c.allowedDomains }, ca), version: c.ui5Version }
  ];
}

/* mcp.json files that may already define the servers: the user's (…/User/mcp.json, sibling of globalStorage's parent)
   and each workspace folder's .vscode/mcp.json. */
function userMcpPath(context) { return path.join(path.dirname(path.dirname(context.globalStorageUri.fsPath)), 'mcp.json'); }
function mcpFiles(vscode, context) {
  const files = [userMcpPath(context)];
  (vscode.workspace.workspaceFolders || []).forEach(function (f) { files.push(path.join(f.uri.fsPath, '.vscode', 'mcp.json')); });
  return files;
}
/* mcp.json may contain comments / trailing commas (JSONC) */
function readJsonc(file) {
  if (!fs.existsSync(file)) return null;
  const txt = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(txt); } catch (e) { /* fall through */ }
  try {
    return JSON.parse(txt.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, function (m, s) { return s || ''; }).replace(/,(\s*[}\]])/g, '$1'));
  } catch (e) { return undefined; } // unreadable: never write to it
}
function definedNames(files) {
  const names = {};
  files.forEach(function (f) {
    const j = readJsonc(f);
    const s = j && (j.servers || j.mcpServers);
    if (s && typeof s === 'object') Object.keys(s).forEach(function (n) { names[n] = f; });
  });
  return names;
}

/* What the provider offers now: enabled servers not already defined by the user. */
function offered(vscode, context, platform) {
  const c = cfg(vscode);
  if (!c.enabled) return [];
  const taken = definedNames(mcpFiles(vscode, context));
  return servers(c, platform).filter(function (s) { return !taken[s.name]; });
}

/* "Add to my mcp.json" (older VS Code): merge, never overwrite → { added: [...], kept: [...] } | { error } */
function addToUserMcp(vscode, context, platform) {
  const file = userMcpPath(context);
  const j = readJsonc(file);
  if (j === undefined) return { error: 'Your mcp.json could not be read (' + file + '); it was not changed.' };
  const doc = j || {};
  const key = doc.mcpServers && !doc.servers ? 'mcpServers' : 'servers';
  doc[key] = doc[key] || {};
  const added = [], kept = [];
  servers(cfg(vscode), platform).forEach(function (s) {
    if (doc[key][s.name]) { kept.push(s.name); return; }
    doc[key][s.name] = { type: 'stdio', command: s.command, args: s.args, env: s.env };
    added.push(s.name);
  });
  if (added.length) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n'); }
  return { added: added, kept: kept, file: file };
}

/* node --version → { ok, version } ; run: injectable for tests */
function nodeStatus(run) {
  let out = '';
  try { out = String((run || function () { return cp.execFileSync(process.platform === 'win32' ? 'node.exe' : 'node', ['--version'], { timeout: 5000 }); })()).trim(); } catch (e) { return { ok: false, version: '' }; }
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(out);
  if (!m) return { ok: false, version: out };
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ok = v[0] !== MIN_NODE[0] ? v[0] > MIN_NODE[0] : v[1] !== MIN_NODE[1] ? v[1] > MIN_NODE[1] : v[2] >= MIN_NODE[2];
  return { ok: ok, version: 'v' + v.join('.') };
}

function hasProviderApi(vscode) { return !!(vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === 'function' && vscode.McpStdioServerDefinition); }

function activate(context, vscode, deps) {
  deps = deps || {};
  const state = { mode: hasProviderApi(vscode) ? 'provider' : 'mcp.json', node: null };
  const node = function () { if (!state.node) state.node = nodeStatus(deps.runNode); return state.node; };

  if (state.mode === 'provider') {
    const changed = new vscode.EventEmitter();
    context.subscriptions.push(changed);
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: function () {
        return offered(vscode, context, deps.platform).map(function (s) {
          const d = new vscode.McpStdioServerDefinition(s.name, s.command, s.args, s.env, s.version);
          return d;
        });
      }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (e) {
      if (e.affectsConfiguration('dewaSpecBuilder.fioriMcp')) changed.fire();
    }));
  }

  /* first start: warn about Node once; on older VS Code offer the mcp.json entries once */
  if (cfg(vscode).enabled && !context.globalState.get(NOTICE_KEY)) {
    context.globalState.update(NOTICE_KEY, true);
    const n = node();
    if (!n.ok) {
      vscode.window.showWarningMessage('The Fiori agent (dewa-fiori) needs Node.js 20.17 or later for the SAP Fiori and UI5 MCP servers' +
        (n.version ? ' – found ' + n.version : ' – Node.js was not found') + '.', 'Download Node.js').then(function (b) {
        if (b) vscode.env.openExternal(vscode.Uri.parse(NODE_URL));
      });
    } else if (state.mode === 'mcp.json' && offered(vscode, context, deps.platform).length) {
      vscode.window.showInformationMessage('The Fiori agent (dewa-fiori) uses the SAP Fiori and UI5 MCP servers. This VS Code version cannot add them automatically.',
        'Add to my mcp.json').then(function (b) { if (b) reportAdd(vscode, addToUserMcp(vscode, context, deps.platform)); });
    }
  }

  context.subscriptions.push(vscode.commands.registerCommand('dewa.specBuilder.checkFioriMcp', function () {
    const c = cfg(vscode);
    const n = node();
    const taken = definedNames(mcpFiles(vscode, context));
    const lines = servers(c, deps.platform).map(function (s) {
      return s.name + ': ' + (!c.enabled ? 'off (dewaSpecBuilder.fioriMcp.enabled)' : taken[s.name] ? 'from your mcp.json (' + taken[s.name] + ')' :
        state.mode === 'provider' ? 'provided by DEWA Spec Builder, version ' + s.version : 'not configured – use "Add to my mcp.json"');
    });
    const msg = 'Fiori MCP servers – ' + lines.join(' · ') + ' · Node.js ' + (n.version || 'not found') + (n.ok ? '' : ' (needs 20.17+)') +
      ' · allowed domains: ' + c.allowedDomains + (c.caCertFile ? ' · CA: ' + c.caCertFile : '');
    const buttons = [];
    if (state.mode === 'mcp.json' && c.enabled) buttons.push('Add to my mcp.json');
    buttons.push('Settings');
    if (!n.ok) buttons.push('Download Node.js');
    return vscode.window[n.ok ? 'showInformationMessage' : 'showWarningMessage'](msg, ...buttons).then(function (b) {
      if (b === 'Add to my mcp.json') reportAdd(vscode, addToUserMcp(vscode, context, deps.platform));
      if (b === 'Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'dewaSpecBuilder.fioriMcp');
      if (b === 'Download Node.js') vscode.env.openExternal(vscode.Uri.parse(NODE_URL));
      return b;
    });
  }));
  return state;
}

function reportAdd(vscode, r) {
  if (r.error) { vscode.window.showErrorMessage(r.error); return; }
  vscode.window.showInformationMessage((r.added.length ? 'Added ' + r.added.join(', ') + ' to ' + r.file + '.' : 'Nothing added.') +
    (r.kept.length ? ' Kept your own ' + r.kept.join(', ') + '.' : '') + ' Start them from the MCP server list in Copilot Chat.');
}

module.exports = { activate: activate, servers: servers, offered: offered, addToUserMcp: addToUserMcp, nodeStatus: nodeStatus, readJsonc: readJsonc,
  userMcpPath: userMcpPath, hasProviderApi: hasProviderApi, PROVIDER_ID: PROVIDER_ID, NAMES: NAMES, DEFAULTS: DEFAULTS };
