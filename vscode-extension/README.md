# DEWA SAP Spec Builder

Write SAP **functional specifications** and **development specifications** inside VS Code. System facts come from the connected
SAP system, read **read-only** through GitHub Copilot and DEWA's SAP MCP servers (ABAP ADT, Fiori, UI5, CAP).

## Start

1. Run **DEWA: Open SAP Spec Builder**, from the command palette or the *Spec Builder* item in the status bar. The builder opens as a tab.
2. **Sign in to GitHub Copilot.** Use the button in step 4 of a functional spec, or VS Code's Accounts menu. VS Code handles the sign-in; the builder only shows the account name.
3. **Functional**: fill in context, process and requirements. In step 4, pick one way to read the system:
   - **Discover automatically** reads the SAP system with the Copilot model and only the read tools of the SAP MCP servers. Progress is shown in the panel and the result is imported automatically.
   - **Run in Copilot Chat** opens Copilot Chat beside the panel with the `dewa-fs-discovery` agent and the prompt filled in. Press Enter; the agent sends the result back to the builder.
4. **Generate**: download **Word** or Markdown. Both are saved through a VS Code save dialog.
5. **Technical**: use **Open in Copilot Chat** to hand a development spec to `dewa-abap`. You can also hand any RICEFW item from the FS straight to the Technical mode.

The first automatic discovery asks you to allow this extension to use the Copilot language model.

## Read-only

- **Automatic discovery** may only use tools whose names match `dewaSpecBuilder.discoveryTools`. Any tool with a write verb in its name is always excluded: create, update, delete, change, activate, lock, transport, release, run and the like. Calls to tools that were not offered are refused.
- **The `dewa-fs-discovery` agent** is installed into your VS Code prompts folder. It reads metadata only and never changes anything.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `dewaSpecBuilder.discoveryTools` | `*abap*`, `*adt*`, `*fiori*`, `*ui5*`, `*cap*` | Tool-name patterns of your SAP MCP servers that automatic discovery may use |
| `dewaSpecBuilder.maxToolRounds` | `25` | Maximum tool-calling rounds per automatic discovery |
| `dewaSpecBuilder.installAgent` | `true` | Install the `dewa-fs-discovery` agent into the prompts folder on start-up |

If the log reports *No read tools of the SAP MCP servers are available*, follow these steps:
1. Check that the MCP servers are running (*MCP: List Servers*).
2. Set `dewaSpecBuilder.discoveryTools` to match their tool names.

Until then, use **Run in Copilot Chat**. Also edit the `tools:` line of `dewa-fs-discovery.agent.md` in your prompts folder to your server names.

## Commands

- **DEWA: Open SAP Spec Builder**
- **DEWA: Reinstall dewa-fs-discovery agent**

## Links from the browser version

- `vscode://dewa.dewa-sap-spec-builder/builder` opens the builder tab.
- `vscode://dewa.dewa-sap-spec-builder/discover?src=clipboard&v=1` opens Copilot Chat with the discovery prompt from the clipboard.

## Privacy

Specifications and drafts stay on your machine in VS Code's extension storage. The extension adds no backend of its own and does no telemetry. The SAP system is reached only through the MCP servers you have configured, via GitHub Copilot.
