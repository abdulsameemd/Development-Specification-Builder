'use strict';
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runner = require('../src/discoveryRunner');
const submitTool = require('../src/submitPackTool');
const panel = require('../src/specBuilderPanel');
const index = require('../src/index');
const MARKER = require('../src/fsDiscovery').MARKER;

/* ---------------------------------------------------------------- fake vscode */
class TextPart { constructor(v) { this.value = v; } }
class ToolCallPart { constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; } }
class ToolResultPart { constructor(callId, content) { this.callId = callId; this.content = content; } }
class ToolResult { constructor(content) { this.content = content; } }

/* script: array of model turns; each turn is a list of parts ({text} or {call:[name,input]}) */
function fakeVscode(o) {
  o = o || {};
  const calls = { invoked: [], requests: [], posts: [], commands: [], saved: [], registered: {} };
  let turn = 0;
  const model = {
    name: 'GPT test',
    sendRequest: async function (messages, options) {
      calls.requests.push({ messages: messages.slice(), tools: (options.tools || []).map(function (t) { return t.name; }) });
      const parts = (o.script || [[{ text: 'done' }]])[Math.min(turn++, (o.script || [1]).length - 1)];
      return { stream: (async function* () { for (const p of parts) yield p.call ? new ToolCallPart('c' + turn + p.call[0], p.call[0], p.call[1]) : new TextPart(p.text); })() };
    }
  };
  const vscode = {
    calls: calls,
    LanguageModelTextPart: TextPart, LanguageModelToolCallPart: ToolCallPart, LanguageModelToolResultPart: ToolResultPart, LanguageModelToolResult: ToolResult,
    LanguageModelChatMessage: { User: function (c) { return { role: 'user', content: c }; }, Assistant: function (c) { return { role: 'assistant', content: c }; } },
    CancellationTokenSource: function () { this.token = { isCancellationRequested: false }; this.cancel = function () { this.token.isCancellationRequested = true; }; this.dispose = function () {}; },
    lm: {
      selectChatModels: async function () { return o.noModel ? [] : [model]; },
      tools: o.tools || [{ name: 'abap_adt_get_object', description: 'read' }, { name: 'abap_adt_create_object' }, { name: 'abapAdtActivateObject' }, { name: 'fiori_search_apps' }, { name: 'copilot_readFile' }],
      invokeTool: async function (name, opts) {
        calls.invoked.push(name);
        if (o.onInvoke) o.onInvoke(name);
        if (o.toolError) throw new Error('boom');
        return new ToolResult([new TextPart('{"name":"BSIK"}')]);
      },
      registerTool: function (name, impl) { calls.registered[name] = impl; return { dispose() {} }; }
    },
    extensions: { getExtension: function () { return o.noCopilot ? undefined : {}; } },
    authentication: {
      getSession: async function (p, s, opt) { return o.signedOut && !opt.createIfNone ? undefined : { account: { label: 'consultant@dewa' } }; },
      onDidChangeSessions: function () { return { dispose() {} }; }
    },
    env: { clipboard: { text: o.clipboard || '', readText: async function () { return this.text; }, writeText: async function (t) { this.text = t; } }, openExternal: async function () {} },
    commands: {
      executeCommand: async function (id, args) { calls.commands.push({ id: id, args: args }); if (o.rejectMode && args && args.mode !== 'agent') throw new Error('unknown mode'); },
      registerCommand: function (id, fn) { calls.registered[id] = fn; return { dispose() {} }; }
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/ws' } }],
      fs: { writeFile: async function (uri, bytes) { calls.saved.push({ uri: uri, bytes: Buffer.from(bytes) }); } },
      getConfiguration: function () { return { get: function (k, d) { return (o.config || {})[k] !== undefined ? o.config[k] : d; } }; }
    },
    Uri: { joinPath: function (u, n) { return { fsPath: path.join(u.fsPath, n) }; }, file: function (p) { return { fsPath: p }; } },
    window: {
      showSaveDialog: async function (opt) { calls.saveDialog = opt; return o.cancelSave ? undefined : opt.defaultUri; },
      showInformationMessage: async function () {}, showTextDocument: async function () {},
      createWebviewPanel: function () { return fakePanel(calls); },
      registerWebviewPanelSerializer: function (t, s) { calls.registered['serializer:' + t] = s; return { dispose() {} }; },
      registerUriHandler: function (h) { calls.registered.uri = h; return { dispose() {} }; },
      createStatusBarItem: function () { return { show() { calls.registered.status = this; }, dispose() {} }; }
    },
    StatusBarAlignment: { Right: 2 }, ViewColumn: { Active: -1 }
  };
  return vscode;
}
function fakePanel(calls) {
  const p = { webview: { cspSource: 'vscode-resource:', options: null, html: '', posted: [], postMessage: async function (m) { p.webview.posted.push(m); return true; }, onDidReceiveMessage: function (fn) { p.receive = fn; return { dispose() {} }; } },
    reveal: function () { p.revealed = true; }, onDidDispose: function (fn) { p.dispose = fn; } };
  calls.panel = p;
  return p;
}
function fakeContext(dir) {
  const state = {};
  return { extensionPath: dir || os.tmpdir(), subscriptions: [], globalState: { get: function (k, d) { return state[k] === undefined ? d : state[k]; }, update: async function (k, v) { state[k] = v; } }, state: state };
}
function router(vs, ctx) {
  const posts = [];
  const r = panel.createRouter(vs, ctx || fakeContext(), {
    post: function (m) { posts.push(m); },
    getAuth: async function () { return { copilot: !vs.calls.noCopilot, signedIn: true, account: 'consultant@dewa' }; },
    signIn: async function () {},
    agentInstructions: function () { return 'READ ONLY'; },
    config: function () { return vs.workspace.getConfiguration(); }
  });
  return { r: r, posts: posts };
}

