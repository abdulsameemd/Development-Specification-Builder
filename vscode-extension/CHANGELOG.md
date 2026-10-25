# Changelog

## 1.0.0

- SAP Spec Builder as a VS Code tab (*DEWA: Open SAP Spec Builder*, status-bar item, `vscode://dewa.dewa-sap-spec-builder/builder`): functional specifications (Word + Markdown) and development specifications.
- Read-only SAP system discovery from the builder: automatic (GitHub Copilot model + read tools of the SAP MCP servers only) or in Copilot Chat with the `dewa-fs-discovery` agent, which returns the pack through the `dewa_submitContextPack` tool.
- Installs the `dewa-fs-discovery` agent into the VS Code prompts folder.
- `vscode://dewa.dewa-sap-spec-builder/discover` for the browser version of the builder.
