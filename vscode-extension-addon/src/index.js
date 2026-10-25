'use strict';
/* Entry point of the add-on. Call from the DEWA extension's activate():
     require('./specBuilder/index').activate(context, require('vscode'));
   Registers: the SAP Spec Builder panel (+ restore after restart), its commands and status-bar item, the
   dewa_submitContextPack tool, and the URI handler (/builder opens the panel, /discover opens Copilot Chat). */

const fsDiscovery = require('./fsDiscovery');
const panelModule = require('./specBuilderPanel');
const submitTool = require('./submitPackTool');

/* opts: { htmlPath, agentPath, statusBar (default true), uriHandler (default true) } */
function activate(context, vscode, opts) {
  opts = opts || {};
  const builder = panelModule.createSpecBuilder(vscode, context, opts);
  const discovery = fsDiscovery.create(vscode);
  const subs = context.subscriptions;

  subs.push(vscode.commands.registerCommand('dewa.specBuilder.open', function () { builder.open(); }));
  subs.push(vscode.window.registerWebviewPanelSerializer(panelModule.VIEW_TYPE, {
    deserializeWebviewPanel: async function (panel) { builder.attach(panel); }
  }));
  if (vscode.lm && typeof vscode.lm.registerTool === 'function') subs.push(submitTool.register(vscode, builder.deliverPack));

  if (opts.statusBar !== false) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.text = '$(notebook) Spec Builder';
    item.tooltip = 'Open the SAP Spec Builder (functional & development specifications)';
    item.command = 'dewa.specBuilder.open';
    item.show();
    subs.push(item);
  }

  /* Only one URI handler per extension: if the extension already has one, set uriHandler:false and call
     handleUri(uri) from it. */
  async function handleUri(uri) {
    if (uri.path === '/builder') { builder.open(); return { status: 'opened-builder' }; }
    return discovery.handleUri(uri);
  }
  if (opts.uriHandler !== false) subs.push(vscode.window.registerUriHandler({ handleUri: handleUri }));

  return { builder: builder, handleUri: handleUri };
}

module.exports = { activate: activate };
