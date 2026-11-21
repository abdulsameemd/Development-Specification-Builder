'use strict';
// SAP Fiori + UI5 MCP servers provided by the extension for dewa-fiori (1.0.30).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fioriMcp = require('../src/fioriMcp');

function fake(o) {
  o = o || {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fmcp-'));
  const user = path.join(root, 'User');
  fs.mkdirSync(path.join(user, 'globalStorage', 'dewa.ext'), { recursive: true });
  const ws = path.join(root, 'ws');
  fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
  const conf = Object.assign({}, o.config || {});
  const calls = { providers: [], messages: [], commands: {}, executed: [], external: [], configListeners: [] };
  class EventEmitter { constructor() { this.n = 0; this.event = () => {}; } fire() { this.n++; } dispose() {} }
  class McpStdioServerDefinition { constructor(label, command, args, env, version) { Object.assign(this, { label, command, args, env, version }); } }
  const msg = (kind) => (text, ...buttons) => { calls.messages.push({ kind, text, buttons }); return Promise.resolve(o.answer); };
  const vscode = {
    EventEmitter,
    workspace: {
      getConfiguration: () => ({ get: (k, d) => (k in conf ? conf[k] : d) }),
      workspaceFolders: [{ uri: { fsPath: ws } }],
      onDidChangeConfiguration: (f) => { calls.configListeners.push(f); return { dispose() {} }; }
    },
    window: { showInformationMessage: msg('info'), showWarningMessage: msg('warn'), showErrorMessage: msg('error') },
    commands: { registerCommand: (id, f) => { calls.commands[id] = f; return { dispose() {} }; }, executeCommand: (...a) => { calls.executed.push(a); } },
    env: { openExternal: (u) => calls.external.push(u) },
    Uri: { parse: (s) => s }
  };
  if (!o.noApi) {
    vscode.McpStdioServerDefinition = McpStdioServerDefinition;
    vscode.lm = { registerMcpServerDefinitionProvider: (id, p) => { calls.providers.push({ id, p }); return { dispose() {} }; } };
  }
  const store = {};
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(user, 'globalStorage', 'dewa.ext') },
    globalState: { get: (k) => store[k], update: (k, v) => { store[k] = v; return Promise.resolve(); } } };
  return { vscode, context, calls, conf, user, ws, store };
}
const NODE_OK = { runNode: () => 'v22.11.0', platform: 'linux' };

test('VS Code with the provider API: both servers, pinned, telemetry off, CA and allowed domains', () => {
  const t = fake({ config: { 'fioriMcp.allowedDomains': 'localhost, s4dev.example.internal', 'fioriMcp.caCertFile': '/certs/ca.pem' } });
  const st = fioriMcp.activate(t.context, t.vscode, NODE_OK);
  assert.strictEqual(st.mode, 'provider');
  assert.strictEqual(t.calls.providers[0].id, 'dewa.fioriMcp');
  const defs = t.calls.providers[0].p.provideMcpServerDefinitions();
  assert.deepStrictEqual(defs.map((d) => d.label), ['fiori-mcp', 'ui5-mcp']);
  assert.strictEqual(defs[0].command, 'npx');
  assert.deepStrictEqual(defs[0].args, ['--yes', '--ignore-scripts', '@sap-ux/fiori-mcp-server@1.17.0', 'fiori-mcp']);
  assert.deepStrictEqual(defs[0].env, { SAP_UX_FIORI_TOOLS_DISABLE_TELEMETRY: 'true', LOG_LEVEL: 'error', NODE_EXTRA_CA_CERTS: '/certs/ca.pem' });
  assert.deepStrictEqual(defs[1].args, ['--yes', '@ui5/mcp-server@0.3.3']);
  assert.strictEqual(defs[1].env.UI5_MCP_SERVER_ALLOWED_DOMAINS, 'localhost, s4dev.example.internal');
  assert.strictEqual(t.calls.messages.length, 0, 'no notice when everything is fine');
  assert.strictEqual(fioriMcp.servers({ fioriVersion: '1.17.0', ui5Version: '0.3.3', allowedDomains: 'localhost', caCertFile: '' }, 'win32')[0].command, 'npx.cmd', 'Windows');
});

test('disabled → no servers; settings change fires the change event; versions from settings', () => {
  const t = fake({ config: { 'fioriMcp.enabled': false } });
  fioriMcp.activate(t.context, t.vscode, NODE_OK);
  const p = t.calls.providers[0].p;
  assert.deepStrictEqual(p.provideMcpServerDefinitions(), []);
  t.conf['fioriMcp.enabled'] = true;
  t.conf['fioriMcp.fioriServerVersion'] = '1.18.0';
  t.calls.configListeners[0]({ affectsConfiguration: (k) => k === 'dewaSpecBuilder.fioriMcp' });
  const emitter = t.context.subscriptions.find((s) => s && typeof s.fire === 'function');
  assert.strictEqual(emitter.n, 1);
  assert.match(p.provideMcpServerDefinitions()[0].args.join(' '), /fiori-mcp-server@1\.18\.0/);
});

