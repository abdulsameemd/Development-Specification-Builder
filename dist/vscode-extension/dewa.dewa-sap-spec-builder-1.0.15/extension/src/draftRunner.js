'use strict';
/* AI draft of a functional specification with the GitHub Copilot language model (vscode.lm). No tools are
   offered: the model only sees the business requirement the builder sends, and the builder shows the result
   for review before anything is added to the spec. */

const { pickModel } = require('./discoveryRunner');

const MARKER = 'FS-DRAFT v1';
const JUSTIFICATION = 'Drafts the missing parts of a functional specification from its business requirement.';

function hasDraft(text) { return /\{[\s\S]*\}/.test(text || '') && /"(frs|toBe|objectives|currentLogic|asIs|programs)"/.test(text || ''); }

function cancelled(token) {
  if (token && token.isCancellationRequested) { const e = new Error('Drafting stopped.'); e.code = 'CANCELLED'; throw e; }
}

async function ask(vscode, model, messages, token) {
  const response = await model.sendRequest(messages, { justification: JUSTIFICATION }, token);
  let out = '';
  for await (const part of response.stream) { if (part instanceof vscode.LanguageModelTextPart) out += part.value; cancelled(token); }
  return out;
}

/* opts: { prompt, model, token, onProgress } → the model's answer (text with one ```json block) */
async function run(vscode, opts) {
  const progress = opts.onProgress || function () {};
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!models || !models.length) {
    const e = new Error('No GitHub Copilot language model is available. Sign in to GitHub Copilot in VS Code and allow this extension to use it.');
    e.code = 'NO_MODEL';
    throw e;
  }
  const model = pickModel(models, opts.model);
  progress({ text: 'Drafting with ' + (model.name || model.id || 'Copilot') + '…' });
  const M = vscode.LanguageModelChatMessage;
  const messages = [M.User(String(opts.prompt || ''))];
  cancelled(opts.token);
  const text = await ask(vscode, model, messages, opts.token);
  if (hasDraft(text)) return text;
  // One repair turn when the JSON is missing (small models sometimes answer in prose only).
  progress({ text: 'Asking for the JSON block…' });
  messages.push(M.Assistant([new vscode.LanguageModelTextPart(text || '(no answer)')]));
  messages.push(M.User('Return the draft now as exactly one ```json block (kind "fs-draft", version 1) with the structure from the first message.'));
  const again = await ask(vscode, model, messages, opts.token);
  return hasDraft(again) ? again : [text, again].filter(Boolean).join('\n\n');
}

module.exports = { run: run, hasDraft: hasDraft, MARKER: MARKER };
