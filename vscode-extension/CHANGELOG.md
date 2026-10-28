# Changelog

## 1.0.4

- **Upload a generated .md file.** *Upload* in the header (or *Upload .md file* in the command palette) opens a downloaded `FUNCTIONAL_SPECIFICATION.md` or `BUSINESS_REQUIREMENTS.md` again, in Functional or Technical mode.
  - Downloaded files now end with one hidden comment holding the builder data, so the spec is restored exactly. The visible content, Copy Markdown, Word and the Copilot Chat prompt are unchanged.
  - If the file was edited by hand after downloading, the builder restores the generated version and says so.
  - Older files without the comment are restored partly from their sections and tables.

## 1.0.3

- **Transactions & Fiori apps from SAP.** Consultants describe process steps in business words; they no longer need the technical names.
  - **Suggest from SAP** asks discovery to find matching transactions and Fiori apps per step, standard and custom, read-only. One click on a suggestion uses it.
  - Until discovery runs, well-known SAP standard transactions are suggested, marked "standard".
  - The Transaction / app cell has type-ahead by description: typing "invoice" finds MIRO and FB60, and apps found by discovery are included.
  - The discovery prompt lists the steps that have no code yet. The context pack returns `stepMatches`.

## 1.0.2

Changes from the first run on the DEWA system:
- **Model:** automatic discovery uses the strongest available Copilot model (Opus, Sonnet or GPT-5 before Haiku, mini or flash). The new setting `dewaSpecBuilder.model` overrides it.
- **Tool filter:** read tools whose names contain "transport" or "run" (e.g. `transport_get_request`, `atc_run_get_result`) are kept. Create, edit, activate, run-action and generate tools stay excluded, and they are listed on one log line.
- **Repeated calls:** a call with the same input is not executed again, and there is a tool budget of 30 calls.
- **Repair turn:** if the answer has no context pack, the model gets one extra turn without tools. If that also fails, the panel shows the model's answer in the paste box.

## 1.0.1

- RAP: the development spec now contains a **RAP Implementation Blueprint**:
  - the artifact and activation-group plan;
  - the behavior definition skeleton (interface and projection);
  - the behavior pool skeleton (`FOR BEHAVIOR OF` plus every handler signature);
  - the admin fields and the draft table rule.
- RAP readiness checks in step 4 catch what would break activation, with one-click fixes:
  - ETag fields missing from the CDS view;
  - a missing total ETag for draft;
  - missing admin fields;
  - an unnamed draft table.
- Copilot instructions for RAP: build from the blueprint, activate group by group, create a correct behavior pool, and stop after 3 failed activation rounds.

## 1.0.0

- SAP Spec Builder as a VS Code tab (*DEWA: Open SAP Spec Builder*, status-bar item, `vscode://dewa.dewa-sap-spec-builder/builder`): functional specifications (Word + Markdown) and development specifications.
- Read-only SAP system discovery from the builder: automatic (GitHub Copilot model + read tools of the SAP MCP servers only) or in Copilot Chat with the `dewa-fs-discovery` agent, which returns the pack through the `dewa_submitContextPack` tool.
- Installs the `dewa-fs-discovery` agent into the VS Code prompts folder.
- `vscode://dewa.dewa-sap-spec-builder/discover` for the browser version of the builder.