test('a server the user defines in mcp.json (user or workspace, JSONC) is left to them', () => {
  const t = fake();
  fs.writeFileSync(path.join(t.ws, '.vscode', 'mcp.json'), '{\n // mine\n "servers": { "ui5-mcp": { "command": "npx", "args": ["@ui5/mcp-server"] }, },\n}');
  fioriMcp.activate(t.context, t.vscode, NODE_OK);
  assert.deepStrictEqual(t.calls.providers[0].p.provideMcpServerDefinitions().map((d) => d.label), ['fiori-mcp']);
});

test('older VS Code: one notice, "Add to my mcp.json" merges without overwriting', async () => {
  const t = fake({ noApi: true, answer: 'Add to my mcp.json' });
  const mcp = path.join(t.user, 'mcp.json');
  fs.writeFileSync(mcp, JSON.stringify({ servers: { 'sap-abap-adt': { command: 'x' }, 'fiori-mcp': { command: 'my-own' } } }));
  const st = fioriMcp.activate(t.context, t.vscode, NODE_OK);
  assert.strictEqual(st.mode, 'mcp.json');
  assert.strictEqual(t.calls.providers.length, 0);
  assert.match(t.calls.messages[0].text, /cannot add them automatically/);
  await new Promise((r) => setTimeout(r, 10));
  const j = JSON.parse(fs.readFileSync(mcp, 'utf8'));
  assert.deepStrictEqual(Object.keys(j.servers).sort(), ['fiori-mcp', 'sap-abap-adt', 'ui5-mcp']);
  assert.strictEqual(j.servers['fiori-mcp'].command, 'my-own', 'own entry kept');
  assert.deepStrictEqual(j.servers['ui5-mcp'].args, ['--yes', '@ui5/mcp-server@0.3.3']);
  const again = fake({ noApi: true });
  again.store['dewaSpecBuilder.fioriMcpNotice'] = true;
  fioriMcp.activate(again.context, again.vscode, NODE_OK);
  assert.strictEqual(again.calls.messages.length, 0, 'notice only once');
  assert.ok(fioriMcp.addToUserMcp(t.vscode, t.context, 'linux').added.length === 0, 'second add changes nothing');
  fs.writeFileSync(mcp, '{ broken');
  assert.match(fioriMcp.addToUserMcp(t.vscode, t.context, 'linux').error, /could not be read/);
  assert.strictEqual(fs.readFileSync(mcp, 'utf8'), '{ broken', 'unreadable file never written');
});

test('Node.js check: missing / too old → warning with download; ok → none', () => {
  assert.deepStrictEqual(fioriMcp.nodeStatus(() => 'v22.11.0'), { ok: true, version: 'v22.11.0' });
  assert.deepStrictEqual(fioriMcp.nodeStatus(() => 'v20.17.0'), { ok: true, version: 'v20.17.0' });
  assert.strictEqual(fioriMcp.nodeStatus(() => 'v20.16.1').ok, false);
  assert.strictEqual(fioriMcp.nodeStatus(() => { throw new Error('ENOENT'); }).ok, false);
  const t = fake();
  fioriMcp.activate(t.context, t.vscode, { runNode: () => 'v18.19.0', platform: 'linux' });
  assert.strictEqual(t.calls.messages[0].kind, 'warn');
  assert.match(t.calls.messages[0].text, /needs Node\.js 20\.17 or later .* found v18\.19\.0/);
  assert.deepStrictEqual(t.calls.messages[0].buttons, ['Download Node.js']);
});

test('command "Check Fiori MCP servers" reports the status', async () => {
  const t = fake({ answer: 'Settings' });
  fioriMcp.activate(t.context, t.vscode, NODE_OK);
  await t.calls.commands['dewa.specBuilder.checkFioriMcp']();
  const m = t.calls.messages.pop();
  assert.match(m.text, /fiori-mcp: provided by DEWA Spec Builder, version 1\.17\.0 · ui5-mcp: provided by DEWA Spec Builder, version 0\.3\.3 · Node\.js v22\.11\.0/);
  assert.deepStrictEqual(t.calls.executed[0], ['workbench.action.openSettings', 'dewaSpecBuilder.fioriMcp']);
});

test('the manifest contributes the provider, the command and the settings; the agent has the tools-present rule', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vscode-extension/package.json'), 'utf8'));
  assert.deepStrictEqual(pkg.contributes.mcpServerDefinitionProviders, [{ id: 'dewa.fioriMcp', label: 'DEWA – SAP Fiori and UI5 MCP servers' }]);
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'dewa.specBuilder.checkFioriMcp'));
  const pr = pkg.contributes.configuration.properties;
  assert.strictEqual(pr['dewaSpecBuilder.fioriMcp.enabled'].default, true);
  assert.strictEqual(pr['dewaSpecBuilder.fioriMcp.fioriServerVersion'].default, fioriMcp.DEFAULTS.fioriServerVersion);
  assert.strictEqual(pr['dewaSpecBuilder.fioriMcp.ui5ServerVersion'].default, fioriMcp.DEFAULTS.ui5ServerVersion);
  const md = fs.readFileSync(path.join(__dirname, '../agents/dewa-fiori.agent.md'), 'utf8');
  assert.match(md, /0\. \*\*Tools present\?\*\*[\s\S]*DEWA: Check Fiori MCP servers[\s\S]*Never\s+fall back to hand-written scaffolding/);
});