/* ------------------------------------------------------------ tool selection */
test('write tools are excluded even when allow-listed; non-SAP tools are not offered', () => {
  const t = runner.selectTools([{ name: 'abap_adt_get_object' }, { name: 'abap_adt_create_object' }, { name: 'abapAdtActivateObject' }, { name: 'adt_run_unit_tests' }, { name: 'fiori_search_apps' }, { name: 'copilot_readFile' }, { name: 'adt_get_dataset_info' }], []);
  assert.deepStrictEqual(t.allowed.map((x) => x.name), ['abap_adt_get_object', 'fiori_search_apps', 'adt_get_dataset_info']);
  assert.deepStrictEqual(t.blocked.map((x) => x.name), ['abap_adt_create_object', 'abapAdtActivateObject', 'adt_run_unit_tests']);
  assert.deepStrictEqual(runner.selectTools([{ name: 'srv_lookup' }, { name: 'x_lookup' }], ['srv_*']).allowed.map((x) => x.name), ['srv_lookup']);
});

/* --------------------------------------------------------------- tool loop */
test('runs the tool loop with read tools only and returns the final answer', async () => {
  const vs = fakeVscode({ script: [[{ text: 'Checking' }, { call: ['abap_adt_get_object', { name: 'BSIK' }] }], [{ text: 'Summary\n```json\n{"kind":"dewa-sap-context-pack","version":1}\n```' }]] });
  const progress = [];
  const text = await runner.run(vs, { prompt: MARKER + ' x', instructions: 'READ ONLY', onProgress: (p) => progress.push(p) });
  assert.match(text, /dewa-sap-context-pack/);
  assert.deepStrictEqual(vs.calls.invoked, ['abap_adt_get_object']);
  assert.deepStrictEqual(vs.calls.requests[0].tools, ['abap_adt_get_object', 'fiori_search_apps']);
  assert.ok(progress.some((p) => p.status === 'done' && /BSIK/.test(p.text)));
  assert.ok(progress.some((p) => p.status === 'blocked' && /create_object/.test(p.text)));
  assert.match(vs.calls.requests[0].messages[0].content, /^READ ONLY[\s\S]*DEWA-FS-DISCOVERY v1/);
});

test('refuses a call to a tool that was not offered (e.g. a write tool)', async () => {
  const vs = fakeVscode({ script: [[{ call: ['abap_adt_create_object', { name: 'ZX' }] }], [{ text: 'ok' }]] });
  const progress = [];
  await runner.run(vs, { prompt: 'p', onProgress: (p) => progress.push(p) });
  assert.deepStrictEqual(vs.calls.invoked, []);
  assert.ok(progress.some((p) => p.status === 'blocked' && /Refused/.test(p.text)));
});

test('stops at the round limit and asks for the pack without tools', async () => {
  const vs = fakeVscode({ script: [[{ call: ['fiori_search_apps', { query: 'aging' }] }], [{ call: ['fiori_search_apps', { query: 'aging' }] }], [{ text: 'final' }]] });
  const text = await runner.run(vs, { prompt: 'p', maxRounds: 2 });
  assert.strictEqual(text, 'final');
  assert.strictEqual(vs.calls.requests.length, 3);
  assert.deepStrictEqual(vs.calls.requests[2].tools, []);
});

