'use strict';
/* Installs the Spec Builder's Copilot agents – dewa-fs-discovery (read-only SAP discovery) and dewa-abap-change
   (changes existing ABAP from a Technical spec) – into the user's VS Code prompts folder (…/User/prompts), where
   Copilot Chat picks up custom agents. Used by the standalone "DEWA SAP Spec Builder" extension; an extension that already
   installs the DEWA agents can ship the file its own way instead.
   A copy the user has edited is never overwritten silently. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'dewa-fs-discovery.agent.md';
const FILES = [FILE, 'dewa-abap-change.agent.md'];
// the first agent keeps its original key, so existing installations are recognised
function hashKey(file) { return file === FILE ? 'dewaSpecBuilder.agentHash' : 'dewaSpecBuilder.agentHash:' + file; }

function hash(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/* globalStorageUri is …/User/globalStorage/<publisher.name>; the prompts folder is its sibling …/User/prompts.
   Works for Windows, macOS, Linux, Insiders and portable installs. */
function promptsDir(globalStoragePath) { return path.join(path.dirname(path.dirname(globalStoragePath)), 'prompts'); }

/* → 'installed' | 'updated' | 'current' | 'modified' (user edited it; left alone) | 'missing-source' */
async function install(vscode, context, opts) {
  opts = opts || {};
  const file = opts.file || FILE;
  const HASH_KEY = hashKey(file);
  const src = path.join(context.extensionPath, opts.agentPath || path.join('agents', file));
  if (!fs.existsSync(src)) return 'missing-source';
  const content = fs.readFileSync(src);
  const dir = promptsDir(context.globalStorageUri.fsPath);
  const dest = path.join(dir, file);
  const last = context.globalState.get(HASH_KEY);
  let status = 'installed';
  if (fs.existsSync(dest)) {
    const cur = hash(fs.readFileSync(dest));
    if (cur === hash(content)) { await context.globalState.update(HASH_KEY, cur); return 'current'; }
    const edited = !last || cur !== last; // not the copy we wrote last time
    if (edited && !opts.force) {
      if (!opts.ask) return 'modified';
      const pick = await vscode.window.showWarningMessage('Your copy of ' + file + ' was changed. Replace it with the version from DEWA SAP Spec Builder?', 'Replace', 'Keep mine');
      if (pick !== 'Replace') return 'modified';
    }
    status = 'updated';
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dest, content);
  await context.globalState.update(HASH_KEY, hash(content));
  return status;
}

/* All agents → { 'dewa-fs-discovery.agent.md': status, 'dewa-abap-change.agent.md': status } */
async function installAll(vscode, context, opts) {
  const out = {};
  for (const file of FILES) out[file] = await install(vscode, context, Object.assign({}, opts || {}, { file: file, agentPath: undefined }));
  return out;
}

module.exports = { install: install, installAll: installAll, promptsDir: promptsDir, FILE: FILE, FILES: FILES };
