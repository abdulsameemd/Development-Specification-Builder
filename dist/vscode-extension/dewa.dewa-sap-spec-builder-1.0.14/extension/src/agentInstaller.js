'use strict';
/* Installs the dewa-fs-discovery agent into the user's VS Code prompts folder (…/User/prompts), where Copilot Chat
   picks up custom agents. Used by the standalone "DEWA SAP Spec Builder" extension; an extension that already
   installs the DEWA agents can ship the file its own way instead.
   A copy the user has edited is never overwritten silently. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'dewa-fs-discovery.agent.md';
const HASH_KEY = 'dewaSpecBuilder.agentHash';

function hash(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/* globalStorageUri is …/User/globalStorage/<publisher.name>; the prompts folder is its sibling …/User/prompts.
   Works for Windows, macOS, Linux, Insiders and portable installs. */
function promptsDir(globalStoragePath) { return path.join(path.dirname(path.dirname(globalStoragePath)), 'prompts'); }

/* → 'installed' | 'updated' | 'current' | 'modified' (user edited it; left alone) | 'missing-source' */
async function install(vscode, context, opts) {
  opts = opts || {};
  const src = path.join(context.extensionPath, opts.agentPath || path.join('agents', FILE));
  if (!fs.existsSync(src)) return 'missing-source';
  const content = fs.readFileSync(src);
  const dir = promptsDir(context.globalStorageUri.fsPath);
  const dest = path.join(dir, FILE);
  const last = context.globalState.get(HASH_KEY);
  let status = 'installed';
  if (fs.existsSync(dest)) {
    const cur = hash(fs.readFileSync(dest));
    if (cur === hash(content)) { await context.globalState.update(HASH_KEY, cur); return 'current'; }
    const edited = !last || cur !== last; // not the copy we wrote last time
    if (edited && !opts.force) {
      if (!opts.ask) return 'modified';
      const pick = await vscode.window.showWarningMessage('Your copy of ' + FILE + ' was changed. Replace it with the version from DEWA SAP Spec Builder?', 'Replace', 'Keep mine');
      if (pick !== 'Replace') return 'modified';
    }
    status = 'updated';
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dest, content);
  await context.globalState.update(HASH_KEY, hash(content));
  return status;
}

module.exports = { install: install, promptsDir: promptsDir, FILE: FILE };