test('reports tool errors to the model and keeps going', async () => {
  const vs = fakeVscode({ toolError: true, script: [[{ call: ['fiori_search_apps', {}] }], [{ text: 'after error' }]] });
  assert.strictEqual(await runner.run(vs, { prompt: 'p' }), 'after error');
});

test('cancellation stops the loop', async () => {
  const token = { isCancellationRequested: false };
  const vs = fakeVscode({ onInvoke: () => { token.isCancellationRequested = true; }, script: [[{ call: ['fiori_search_apps', {}] }, { call: ['abap_adt_get_object', {}] }], [{ text: 'x' }]] });
  await assert.rejects(runner.run(vs, { prompt: 'p', token: token }), (e) => e.code === 'CANCELLED');
  assert.deepStrictEqual(vs.calls.invoked, ['fiori_search_apps']);
});

test('clear errors when no model or no SAP tools are available', async () => {
  await assert.rejects(runner.run(fakeVscode({ noModel: true }), { prompt: 'p' }), (e) => e.code === 'NO_MODEL');
  await assert.rejects(runner.run(fakeVscode({ tools: [{ name: 'copilot_readFile' }] }), { prompt: 'p' }), (e) => e.code === 'NO_TOOLS');
});

test('agent front matter is stripped from the instructions', () => {
  const md = fs.readFileSync(path.join(__dirname, '../agents/dewa-fs-discovery.agent.md'), 'utf8');
  const ins = runner.instructionsFromAgentFile(md);
  assert.ok(!/^---/.test(ins) && /Read only/i.test(ins));
});

/* ------------------------------------------------------------- submit tool */
test('submit tool delivers a valid pack and rejects other input', async () => {
  const vs = fakeVscode();
  const got = [];
  submitTool.register(vs, async (p) => { got.push(p); return true; });
  const tool = vs.calls.registered.dewa_submitContextPack;
  const ok = await tool.invoke({ input: { kind: 'dewa-sap-context-pack', version: 1 } });
  assert.strictEqual(got.length, 1);
  assert.match(ok.content[0].value, /imported/);
  const bad = await tool.invoke({ input: { kind: 'other' } });
  assert.strictEqual(got.length, 1);
  assert.match(bad.content[0].value, /Not sent/);
});

