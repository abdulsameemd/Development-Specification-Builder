'use strict';
// Agent evals ("DEWA: Test the agents"): scenario files, rule checks, runner with a fake Copilot model, report, command.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ev = require('../src/agentEvals');

const EVALS = path.join(__dirname, '..', 'evals');
const AGENTS = path.join(__dirname, '..', 'agents');

test('scenario files: every agent, ≥ 6 scenarios, unique ids, valid regexes, and the rules separate the good from the bad sample', () => {
  const suites = ev.loadSuites(EVALS);
  assert.deepStrictEqual(suites.map((s) => s.agent).sort(), ['dewa-abap', 'dewa-abap-change', 'dewa-fiori', 'dewa-fiori-review', 'dewa-fs-discovery']);
  for (const s of suites) {
    assert.ok(s.scenarios.length >= 6, s.agent);
    const ids = s.scenarios.map((x) => x.id);
    assert.strictEqual(new Set(ids).size, ids.length, s.agent + ' unique ids');
    for (const c of s.scenarios) {
      const e = c.expect;
      assert.ok(e && (e.mustMatch || e.mustNotMatch || e.anyOf || e.mustAsk), s.agent + '/' + c.id + ' has rules');
      [].concat(e.mustMatch || [], e.mustNotMatch || [], e.anyOf || []).forEach((r) => assert.doesNotThrow(() => new RegExp(r, 'im'), s.agent + '/' + c.id + ' ' + r));
      assert.deepStrictEqual(ev.check(e, c.samples.pass), [], s.agent + '/' + c.id + ' good sample passes');
      assert.ok(ev.check(e, c.samples.fail).length > 0, s.agent + '/' + c.id + ' bad sample fails');
    }
  }
});

test('rule checks: mustMatch, mustNotMatch, anyOf, mustAsk', () => {
  assert.deepStrictEqual(ev.check({ mustMatch: ['CONFIRM CHANGE'] }, 'type confirm change to apply'), [], 'case-insensitive');
  assert.deepStrictEqual(ev.check({ mustMatch: ['CONFIRM CHANGE'] }, 'done'), ['missing: /CONFIRM CHANGE/']);
  assert.deepStrictEqual(ev.check({ mustNotMatch: ['I (have )?saved'] }, 'I have saved it'), ['must not say: /I (have )?saved/']);
  assert.deepStrictEqual(ev.check({ anyOf: ['a', 'b'] }, 'b'), []);
  assert.match(ev.check({ anyOf: ['a1', 'b1'] }, 'c')[0], /^none of: \/a1\/ \/b1\//);
  assert.deepStrictEqual(ev.check({ mustAsk: true }, 'Which field?'), []);
  assert.deepStrictEqual(ev.check({ mustAsk: true }, 'I used VKORG.'), ['does not ask the developer']);
});

/* fake vscode with a Copilot model that answers from a function */
function fake(answerFor, opts) {
  opts = opts || {};
  class LanguageModelTextPart { constructor(v) { this.value = v; } }
  const sent = [];
  const model = { id: 'gpt-test', name: 'GPT Test', family: 'gpt-test', countTokens: async (t) => Math.ceil(String(t).length / 4),
    sendRequest: async (messages) => {
      const text = messages[0].content;
      sent.push(text);
      if (opts.hang && opts.hang(text)) return { stream: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) } };
      const a = answerFor(text);
      return { stream: (async function* () { yield new LanguageModelTextPart(a); })() };
    } };
  const vscode = { LanguageModelTextPart, LanguageModelChatMessage: { User: (t) => ({ role: 'user', content: t }) } };
  return { vscode, model, sent };
}
function ctx(promptsCopy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-'));
  const gs = path.join(root, 'User', 'globalStorage', 'dewa.ext');
  fs.mkdirSync(gs, { recursive: true });
  const ext = path.join(root, 'ext');
  fs.mkdirSync(path.join(ext, 'agents'), { recursive: true });
  for (const f of fs.readdirSync(AGENTS)) fs.copyFileSync(path.join(AGENTS, f), path.join(ext, 'agents', f));
  if (promptsCopy) { fs.mkdirSync(path.join(root, 'User', 'prompts'), { recursive: true }); fs.writeFileSync(path.join(root, 'User', 'prompts', promptsCopy[0]), promptsCopy[1]); }
  return { extensionPath: ext, globalStorageUri: { fsPath: gs } };
}
const suite = (agent) => ev.loadSuites(EVALS).filter((s) => s.agent === agent);

