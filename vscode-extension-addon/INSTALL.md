# DEWA VS Code extension – SAP Spec Builder add-on

Adds the **SAP Spec Builder** to DEWA's VS Code extension, so consultants and developers work in one window:

- **DEWA: Open SAP Spec Builder** (command palette, status-bar item *Spec Builder*, or `vscode://<publisher>.<name>/builder`)
  opens the builder as an editor tab — the same app as the standalone HTML file, Functional and Technical mode.
- The user signs in to **GitHub Copilot** in VS Code (button in the builder or the Accounts menu). VS Code handles the
  sign-in; the builder only sees the account name.
- **Discover automatically** (Functional, step 4) reads the SAP system **read-only** with the Copilot model and the
  read tools of the ABAP ADT / Fiori / UI5 / CAP MCP servers, shows progress in the panel and imports the result.
- **Run in Copilot Chat** opens Copilot Chat beside the panel with `dewa-fs-discovery` and the prompt filled in; the
  agent hands the result back through the `dewa_submitContextPack` tool.
- **Draft with Copilot** (Functional, step 1) drafts the missing parts of an FS from the business requirement with the
  Copilot model – one request, no tools – and the builder shows it for review (`src/draftRunner.js`). **Draft in
  Copilot Chat** runs it in Chat (agent mode); Chat hands the draft back with the `dewa_submitFsDraft` tool.
- **Open in Copilot Chat** on a functional spec opens Chat in *ask* mode with a review prompt and the FS.
- Chat buttons send the prompt automatically (setting `dewaSpecBuilder.chatAutoSend`, default `true`).
- Word / Markdown files are saved through a VS Code save dialog (default: the workspace folder). In Technical mode,
  **Open in Copilot Chat** hands the development spec to `dewa-abap`.

The standalone browser version keeps working as before (copy & paste or `vscode://…/discover`).

## Quick path: the standalone VSIX

`dist/dewa-sap-spec-builder-1.0.6.vsix` (built by `node scripts/build-vsix.js` from `vscode-extension/` and this folder)
is a ready-to-install extension, `dewa.dewa-sap-spec-builder`, that runs next to DEWA's existing extension. It also
installs `dewa-fs-discovery.agent.md` into the VS Code prompts folder (setting `dewaSpecBuilder.installAgent`; an edited
copy is never replaced; *DEWA: Reinstall dewa-fs-discovery agent*). Install it with *Extensions → … → Install from VSIX…*.

The rest of this guide is for merging the add-on into DEWA's own extension instead (optional).

