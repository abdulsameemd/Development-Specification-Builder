'use strict';
/* DEWA SAP Spec Builder – standalone VS Code extension.
   Built by scripts/build-vsix.js from vscode-extension-addon/ (src/, agents/) and the builder's dist file (media/). */
const vscode = require('vscode');
const specBuilder = require('./src/index');
const agentInstaller = require('./src/agentInstaller');

async function installAgent(context, interactive) {
  try {
    const all = await agentInstaller.installAll(vscode, context, { ask: interactive, force: false });
    if (interactive) {
      const word = { installed: 'installed', updated: 'updated', current: 'up to date', modified: 'kept (your edited copy was not replaced)', 'missing-source': 'not found in the extension package' };
      const parts = Object.keys(all).map(function (f) { return f.replace(/\.agent\.md$/, '') + ' ' + (word[all[f]] || all[f]); });
      vscode.window.showInformationMessage('Agents: ' + parts.join(' · ') + '. They are listed in the Copilot Chat agent picker.');
    }
  } catch (e) {
    if (interactive) vscode.window.showErrorMessage('Could not install the Spec Builder agents: ' + (e && e.message || e));
  }
}

function activate(context) {
  specBuilder.activate(context, vscode);
  context.subscriptions.push(vscode.commands.registerCommand('dewa.specBuilder.installAgent', function () { return installAgent(context, true); }));
  if (vscode.workspace.getConfiguration('dewaSpecBuilder').get('installAgent', true)) installAgent(context, false);
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