test('runner: dry run with the agent instructions and no tools; good answers pass, bad ones fail with the rule; usage counted', async () => {
  const sc = suite('dewa-fiori')[0].scenarios;
  const byPrompt = (good) => (text) => { const s = sc.find((x) => text.endsWith(x.prompt)); return good ? s.samples.pass : s.samples.fail; };
  let f = fake(byPrompt(true));
  let r = await ev.run(f.vscode, { suites: suite('dewa-fiori'), model: f.model, context: ctx() });
  assert.strictEqual(r.results[0].scenarios.filter((s) => s.pass).length, sc.length);
  assert.match(f.sent[0], /^# dewa-fiori — build the Fiori app/, 'agent instructions first (front matter stripped)');
  assert.match(f.sent[0], /TEST MODE – no tools are available/);
  assert.ok(r.usage.requests === sc.length && r.usage.inputTokens > 0);
  f = fake(byPrompt(false));
  r = await ev.run(f.vscode, { suites: suite('dewa-fiori'), model: f.model, context: ctx() });
  assert.strictEqual(r.results[0].scenarios.filter((s) => s.pass).length, 0);
  assert.ok(r.results[0].scenarios.every((s) => s.failed.length));
  // dewa-abap ships with the DEWA agent kit, not with this extension → skipped with a note
  r = await ev.run(f.vscode, { suites: suite('dewa-abap'), model: f.model, context: ctx() });
  assert.strictEqual(r.results[0].skipped, true);
});

test('runner: the installed (edited) agent copy is tested; a hanging model times out; cancel stops', async () => {
  const f = fake(() => 'ok?');
  const c = ctx(['dewa-fs-discovery.agent.md', '---\ndescription: x\n---\nMY EDITED RULES']);
  const r = await ev.run(f.vscode, { suites: suite('dewa-fs-discovery'), model: f.model, context: c });
  assert.match(f.sent[0], /^MY EDITED RULES/);
  assert.match(r.results[0].source, /User[\\/]prompts[\\/]dewa-fs-discovery\.agent\.md$/);
  const h = fake(() => 'x', { hang: (t) => /create the table/.test(t) });
  const r2 = await ev.run(h.vscode, { suites: suite('dewa-fs-discovery'), model: h.model, context: ctx(), scenarioMs: 100, idleMs: 100 });
  const s = r2.results[0].scenarios.find((x) => x.id === 'read-only-create');
  assert.deepStrictEqual([s.pass, s.failed[0]], [false, 'error: timeout']);
  const token = { isCancellationRequested: false };
  const g = fake(() => { token.isCancellationRequested = true; return 'answer'; });
  const r3 = await ev.run(g.vscode, { suites: suite('dewa-fs-discovery'), model: g.model, context: ctx(), token });
  assert.strictEqual(r3.results[0].scenarios.length, 1);
  assert.strictEqual(r3.results[0].cancelled, true);
});

test('report and command: pass rate per agent, failed rules, saved to .dewa/evals, summary toast', async () => {
  const sc = suite('dewa-abap-change')[0].scenarios;
  const f = fake((text) => { const s = sc.find((x) => text.endsWith(x.prompt)); return s.id === 'diff-first' ? s.samples.fail : s.samples.pass; });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const shown = [], msgs = [];
  const vscode = Object.assign(f.vscode, {
    lm: { selectChatModels: async () => [f.model] },
    workspace: { getConfiguration: () => ({ get: (k, d) => d }), workspaceFolders: [{ uri: { fsPath: ws } }], openTextDocument: async (u) => ({ u }) },
    window: { showQuickPick: async (items) => items, withProgress: async (o, fn) => fn({ report() {} }, { isCancellationRequested: false }),
      showTextDocument: async (d) => shown.push(d), showInformationMessage: (m) => msgs.push(m), showErrorMessage: (m) => msgs.push('ERR ' + m) },
    ProgressLocation: { Notification: 15 }, Uri: { file: (p) => ({ fsPath: p }) }
  });
  const out = await ev.command(vscode, ctx(), { agents: ['dewa-abap-change'], evalsDir: EVALS });
  assert.match(out.report, /\| dewa-abap-change \| 5 \/ 6 \|/);
  assert.match(out.report, /\| Normal change → diff shown, waits for CONFIRM CHANGE \| ✗ fail \| missing: \/CONFIRM CHANGE\//);
  assert.match(out.savedTo, /\.dewa[\\/]evals[\\/]\d{4}-\d{2}-\d{2}-gpt-test_GPT_Test_gpt-test\.md$/);
  assert.strictEqual(fs.readFileSync(out.savedTo, 'utf8'), out.report);
  assert.strictEqual(shown.length, 1);
  assert.match(msgs[0], /^Agent evals: dewa-abap-change 5\/6 – saved to \.dewa\/evals$/);
});

test('extension: the command is contributed and the evals ship in the package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vscode-extension/package.json'), 'utf8'));
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'dewa.specBuilder.testAgents'));
  assert.match(fs.readFileSync(path.join(__dirname, '../../vscode-extension/extension.js'), 'utf8'), /registerCommand\('dewa\.specBuilder\.testAgents'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../../scripts/build-vsix.js'), 'utf8'), /vscode-extension-addon\/evals/);
});
