'use strict';
/* AI draft of a functional specification with the GitHub Copilot language model (vscode.lm). No tools are
   offered: the model only sees the business requirement the builder sends, and the builder shows the result
   for review before anything is added to the spec. */

const { pickModel, withTimeout, readStream, IDLE_MS } = require('./discoveryRunner');
const guardrails = require('./guardrails');

const MARKER = 'FS-DRAFT v1';
const JUSTIFICATION = 'Drafts the missing parts of a functional specification from its business requirement.';

function hasDraft(text) { return /\{[\s\S]*\}/.test(text || '') && /"(frs|toBe|objectives|currentLogic|asIs|programs)"/.test(text || ''); }

function cancelled(token) {
  if (token && token.isCancellationRequested) { const e = new Error('Drafting stopped.'); e.code = 'CANCELLED'; throw e; }
}

async function ask(vscode, meter, messages, token, idleMs) {
  // a Copilot answer that stops arriving for idleMs ends the job with a clear error instead of waiting forever
  const response = await withTimeout(meter.send(messages, { justification: JUSTIFICATION }, token), idleMs, 'MODEL_TIMEOUT', 'Copilot');
  let out = '';
  await readStream(response.stream, idleMs, function (part) { if (part instanceof vscode.LanguageModelTextPart) out += part.value; cancelled(token); });
  await meter.answered(out, [], token);
  return out;
}

/* opts: { prompt, model, token, onProgress, guard: { allowedModels } } → the model's answer (text with one ```json block) */
async function run(vscode, opts) {
  const progress = opts.onProgress || function () {};
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models || !models.length) {
    const e = new Error('No GitHub Copilot language model is available. Sign in to GitHub Copilot in VS Code and allow this extension to use it.');
    e.code = 'NO_MODEL';
    throw e;
  }
  const allowedList = (opts.guard && opts.guard.allowedModels) || [];
  const allowed = guardrails.allowedModels(models, allowedList);
  if (!allowed.length) throw guardrails.notAllowedError(models, allowedList);
  const model = pickModel(allowed, opts.model);
  progress({ text: 'Model ' + (model.name || model.id || 'Copilot') + ' · drafting…' });
  const guard = opts.guard || {};
  const ev = guard.evidence = guard.evidence || { calls: [], names: [], flags: 0, masked: 0 };
  const meter = guardrails.meter(model, ev, function () { progress({ key: 'usage', text: guardrails.usageLine(ev), status: 'info' }); });
  const M = vscode.LanguageModelChatMessage;
  const messages = [M.User(String(opts.prompt || ''))];
  cancelled(opts.token);
  const idleMs = opts.idleMs !== undefined ? Number(opts.idleMs) : IDLE_MS;
  const text = await ask(vscode, meter, messages, opts.token, idleMs);
  if (hasDraft(text)) return text;
  // One repair turn when the JSON is missing (small models sometimes answer in prose only).
  progress({ text: 'Asking for the JSON block…' });
  messages.push(M.Assistant([new vscode.LanguageModelTextPart(text || '(no answer)')]));
  messages.push(M.User('Return the draft now as exactly one ```json block (kind "fs-draft", version 1) with the structure from the first message.'));
  const again = await ask(vscode, meter, messages, opts.token, idleMs);
  return hasDraft(again) ? again : [text, again].filter(Boolean).join('\n\n');
}

module.exports = { run: run, hasDraft: hasDraft, MARKER: MARKER };
