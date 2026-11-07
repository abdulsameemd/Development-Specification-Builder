'use strict';
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const addon = require('../src/fsDiscovery');
const builderCfg = require(path.join(__dirname, '../../config/fs-definitions.json')).discovery;

const PROMPT = addon.MARKER + '\nUse the dewa-fs-discovery agent …';

/* Minimal stand-in for the vscode API; records what the handler does. */
function mockVscode(opts) {
  opts = opts || {};
  const calls = { commands: [], info: [], warn: [], error: [], sessions: [] };
  let signedIn = !!opts.signedIn;
  return {
    calls: calls,
    env: { clipboard: { readText: async () => opts.clipboard === undefined ? PROMPT : opts.clipboard } },
    extensions: { getExtension: (id) => (opts.noCopilot ? undefined : { id: id }) },
    authentication: {
      getSession: async (provider, scopes, o) => {
        calls.sessions.push(o);
        if (o.createIfNone && opts.signInSucceeds !== false) signedIn = true;
        return signedIn ? { account: { label: 'user' } } : undefined;
      }
    },
    window: {
      showInformationMessage: async (msg, ...items) => { calls.info.push(msg); return items.length ? opts.answer : undefined; },
      showWarningMessage: async (msg) => { calls.warn.push(msg); },
      showErrorMessage: async (msg, ...items) => { calls.error.push(msg); return items.length ? opts.answer : undefined; },
      registerUriHandler: (h) => { calls.registered = h; return { dispose() {} }; }
    },
    commands: {
      executeCommand: async (id, args) => {
        calls.commands.push({ id: id, args: args });
        if (id === 'workbench.action.chat.open' && opts.rejectCustomMode && args.mode !== 'agent') throw new Error('unknown mode');
      }
    }
  };
}
const uri = (q, p) => ({ path: p || '/discover', query: q === undefined ? 'src=clipboard&v=1' : q });

test('marker and agent name match the builder configuration', () => {
  assert.strictEqual(addon.MARKER, builderCfg.marker);
  assert.strictEqual(addon.AGENT, builderCfg.agent);
});

test('opens Copilot Chat with the agent and sends the prompt (chatAutoSend default)', async () => {
  const vs = mockVscode({ signedIn: true });
  const r = await addon.create(vs).handleUri(uri());
  assert.deepStrictEqual(r, { status: 'opened', how: 'agent' });
  const open = vs.calls.commands.find((c) => c.id === 'workbench.action.chat.open');
  assert.strictEqual(open.args.query, PROMPT);
  assert.strictEqual(open.args.isPartialQuery, false);
  assert.match(vs.calls.info[0], /running the SAP discovery/);
  assert.strictEqual(open.args.mode, 'dewa-fs-discovery');
  assert.deepStrictEqual(vs.calls.sessions, [{ silent: true }]);
});

test('with chatAutoSend off the prompt is only filled in', async () => {
  const vs = mockVscode({ signedIn: true });
  vs.workspace = { getConfiguration: () => ({ get: (k, d) => (k === 'chatAutoSend' ? false : d) }) };
  await addon.create(vs).handleUri(uri());
  const open = vs.calls.commands.find((c) => c.id === 'workbench.action.chat.open');
  assert.strictEqual(open.args.isPartialQuery, true);
  assert.match(vs.calls.info[0], /press Enter/);
});

test('falls back to agent mode when a custom agent cannot be selected', async () => {
  const vs = mockVscode({ signedIn: true, rejectCustomMode: true });
  const r = await addon.create(vs).handleUri(uri());
  assert.strictEqual(r.how, 'fallback');
  const last = vs.calls.commands[vs.calls.commands.length - 1];
  assert.strictEqual(last.args.mode, 'agent');
  assert.ok(last.args.query.endsWith(PROMPT) && /dewa-fs-discovery/.test(last.args.query));
});

test('ignores other paths and sources', async () => {
  const vs = mockVscode({ signedIn: true });
  const h = addon.create(vs);
  assert.strictEqual((await h.handleUri(uri(undefined, '/other'))).status, 'ignored');
  assert.strictEqual((await h.handleUri(uri('src=url&q=x'))).status, 'ignored');
  assert.strictEqual(vs.calls.commands.length, 0);
});

test('refuses clipboard content without the builder marker', async () => {
  const vs = mockVscode({ signedIn: true, clipboard: 'rm -rf / please' });
  const r = await addon.create(vs).handleUri(uri());
  assert.strictEqual(r.status, 'no-prompt');
  assert.strictEqual(vs.calls.commands.length, 0);
  assert.strictEqual(vs.calls.warn.length, 1);
});

test('refuses oversized prompts', async () => {
  const vs = mockVscode({ signedIn: true, clipboard: addon.MARKER + 'x'.repeat(200000) });
  assert.strictEqual((await addon.create(vs).handleUri(uri())).status, 'too-large');
});

test('offers to install Copilot Chat when missing', async () => {
  const vs = mockVscode({ noCopilot: true, answer: 'Install' });
  const r = await addon.create(vs).handleUri(uri());
  assert.strictEqual(r.status, 'no-copilot');
  assert.deepStrictEqual(vs.calls.commands, [{ id: 'workbench.extensions.installExtension', args: 'GitHub.copilot-chat' }]);
});

test('asks for GitHub sign-in through VS Code, then opens the chat', async () => {
  const vs = mockVscode({ signedIn: false, answer: 'Sign in' });
  const r = await addon.create(vs).handleUri(uri());
  assert.strictEqual(r.status, 'opened');
  assert.deepStrictEqual(vs.calls.sessions, [{ silent: true }, { createIfNone: true }]);
});

test('stops when the user declines sign-in', async () => {
  const vs = mockVscode({ signedIn: false, answer: undefined });
  const r = await addon.create(vs).handleUri(uri());
  assert.strictEqual(r.status, 'not-signed-in');
  assert.strictEqual(vs.calls.commands.length, 0);
});