/* ----------------------------------------------------------------- HTML */
test('every script gets the nonce, a strict CSP and the host seed are injected', () => {
  const raw = '<!doctype html><html><head><meta charset="utf-8"><script>var a="</scr"+"ipt>";</script></head><body><script>x()</script><script src="x.js"></script></body></html>';
  const html = panel.buildHtml(raw, { nonce: 'N0', cspSource: 'vscode-resource:', storage: { 'apb.k': '</script><script>alert(1)</script>' } });
  assert.strictEqual((html.match(/<script(?=[\s>])/g) || []).length, (html.match(/<script nonce="N0"/g) || []).length);
  assert.match(html, /Content-Security-Policy" content="default-src 'none';[^"]*script-src 'nonce-N0';/);
  assert.match(html, /window\.APB_HOST = \{"kind":"vscode"/);
  assert.ok(!/alert\(1\)<\/script>/.test(html.split('window.APB_HOST')[1].split(';</script>')[0]), 'seed cannot close the script tag');
});

test('the packaged builder works under the CSP: no inline handlers, all scripts nonced', () => {
  const dist = path.join(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
  const html = panel.buildHtml(fs.readFileSync(dist, 'utf8'), { nonce: 'N1', cspSource: 'x' });
  assert.ok(!/\son(click|load|input|change|submit)=/i.test(html));
  assert.ok(!/<script(?![^>]*nonce="N1")(?=[\s>])/i.test(html));
  assert.ok(!/<(link|script)[^>]+(href|src)="https?:/i.test(html), 'no remote resources');
});

/* ---------------------------------------------------------------- router */
test('router ignores unknown or malformed messages', async () => {
  const { r } = router(fakeVscode());
  assert.strictEqual(await r.handle({ type: 'eval', code: '1' }), false);
  assert.strictEqual(await r.handle(null), false);
  assert.strictEqual(await r.handle({ type: 'storage', key: 'other.key', value: 'x' }), false);
  assert.strictEqual(await r.handle({ type: 'open-chat', agent: 'some-agent', prompt: 'x' }), false);
  assert.strictEqual(await r.handle({ type: 'discover', mode: 'auto', prompt: 'no marker' }), false);
});

test('storage messages persist in globalState', async () => {
  const ctx = fakeContext();
  const { r } = router(fakeVscode(), ctx);
  await r.handle({ type: 'storage', key: 'apb.drafts.v1', value: '{"a":1}' });
  assert.deepStrictEqual(ctx.globalState.get(panel.STORAGE_KEY), { 'apb.drafts.v1': '{"a":1}' });
  await r.handle({ type: 'storage', key: 'apb.drafts.v1', value: null });
  assert.deepStrictEqual(ctx.globalState.get(panel.STORAGE_KEY), {});
});

test('save-file writes through a save dialog in the workspace folder with a safe name', async () => {
  const vs = fakeVscode();
  const { r, posts } = router(vs);
  await r.handle({ type: 'save-file', name: '../../etc/FS_FI.docx', mime: 'x', base64: Buffer.from('PK').toString('base64') });
  assert.strictEqual(vs.calls.saveDialog.defaultUri.fsPath, path.join('/ws', 'FS_FI.docx'));
  assert.strictEqual(vs.calls.saved[0].bytes.toString(), 'PK');
  assert.ok(posts.some((p) => p.type === 'saved'));
  assert.strictEqual(panel.safeName('evil.exe'), 'evil.exe.md');
});

test('clipboard read/write reply to the request id', async () => {
  const vs = fakeVscode({ clipboard: 'pack' });
  const { r, posts } = router(vs);
  await r.handle({ type: 'clipboard-read', id: 'r1' });
  assert.deepStrictEqual(posts.pop(), { type: 'reply', id: 'r1', ok: true, value: 'pack' });
  await r.handle({ type: 'clipboard-write', id: 'r2', text: 'hello' });
  assert.strictEqual(vs.env.clipboard.text, 'hello');
});

test('automatic discovery streams progress and returns the result', async () => {
  const vs = fakeVscode({ script: [[{ call: ['abap_adt_get_object', { name: 'LFA1' }] }], [{ text: '```json\n{"kind":"dewa-sap-context-pack","version":1}\n```' }]] });
  const { r, posts } = router(vs);
  await r.handle({ type: 'discover', mode: 'auto', prompt: MARKER + '\nctx' });
  assert.ok(posts.some((p) => p.type === 'discovery-progress' && /LFA1/.test(p.text)));
  assert.match(posts.filter((p) => p.type === 'discovery-result')[0].text, /dewa-sap-context-pack/);
});

test('chat discovery opens Copilot Chat with the agent and the submit-tool hint', async () => {
  const vs = fakeVscode();
  const { r, posts } = router(vs);
  await r.handle({ type: 'discover', mode: 'chat', prompt: MARKER + '\nctx' });
  const open = vs.calls.commands.find((c) => c.id === 'workbench.action.chat.open');
  assert.strictEqual(open.args.mode, 'dewa-fs-discovery');
  assert.match(open.args.query, /dewa_submitContextPack/);
  assert.ok(posts.some((p) => p.type === 'discovery-progress' && p.status === 'done'));
});

test('open-chat hands a development spec to dewa-abap (with fallback)', async () => {
  const vs = fakeVscode({ rejectMode: true });
  const { r } = router(vs);
  await r.handle({ type: 'open-chat', agent: 'dewa-abap', prompt: 'Implement …' });
  assert.strictEqual(vs.calls.commands.length, 2);
  assert.strictEqual(vs.calls.commands[1].args.mode, 'agent');
  assert.match(vs.calls.commands[1].args.query, /dewa-abap/);
});

/* --------------------------------------------------------------- activate */
test('activate registers command, serializer, tool, status bar and URI routes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media/spec-builder.html'), '<html><head></head><body><script>1</script></body></html>');
  const vs = fakeVscode();
  const ctx = fakeContext(dir);
  const api = index.activate(ctx, vs);
  ['dewa.specBuilder.open', 'serializer:dewaSpecBuilder', 'dewa_submitContextPack', 'uri', 'status'].forEach((k) => assert.ok(vs.calls.registered[k], k));
  assert.deepStrictEqual(await api.handleUri({ path: '/builder', query: '' }), { status: 'opened-builder' });
  assert.match(vs.calls.panel.webview.html, /window\.APB_HOST/);
  // the chat tool delivers into the open panel
  const res = await vs.calls.registered.dewa_submitContextPack.invoke({ input: { kind: 'dewa-sap-context-pack', version: 1 } });
  assert.match(res.content[0].value, /imported/);
  assert.strictEqual(vs.calls.panel.webview.posted.pop().type, 'discovery-result');
  // panel message → router
  await vs.calls.panel.receive({ type: 'auth-status' });
  assert.strictEqual(vs.calls.panel.webview.posted.pop().account, 'consultant@dewa');
});
