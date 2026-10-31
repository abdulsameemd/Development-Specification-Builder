'use strict';
/* DEWA FS discovery add-on for the DEWA VS Code extension.
   The SAP Specification Builder copies a read-only discovery prompt to the clipboard and opens
     vscode://<publisher.extension>/discover?src=clipboard&v=1
   This URI handler takes the prompt from the clipboard, makes sure GitHub Copilot Chat is installed and the
   user is signed in (VS Code's own sign-in – no token ever passes through the builder), and opens Copilot Chat
   with the dewa-fs-discovery agent and the prompt. With dewaSpecBuilder.chatAutoSend (default) Chat sends it right
   away; otherwise the user reviews it and presses Enter.
   Registered by index.js, which also routes /builder to the SAP Spec Builder panel.

   The prompt travels via the clipboard, not the URL: no length limit and nothing in OS / browser history. */

const MARKER = 'DEWA-FS-DISCOVERY v1';
const AGENT = 'dewa-fs-discovery';
const COPILOT_CHAT = 'GitHub.copilot-chat';
const MAX_PROMPT = 100000;
const FALLBACK_PREFIX = 'Act as the ' + AGENT + ' agent (read-only SAP system discovery) and follow its instructions.\n\n';

function create(vscode) {
  const win = vscode.window;

  /* Copilot authenticates with the GitHub provider. Ask silently first; only prompt when the user agrees. */
  async function ensureSignedIn() {
    let session = await vscode.authentication.getSession('github', ['user:email'], { silent: true });
    if (session) return true;
    const pick = await win.showInformationMessage('Sign in to GitHub to run the SAP discovery with Copilot.', 'Sign in');
    if (pick !== 'Sign in') return false;
    session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
    return !!session;
  }

  function autoSend() {
    const ws = vscode.workspace;
    return !(ws && ws.getConfiguration && ws.getConfiguration('dewaSpecBuilder').get('chatAutoSend', true) === false);
  }

  /* Open Copilot Chat in a mode: a custom agent (default dewa-fs-discovery) or the built-in 'agent' / 'ask'.
     Older VS Code builds do not accept a custom agent as "mode": then open agent mode and tell Copilot which
     agent instructions to follow. o: { mode, autoSend } – autoSend defaults to the chatAutoSend setting. */
  async function openChat(prompt, o) {
    o = o || {};
    const mode = o.mode || AGENT;
    const partial = !(o.autoSend === undefined ? autoSend() : o.autoSend);
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, isPartialQuery: partial, mode: mode });
      return 'agent';
    } catch (e) {
      const builtIn = mode === 'agent' || mode === 'ask';
      const prefix = builtIn ? '' : mode === AGENT ? FALLBACK_PREFIX : 'Act as the ' + mode + ' agent and follow its instructions.\n\n';
      await vscode.commands.executeCommand('workbench.action.chat.open', builtIn ? { query: prompt, isPartialQuery: partial } : { query: prefix + prompt, isPartialQuery: partial, mode: 'agent' });
      return 'fallback';
    }
  }

  async function handleUri(uri) {
    if (uri.path !== '/discover') return { status: 'ignored' };
    const params = new URLSearchParams(uri.query || '');
    if (params.get('src') !== 'clipboard') return { status: 'ignored' };

    const text = String((await vscode.env.clipboard.readText()) || '');
    if (!text.startsWith(MARKER)) {
      win.showWarningMessage('No SAP discovery prompt on the clipboard. Click "Discover in SAP" in the Specification Builder again.');
      return { status: 'no-prompt' };
    }
    if (text.length > MAX_PROMPT) {
      win.showWarningMessage('The discovery prompt is unusually large and was not opened. Shorten the specification or paste the prompt manually.');
      return { status: 'too-large' };
    }

    if (!vscode.extensions.getExtension(COPILOT_CHAT)) {
      const pick = await win.showErrorMessage('GitHub Copilot Chat is not installed.', 'Install');
      if (pick === 'Install') await vscode.commands.executeCommand('workbench.extensions.installExtension', COPILOT_CHAT);
      return { status: 'no-copilot' };
    }
    if (!(await ensureSignedIn())) return { status: 'not-signed-in' };

    const sent = autoSend();
    const how = await openChat(text);
    win.showInformationMessage(how === 'agent'
      ? (sent ? 'Copilot Chat is running the SAP discovery. The agent only reads the SAP system.' : 'Discovery prompt is ready in Copilot Chat – review it and press Enter. The agent only reads the SAP system.')
      : (sent ? 'Copilot Chat is running the SAP discovery in agent mode, following the ' + AGENT + ' instructions.' : 'Discovery prompt is ready in Copilot Chat (agent mode) – select "' + AGENT + '" if it is available, then press Enter.'));
    return { status: 'opened', how: how };
  }

  return { handleUri: handleUri, ensureSignedIn: ensureSignedIn, openChat: openChat, autoSend: autoSend };
}

module.exports = { create: create, MARKER: MARKER, AGENT: AGENT, COPILOT_CHAT: COPILOT_CHAT };
