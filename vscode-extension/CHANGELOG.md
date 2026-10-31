# Changelog

## 1.0.7

- **Simpler functional specs.** Three steps instead of five: *Requirement*, *Process & requirements* and *Solution & sign-off*. Rarely used fields sit under **More details**.
  - The document has at most eight sections. Fit-gap and traceability are one table, and stakeholders, rules and data are subsections.
  - The separate *Transactions & Fiori apps* card is gone. Process steps keep the type-ahead by description, which now also offers what discovery found.
- **Generate the whole spec with Copilot.** Step 1's AI card writes the complete spec, now including data, roles, interfaces, outputs, NFRs and fit-gap (SAP). After the review, the document opens directly.
- **Read an existing program** (SAP).
  - Copilot reads named programs, transactions, classes or function modules and the objects they use, read-only through the SAP MCP servers.
  - In the background it runs with the same read-only tool filter as discovery; in Copilot Chat it uses `dewa-fs-discovery`.
  - The current logic, the objects read, the AS-IS steps, rules, data and current behaviour as FRs come back for review.
  - **→ Technical spec: change …** creates a Development Specification that changes the program.

## 1.0.6

- **Copilot Chat sends the prompt itself.** Builder buttons that open Copilot Chat no longer wait for you to press Enter: the development spec to `dewa-abap`, discovery in Chat, and the new chat buttons below. Turn it off with `dewaSpecBuilder.chatAutoSend`.
- **Draft in Copilot Chat** (Functional, step 1): the AI draft runs visibly in Chat, so you can steer it. Chat sends the result back with the new `dewa_submitFsDraft` tool, and the builder opens its review dialog.
- **Open in Copilot Chat** for functional specs, in the preview and on the finished document. Copilot reviews the FS for gaps, contradictions, untestable requirements and open questions, then answers your questions about it.

## 1.0.5

- **Functional specs for any system.** Step 1 asks *Where will this run?*: SAP, Other system or Not decided yet.
  - For anything but SAP, the module is not needed and SAP-only fields are hidden: org units, transactions, Suggest from SAP, RICEFW, discovery, SPRO and authorization objects. The wording is generic, and the document shows *System* instead of *Module*.
  - SAP specs are unchanged. Earlier drafts open as SAP specs.
  - New example: a non-SAP customer complaint tracking portal.
- **Quick start.** *Create document now* in step 1 creates the document from the requirement alone; what is missing is listed as open questions.
- **Draft the rest with AI.** From the requirement, Copilot drafts objectives, scope, process steps, FRs with acceptance criteria, rules, test scenarios and risks.
  - In VS Code it uses *Draft with Copilot*: one request, no tools.
  - In the browser, copy the prompt into an approved AI chat and paste the answer back.
  - A review dialog shows each part. Only empty fields are filled and new rows appended.

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
