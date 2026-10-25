'use strict';
/* DEWA FS discovery add-on for the DEWA VS Code extension.
   The SAP Specification Builder copies a read-only discovery prompt to the clipboard and opens
     vscode://<publisher.extension>/discover?src=clipboard&v=1
   This URI handler takes the prompt from the clipboard, makes sure GitHub Copilot Chat is installed and the
   user is signed in (VS Code's own sign-in – no token ever passes through the builder), and opens Copilot Chat
   with the dewa-fs-discovery agent and the prompt pre-filled. The user reviews it and presses Enter.
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

  /* Open Copilot Chat with the custom agent selected. Older VS Code builds do not accept a custom agent as
     "mode": then open agent mode and tell Copilot which agent instructions to follow. */
  async function openChat(prompt) {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, isPartialQuery: true, mode: AGENT });
      return 'agent';
    } catch (e) {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: FALLBACK_PREFIX + prompt, isPartialQuery: true, mode: 'agent' });
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

    const how = await openChat(text);
    win.showInformationMessage(how === 'agent'
      ? 'Discovery prompt is ready in Copilot Chat – review it and press Enter. The agent only reads the SAP system.'
      : 'Discovery prompt is ready in Copilot Chat (agent mode) – select "' + AGENT + '" if it is available, then press Enter.');
    return { status: 'opened', how: how };
  }

  return { handleUri: handleUri, ensureSignedIn: ensureSignedIn, openChat: openChat };
}

module.exports = { create: create, MARKER: MARKER, AGENT: AGENT, COPILOT_CHAT: COPILOT_CHAT };
