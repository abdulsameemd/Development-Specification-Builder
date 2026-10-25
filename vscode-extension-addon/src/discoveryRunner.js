'use strict';
/* Automatic, read-only SAP discovery inside VS Code: the dewa-fs-discovery instructions run on the GitHub
   Copilot language model (vscode.lm) with ONLY the read tools of the SAP MCP servers.

   Read-only is enforced twice:
   1. allow-list – only tools whose name matches dewaSpecBuilder.discoveryTools are offered to the model;
   2. deny-list  – any tool whose name contains a write verb (create, update, delete, activate, transport, …)
      is removed even when allow-listed, and a call to a tool that was not offered is refused. */

const WRITE_VERBS = ['create', 'update', 'delete', 'remove', 'change', 'modify', 'edit', 'write', 'save', 'activate',
  'deactivate', 'lock', 'unlock', 'transport', 'release', 'import', 'deploy', 'publish', 'run', 'execute', 'exec',
  'post', 'insert', 'set', 'patch', 'put', 'rename', 'move', 'copy', 'format', 'refactor', 'generate', 'commit',
  'submit', 'assign', 'install', 'upload'];
const DEFAULT_ALLOW = ['*abap*', '*adt*', '*fiori*', '*ui5*', '*cap*'];
const DEFAULT_ROUNDS = 25;
const JUSTIFICATION = 'Reads the connected SAP system (read-only) to fill in the system context of a functional specification.';

/* "getObjectSource", "abap_adt-get-object" → ['get', 'object', 'source'] … */
function words(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function isWriteTool(name) { return words(name).some(function (w) { return WRITE_VERBS.indexOf(w) >= 0; }); }
function globToRegExp(g) { return new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); }

function selectTools(all, allowPatterns, exclude) {
  const allow = (allowPatterns && allowPatterns.length ? allowPatterns : DEFAULT_ALLOW).map(globToRegExp);
  const allowed = [], blocked = [];
  (all || []).forEach(function (t) {
    if (!t || !t.name || (exclude || []).indexOf(t.name) >= 0) return;
    if (!allow.some(function (re) { return re.test(t.name); })) return;
    (isWriteTool(t.name) ? blocked : allowed).push(t);
  });
  return { allowed: allowed, blocked: blocked };
}

/* Short, human label for a tool call: "abap_get_object BSIK". */
function describeCall(call) {
  const input = call.input && typeof call.input === 'object' ? call.input : {};
  const key = ['name', 'objectName', 'object', 'query', 'uri', 'path', 'appId', 'id'].filter(function (k) { return typeof input[k] === 'string'; })[0];
  const first = key ? input[key] : Object.keys(input).map(function (k) { return input[k]; }).filter(function (v) { return typeof v === 'string'; })[0];
  return call.name + (first ? ' ' + String(first).slice(0, 60) : '');
}

function resultSize(result) {
  return ((result && result.content) || []).reduce(function (n, p) { return n + (typeof p.value === 'string' ? p.value.length : 0); }, 0);
}

function cancelled(token) {
  if (token && token.isCancellationRequested) { const e = new Error('Discovery stopped.'); e.code = 'CANCELLED'; throw e; }
}

/* opts: { prompt, instructions, allowPatterns, maxRounds, token, onProgress, exclude } → final model text */
async function run(vscode, opts) {
  const progress = opts.onProgress || function () {};
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models || !models.length) {
    const e = new Error('No GitHub Copilot language model is available. Sign in to GitHub Copilot in VS Code and allow this extension to use it.');
    e.code = 'NO_MODEL';
    throw e;
  }
  const model = models[0];
  const tools = selectTools(vscode.lm.tools, opts.allowPatterns, opts.exclude);
  tools.blocked.forEach(function (t) { progress({ key: 'blocked:' + t.name, text: 'Write tool excluded: ' + t.name, status: 'blocked' }); });
  if (!tools.allowed.length) {
    const e = new Error('No read tools of the SAP MCP servers are available to extensions. Check that the MCP servers are running and that the setting dewaSpecBuilder.discoveryTools matches their tool names, or use "Run in Copilot Chat".');
    e.code = 'NO_TOOLS';
    throw e;
  }
  progress({ key: 'model', text: 'Model ' + (model.name || model.id || 'Copilot') + ' · ' + tools.allowed.length + ' read tools', status: 'info' });

  const names = tools.allowed.map(function (t) { return t.name; });
  const offered = tools.allowed.map(function (t) { return { name: t.name, description: t.description || '', inputSchema: t.inputSchema }; });
  const M = vscode.LanguageModelChatMessage;
  const messages = [M.User(String(opts.instructions || '') + '\n\n---\n\n' + String(opts.prompt || ''))];
  const maxRounds = Math.max(1, Math.min(60, Number(opts.maxRounds) || DEFAULT_ROUNDS));

  for (let round = 0; round < maxRounds; round++) {
    cancelled(opts.token);
    const response = await model.sendRequest(messages, { tools: offered, justification: JUSTIFICATION }, opts.token);
    let text = '';
    const calls = [];
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) text += part.value;
      else if (part instanceof vscode.LanguageModelToolCallPart) calls.push(part);
    }
    if (!calls.length) return text;

    messages.push(M.Assistant((text ? [new vscode.LanguageModelTextPart(text)] : []).concat(calls)));
    const results = [];
    for (const call of calls) {
      cancelled(opts.token);
      const key = 'call:' + call.callId;
      if (names.indexOf(call.name) < 0 || isWriteTool(call.name)) {
        progress({ key: key, text: 'Refused (not a read tool): ' + call.name, status: 'blocked' });
        results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart('Refused: this discovery is read-only and the tool is not allowed.')]));
        continue;
      }
      progress({ key: key, text: describeCall(call), status: 'running' });
      try {
        const r = await vscode.lm.invokeTool(call.name, { input: call.input, toolInvocationToken: undefined }, opts.token);
        progress({ key: key, text: describeCall(call) + ' · ' + resultSize(r) + ' chars', status: 'done' });
        results.push(new vscode.LanguageModelToolResultPart(call.callId, r.content));
      } catch (err) {
        cancelled(opts.token);
        progress({ key: key, text: describeCall(call) + ' · ' + String(err && err.message || err).slice(0, 120), status: 'error' });
        results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart('Tool error: ' + String(err && err.message || err))]));
      }
    }
    messages.push(M.User(results));
  }

  // Round limit reached: ask for the pack with what was read so far, without tools.
  progress({ key: 'final', text: 'Tool limit reached – asking for the context pack', status: 'info' });
  messages.push(M.User('Stop calling tools. Return the summary and the context pack now, based only on what you read.'));
  const last = await model.sendRequest(messages, { justification: JUSTIFICATION }, opts.token);
  let text = '';
  for await (const part of last.stream) if (part instanceof vscode.LanguageModelTextPart) text += part.value;
  return text;
}

/* Agent file → plain instructions (front matter removed). */
function instructionsFromAgentFile(text) { return String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(); }

module.exports = { run: run, selectTools: selectTools, isWriteTool: isWriteTool, words: words, describeCall: describeCall, instructionsFromAgentFile: instructionsFromAgentFile, DEFAULT_ALLOW: DEFAULT_ALLOW, WRITE_VERBS: WRITE_VERBS };
