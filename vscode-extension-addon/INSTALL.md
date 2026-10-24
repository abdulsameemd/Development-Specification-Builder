# DEWA VS Code extension – FS discovery add-on

This add-on lets the **SAP Specification Builder** (Functional mode, step 4 → **Discover in SAP**) open VS Code
straight into GitHub Copilot Chat with the read-only `dewa-fs-discovery` agent and the discovery prompt filled in.
The consultant signs in to Copilot if VS Code asks, presses **Enter**, copies the agent's answer and clicks
**Import from clipboard** in the builder.

```text
Builder ──copy prompt + open vscode://<publisher>.<name>/discover?src=clipboard&v=1──▶ DEWA extension (URI handler)
   ▲                                                                                     │ reads clipboard, checks marker,
   │                                                                                     │ Copilot installed + GitHub sign-in
   │                                                                                     ▼
   └──── Import from clipboard ◀── JSON context pack ◀── dewa-fs-discovery ◀── Copilot Chat (prompt pre-filled)
                                                         (ABAP ADT / Fiori / UI5 / CAP MCP servers, read-only)
```

## What is in this folder

| File | Purpose |
|---|---|
| `src/fsDiscovery.js` | URI handler: `/discover` → clipboard → checks → `workbench.action.chat.open` |
| `agents/dewa-fs-discovery.agent.md` | The read-only discovery agent (custom Copilot agent) |
| `package.contributes.json` | What to merge into the extension's `package.json` |
| `test/fsDiscovery.test.js` | Unit tests with a mocked `vscode` API |

## Install into the DEWA extension

1. **Copy files** into the extension source:
   - `src/fsDiscovery.js` → e.g. `src/fsDiscovery.js`
   - `agents/dewa-fs-discovery.agent.md` → next to the agent files the extension already ships
     (`dewa-abap`, `dewa-codereview`), so it is installed the same way.
2. **Edit the agent's `tools:` line** to the MCP server names in your `mcp.json` (keep read operations only where the
   server lets you choose individual tools).
3. **Activate on URIs** – merge `package.contributes.json` into `package.json`:
   ```json
   "activationEvents": ["onUri"]
   ```
4. **Register the handler** in `activate()`:
   ```js
   const fsDiscovery = require('./fsDiscovery');
   exports.activate = function (context) {
     // … existing activation …
     fsDiscovery.activate(context, require('vscode'));
   };
   ```
   An extension can register **only one** URI handler. If yours already has one, route the path instead:
   ```js
   const discovery = require('./fsDiscovery').create(vscode);
   vscode.window.registerUriHandler({
     handleUri(uri) {
       if (uri.path === '/discover') return discovery.handleUri(uri);
       // … existing routes …
     }
   });
   ```
5. **Package and distribute** as usual (`vsce package`) and install the new VSIX.
6. **Set the extension ID in the builder** – Functional → step 4 → *VS Code launch settings* → *DEWA extension ID*
   = `<publisher>.<name>` from the extension's `package.json` (default `dewa.dewa-sap-agents`). To make it the default
   for everyone, change `discovery.extensionId` in `config/fs-definitions.json` and run `node scripts/build-config.js`.

## Verify on a DEWA machine

1. In the builder load **Examples → FI-AP: Vendor open items ageing**, go to step 4 and click **Discover in SAP**.
2. The browser asks once to open VS Code – allow it.
3. Expected: Copilot Chat opens with `dewa-fs-discovery` selected and the prompt (starting with `DEWA-FS-DISCOVERY v1`)
   in the input box, not yet sent. If you are not signed in, VS Code's own GitHub sign-in appears first.
4. Press Enter, wait for the summary and the `json` block, copy the answer, click **Import from clipboard**.

Things to confirm on DEWA's VS Code / Copilot version:

- `workbench.action.chat.open` accepts `mode: 'dewa-fs-discovery'` (custom agent). If it does not, the handler falls
  back to agent mode and prefixes the prompt with an instruction to act as `dewa-fs-discovery`; the user can also pick
  the agent in the chat's agent picker.
- `isPartialQuery: true` leaves the prompt unsent so the user reviews it first.

If the extension is not installed, choose **Plain VS Code (copy & paste)** in the builder's launch settings: the prompt
is still copied, VS Code opens, and the user pastes it into Copilot Chat with `dewa-fs-discovery` selected.

## Security notes

- The builder never sees GitHub or SAP credentials; sign-in is VS Code's GitHub authentication.
- The prompt goes through the clipboard (no URL length limits, nothing in browser/OS history). The handler ignores
  anything that does not start with the builder's marker and refuses prompts over 100 KB.
- The agent is read-only by instruction and should also be restricted to read tools via `tools:`.
- The builder treats the returned pack as untrusted data: it validates the structure, limits sizes and escapes all text.

## Tests

```bash
node --test vscode-extension-addon/test/*.test.js
```