```text
VS Code ┌──────────────────────── SAP Spec Builder (webview) ────────────────────────┐
        │ FS wizard · Copilot status · Discover automatically · progress · Word       │
        └───────────────┬──────────────────────────────────────────▲─────────────────┘
          postMessage   │                                          │ pack
        ┌───────────────▼──────────────── extension (this add-on) ─┴─────────────────┐
        │ storage · save dialog · clipboard · GitHub sign-in                           │
        │ discoveryRunner: vscode.lm (Copilot) + read-only MCP tools (allow + deny)    │
        │ or Copilot Chat + dewa-fs-discovery → dewa_submitContextPack                 │
        └──────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|---|---|
| `src/index.js` | Entry point: panel, command, serializer, status-bar item, submit tool, URI handler (`/builder`, `/discover`) |
| `src/specBuilderPanel.js` | Webview panel: loads the builder with a strict CSP + nonce, validated message routing |
| `src/draftRunner.js` | AI draft of an FS: one Copilot request without tools, one repair turn |
| `src/discoveryRunner.js` | Automatic discovery: Copilot model + read-only MCP tools, round limit, cancellation |
| `src/submitPackTool.js` | `dewa_submitContextPack` and `dewa_submitFsDraft` language-model tools (Copilot Chat → panel) |
| `src/fsDiscovery.js` | `/discover` URI handler for the browser version, `openChat()` |
| `agents/dewa-fs-discovery.agent.md` | Read-only discovery agent |
| `package.contributes.json` | What to merge into the extension's `package.json` |
| `test/*.test.js` | Unit tests with a mocked `vscode` API |

## Install into the DEWA extension

1. **Build the builder** in this repository and copy it into the extension:
   ```bash
   node scripts/build-single.js
   cp dist/SAP-Development-Specification-Builder.html <extension>/media/spec-builder.html
   ```
2. **Copy the add-on**: `src/*.js` → `<extension>/src/specBuilder/`, `agents/dewa-fs-discovery.agent.md` → next to the
   agent files the extension already ships (`dewa-abap`, `dewa-codereview`) **and** to `<extension>/agents/` (the panel
   reads the instructions from there for automatic discovery; change `agentPath` below if you keep it elsewhere).
3. **Merge `package.contributes.json`** into `package.json`: `activationEvents`, `contributes.commands`,
   `contributes.configuration`, `contributes.languageModelTools`. Make sure `media/` and `agents/` are packaged
   (not excluded in `.vscodeignore`).
4. **Activate** in the extension's `activate()`:
   ```js
   exports.activate = function (context) {
     // … existing activation …
     require('./specBuilder/index').activate(context, require('vscode'), {
       htmlPath: 'media/spec-builder.html',            // defaults shown
       agentPath: 'agents/dewa-fs-discovery.agent.md'
     });
   };
   ```
   An extension can register only **one** URI handler. If yours already has one, pass `uriHandler: false` and call the
   returned `handleUri(uri)` from your handler for `/builder` and `/discover`.
5. **Tool names**: set the agent's `tools:` line and the setting `dewaSpecBuilder.discoveryTools` to the tool names of
   your MCP servers (see *MCP: List Servers* / the tools picker in Copilot Chat). Default patterns: `*abap*`, `*adt*`,
   `*fiori*`, `*ui5*`, `*cap*`. Tools with a write verb in their name (create, update, delete, change, activate, lock,
   transport, release, run, …) are **always** excluded from automatic discovery.
6. **Package** (`vsce package`) and install the VSIX. To make the browser version's one-click launch work too, set the
   extension ID in `config/fs-definitions.json` → `discovery.extensionId` (or in the builder's launch settings).

## Verify on a DEWA machine

1. **DEWA: Open SAP Spec Builder** → the builder opens in a tab; the status bar shows *Spec Builder*.
2. Functional → Examples → *FI-AP: Vendor open items ageing* → step 4. The card shows *GitHub Copilot · not signed in*
   → **Sign in to GitHub Copilot** → VS Code's GitHub sign-in → *signed in as …*.
3. **Discover automatically**. First time only, VS Code asks to allow the extension to use the Copilot language model —
   allow it. The log lists the model, the number of read tools, each tool call, and any excluded write tools; the pack
   is imported and the reference check shows ✓ / ✗.
4. **Run in Copilot Chat** → Chat opens beside the panel with `dewa-fs-discovery` and the prompt; press Enter. At the end
   the agent calls *Send context pack to SAP Spec Builder* (confirm if VS Code asks) and the panel updates.
5. Download Word → save dialog in the workspace folder → *Open*.
6. Technical → load an example → **Open in Copilot Chat** → `dewa-abap` with the specification prompt.

Things to confirm on DEWA's VS Code / Copilot version:

- `vscode.lm.tools` lists the MCP server tools (needed for automatic discovery). If the log says *No read tools of the
  SAP MCP servers are available*, adjust `dewaSpecBuilder.discoveryTools`, or use **Run in Copilot Chat**.
- Whether `vscode.lm.invokeTool` asks for confirmation of MCP tools outside the chat.
- `workbench.action.chat.open` accepts the custom agent as `mode` (otherwise the fallback opens agent mode with an
  instruction to act as the agent).
- The `dewa_submitContextPack` tool is offered to the agent (listed in `tools:`).

## Security

- **No credentials in the panel.** GitHub sign-in is VS Code's; the webview receives only the account label.
- **Read-only, twice over.** Automatic discovery is limited by the instructions *and* by tool filtering (allow-list
  plus write-verb deny-list; calls to tools that were not offered are refused). In Copilot Chat the agent's `tools:`
  list applies.
- **Webview:** `default-src 'none'`, scripts only with a per-load nonce, no remote resources. Every message from the
  panel is checked by type and shape; anything else is ignored. Saved file names are sanitised (`.md`, `.docx`,
  `.json` only).
- **Pack:** validated again in the builder, size-limited and escaped (untrusted data).

## Tests

```bash
node --test vscode-extension-addon/test/*.test.js
```
