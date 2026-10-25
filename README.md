# SAP Development Specification Builder

> Turn SAP business requirements into functional specifications checked against the SAP system, and into structured GitHub Copilot development specifications.

A small, static web app with two modes (toggle **Functional | Technical** in the header):

- **Functional** – functional consultants write a standard SAP functional specification (FS) in 15–30 minutes, check it against the live DEWA SAP system through a read-only Copilot agent, and download it as **Word** or Markdown. See [Functional specifications](#functional-specifications).
- **Technical** – an SAP developer gives GitHub Copilot the right context **before** coding starts. Fill in a requirement in 5–10 minutes, download `BUSINESS_REQUIREMENTS.md` (or send it straight to VS Code), and hand it to Copilot (VS Code or Eclipse ADT).

- **No backend, no database, no login, no AI API.** Open `index.html` — that's it.
- **Private by design.** Requirements never leave your browser. Drafts are kept in the browser's local storage only.
- **Easy to share.** Send the `.md` or a share link. Or host the folder on any static host.
- "AI studio" look in the MoroHub colours (lime on charcoal): light by default with a dark theme (☾ in the header), glass panels, animated aurora, a readiness ring, a streaming reveal + confetti when the spec is generated (all motion is switched off when the OS asks for reduced motion).
- Keyboard first: **Ctrl/⌘ K** command palette (steps, examples, add objects, download, share, theme…), **Alt + ← / →** between steps, **Enter** for the next grid row.

## How to run

```text
open index.html          # double-click it; works from file://
```

Optional: serve the folder with any static host (GitHub Pages: *Settings → Pages → Deploy from branch → root*).

## Functional specifications

```text
Context → AS-IS / TO-BE process → Functional requirements (fit-gap) → System discovery + RICEFW → NFRs, UAT, sign-off
        → Word / Markdown → RICEFW item → Development spec (Technical mode) → dewa-abap
```

| Step | What you do |
|---|---|
| 1. Context | Title, **module** and **business requirement** (the two mandatory inputs), objectives, KPIs, scope, stakeholders, org units. *Start from a module template* (FI-AP, MM, SD, IS-U, CRM) pre-fills typical process steps, FR headings and roles. |
| 2. Process | AS-IS and TO-BE step grids (step, role, transaction / Fiori app, pain point / change). The TO-BE flow is drawn as you type; "Start TO-BE from AS-IS" copies the steps. |
| 3. Requirements | FR-01 … with MoSCoW priority, **fit-gap** (SAP standard / configuration / custom), acceptance criteria; business rules and validations; data requirements (business field → SAP table / field). |
| 4. Solution | **Current SAP system** (discovery, below), RICEFW items (R-01, E-01, UI-01 … per type) covering the gaps, roles & authorizations, interfaces, outputs, SPRO notes. Each RICEFW item can be handed over as a pre-filled **Development Specification**. |
| 5. Sign-off | NFRs, UAT scenarios (*Create UAT skeleton from FRs*: one positive + one negative case per FR), risks / assumptions / open points, document control, version history, approvers. "Ready for sign-off" check → **Generate**. |

**Output** – `FS_<Module>_<Title>.docx` (title page with document control, contents, numbered headings, tables, header with document ID and version, *Page X of Y* footer) and `FUNCTIONAL_SPECIFICATION.md`, both from the same content: Business Requirement · Scope · Stakeholders · AS-IS · TO-BE · Functional Requirements · Business Rules · Data Requirements · Current SAP System Context · Fit-Gap · Solution Design (RICEFW) · Roles & Authorizations · Interfaces · Outputs · NFRs · UAT · **Traceability matrix (FR ↔ RICEFW ↔ UAT)** · Risks · Open Questions · Version History & Approvals. Unknown values read `[TO BE CONFIRMED]`; empty sections are left out.

### System discovery (read-only, through Copilot)

The browser never connects to SAP. DEWA's VS Code already has GitHub Copilot with the **SAP ABAP ADT, Fiori, UI5 and CAP MCP servers**; the read-only agent [`dewa-fs-discovery`](vscode-extension-addon/agents/dewa-fs-discovery.agent.md) uses them to read what exists and returns a JSON **context pack** (`dewa-sap-context-pack`, v1: system/release, objects, transactions, Fiori/UI5 apps, CAP services, BAdIs, customizing hints, not-found list).

1. Step 4 → **Discover in SAP**: the builder copies a prompt built from the FS (module, scope, FRs, every transaction/table/object named, proposed new names) and opens VS Code.
2. With the DEWA extension add-on, Copilot Chat opens with `dewa-fs-discovery` and the prompt filled in. Sign in to Copilot if VS Code asks (VS Code's own sign-in), review, press **Enter**.
3. Copy the agent's answer → **Import from clipboard** (or paste it). The pack is validated and treated as untrusted data.

The FS then shows a *Current SAP System Context* section, a **reference check** (✓ in system · ✗ not found · ⚠ proposed name already exists · – not checked), discovered names as suggestions in the grids, and a warning when the pack is older than 30 days. *Try a sample pack* shows the flow without a system ([`docs/samples/fs-context-pack-sample.json`](docs/samples/fs-context-pack-sample.json), clearly marked as sample).

### Inside VS Code (one window)

**Install:** [`dist/dewa-sap-spec-builder-1.0.0.vsix`](dist/dewa-sap-spec-builder-1.0.0.vsix) → VS Code → Extensions → `…` → *Install from VSIX…* (or `code --install-extension dewa-sap-spec-builder-1.0.0.vsix`). It installs next to DEWA's existing extension and adds the `dewa-fs-discovery` agent to your prompts folder. Rebuild it with `node scripts/build-vsix.js` (source: `vscode-extension/` + `vscode-extension-addon/`).

**DEWA: Open SAP Spec Builder** (command palette or *Spec Builder* in the status bar) opens this same app as a tab inside VS Code:

- sign in to **GitHub Copilot** in VS Code (button in step 4 or the Accounts menu);
- **Discover automatically** reads the system read-only with the Copilot model and only the *read* tools of the SAP MCP servers (write tools are filtered out), with live progress and automatic import — or **Run in Copilot Chat** beside the panel, where the agent sends the pack back with the `dewa_submitContextPack` tool;
- Word / Markdown are saved through VS Code's save dialog; in Technical mode **Open in Copilot Chat** hands the spec to `dewa-abap`.

**VS Code extension add-on** – [`vscode-extension-addon/`](vscode-extension-addon/INSTALL.md): the panel, the automatic discovery runner, the submit tool, the `/builder` and `/discover` URI handlers, the agent file, install steps and unit tests (`node --test vscode-extension-addon/test/*.test.js`). In the browser without the add-on, choose *Plain VS Code (copy & paste)* in step 4 → *VS Code launch settings*.

## How developers use it (Technical mode)

```text
Business Requirement → Select Object → Add Existing/New Objects → Add Important Rules
        → Review → Generate .md → GitHub Copilot → Development
```

| Step | What you do |
|---|---|
| 1. Build | Pick Report / ABAP Class / RFC / RAP / CDS / CAPM / DDIC / Enhancement / OData / Fiori / Form and paste the business requirement (the only two mandatory inputs). The main object is added automatically. |
| 2. Requirement | Optional objective, users, expected output, business rules, acceptance criteria, assumptions. |
| 3. Objects | One compact line per object: type, name, status (**Existing – reuse**, **Existing – change**, **New**, **To Be Confirmed**), purpose. Suggestions are offered, never assumed. A dependency map is drawn from the list. |
| 4. Specify | A designer per new / changed object (see below). For reused objects: "what do you need from it?". Plus authorization (authority-check grid), testing, clean core. |
| 5. Review | "Ready for Copilot" check, counts, open questions, editable Definition of Done → **Generate Specification**. |

### Object designers (step 4)

| Object | What you specify |
|---|---|
| Table (SE11) | Delivery class, client dependency, maintenance, **fields grid** (field, key, data element, type, length, decimals, domain, description, currency/quantity reference, check table), includes, TMG; advanced: data class, size category, buffering, enhancement category, indexes, logging |
| Structure / Data Element / Domain / Table Type | Components, field labels (10/20/40/55), built-in type & length, fixed values, value table, conversion routine, line type, access mode, keys |
| Search Help, Lock Object, Message Class, Authorization Object | Parameters, lock mode & parameters, messages (No./type/text), authorization fields & values |
| Report (SE38) | Selection screen grid (SELECT-OPTIONS / PARAMETERS, FOR/TYPE, selection text, obligatory, default), processing logic, output type, ALV column grid, background job, file layout |
| Class / Interface (SE24) | Superclass, interfaces, FINAL/ABSTRACT/CREATE…; **any number of methods** (add 1 or "how many?"), each with visibility, static/instance, kind, signature grid (IMPORTING/EXPORTING/CHANGING/RETURNING, typing, type, optional, default, VALUE( )), exceptions, logic, unit tests; attributes / constants |
| Function Module / RFC (SE37) | Function group, processing type, **Import / Export / Changing / Tables parameters**, exceptions (classic / class-based), BAPIRET2 RETURN, COMMIT handling, logic, error handling; RFC: destination, sRFC/aRFC/tRFC/qRFC/bgRFC, S_RFC |
| CDS (ADT) | Entity type, VDM layer, data source, parameters, joins, associations/compositions with cardinality, element list (key, alias, annotations), WHERE, access control (DCL) |
| RAP | Implementation type, strict / draft, behavior pool, **entities** (root/child, tables, draft table, operations, lock/authorization/etag master, field control, determinations, validations, actions), projection, service definition & binding, UI annotations |
| CAPM | Runtime, database, **entities with elements**, services with exposed entities / actions / events, custom handlers, external services, auth (XSUAA/IAS), roles, UI, deployment (MTA / Kyma) |
| OData, API, Fiori/UI5, BAdI / Enhancement, Form, Background Job, Workflow | Entity sets & functions, payload & errors, app type & pages, enhancement spot / exit & logic, form interface, job schedule, workflow steps |

Grids accept **Paste from Excel** (tab-separated, same column order) and **Enter** moves to the next row (adding one at the end). Customer DDIC objects referenced in grids but not listed (e.g. a Z data element in a table field) are offered as one-click "+ add" chips.

A live Markdown preview sits next to the form (an Edit/Preview tab on small screens).

## Essential vs. advanced fields

Each object shows its essential questions first; optional ones (e.g. table technical settings, class attributes, RAP mapping and side effects, CAP multitenancy) sit behind *Advanced details ▸* on that object. Performance questions appear only for development types where they matter (Report, RFC, RAP, CDS, CAPM, OData).

## Generated Markdown

`BUSINESS_REQUIREMENTS.md` with only the relevant sections, numbered automatically:
Requirement · Development Object · Business Objective · Existing / New Objects · Dependencies · Functional Requirements · Technical Details · Business Rules · Input · Output · Authorization · Error Handling · Performance · Testing · Acceptance Criteria (Given/When/Then) · Clean Core · Assumptions · Open Questions · Definition of Done · Copilot Development Instructions.

Rules baked in: nothing is invented, unknown values become `[TO BE CONFIRMED]`, no empty sections, and tables/lists are preferred to prose to keep tokens low.

## Sharing

| Option | What it is |
|---|---|
| **Open in VS Code** | One click copies a ready prompt (one-line instruction + the full specification) to the clipboard and launches VS Code. In VS Code press **Ctrl+Alt+I** (Copilot Chat), **Ctrl+V**, **Enter**. The browser asks once for permission to open VS Code; it cannot type into VS Code itself. |
| **Download file** / **Copy Markdown** | `BUSINESS_REQUIREMENTS.md` – the specification for Copilot. |
| **Copy share link** (🔗 in the header) | The project is encoded in the URL fragment (`#s=…`). Whoever opens it gets a copy as a new local draft. The fragment is not sent to any server, but anyone you send the link to can read the requirement, so treat it like the file itself. |

## Local storage

Everything auto-saves in this browser (`localStorage`): save, resume and delete from **Saved Drafts**. Clearing site data removes them — download what you want to keep. Nothing is uploaded.

## Supported object types

Development types: Report, ABAP Class, RFC / Function Module, RAP, CDS, CAPM, DDIC objects, Enhancement / BAdI, OData service, Fiori / UI5 app, Form. Object types (27): Table, Structure, Data Element, Domain, Table Type, Search Help, Lock Object, Message Class, Authorization Object, Report, Class, Interface, Function Module, RFC, BAdI / Enhancement, Form, Background Job, Workflow, CDS, RAP, CAPM, OData, API, Fiori/UI5, Infotype, LDB, Other. Combine as many as needed.

## Architecture

```text
index.html
css/styles.css
config/                 ← source of truth (edit these)
  object-definitions.json   types, fields, conditional fields, SAP object types, suggestions, DoD
  validation-rules.json     mandatory + recommended checks
  templates.json            quick-start templates + demo example
  fs-definitions.json       functional spec: steps, sections/fields, readiness rules, RICEFW types, discovery settings
  fs-templates.json         FS module templates, worked examples, sample context pack
js/
  config-bundle.js      generated from /config (so it works from file://)
  object-definitions.js config accessors
  state.js              tool-neutral specification model + store
  validation.js         mandatory checks
  completeness.js       "Ready for Copilot", open questions, dependency tree, suggestions
  markdown-generator.js Markdown builder + output profiles (GitHub Copilot) + preview renderer
  templates.js          templates and demo
  storage.js            localStorage drafts
  export.js             download, copy, share link, VS Code hand-off
  agents-guide.js       Agents info page (from docs/AGENT_WORKFLOWS.md)
  fs-state.js           functional spec model, templates, FR / RICEFW numbering
  discovery.js          discovery prompt, context-pack validation, reference cross-check
  fs-completeness.js    "Ready for sign-off", open questions
  fs-generator.js       functional spec Markdown
  docx.js               dependency-free Word writer (OOXML + ZIP)
  host.js               browser vs. VS Code panel (storage, save dialog, clipboard, messages)
  fs-app.js             functional spec wizard, discovery panel, hand-off to a development spec
  app.js                UI shell (both modes)
vscode-extension-addon/ SAP Spec Builder panel, read-only discovery runner, submit tool, URI handlers, dewa-fs-discovery agent
scripts/build-config.js
assets/morohub-logo.png
```

The model in `state.js` does not depend on Copilot; Copilot is just an **output profile** in `markdown-generator.js`. Claude Code, Codex, Cursor and others can be added as further profiles.

## Adding or changing object types

1. Edit `config/object-definitions.json`:
   - `devTypes` – the step-1 cards (`label`, `hint`, `mainObject`, `performance`).
   - `objectTypes` – one entry per object with `group`, `tcode`, `usedHint` and `fields`. A field has `id`, `label`, `kind` (`text | textarea | lines | select | radio | multicheck | check | grid | records`), optional `advanced`, `showIf`, `ask` (open question when empty), `placeholder`. A `grid` has `columns` (`id`, `label`, `kind`, `w`, `ref` for "unlisted object" detection, `list` for type suggestions); `records` has `itemLabel`, `titleField` and nested `fields`.
2. Run `node scripts/build-config.js` to regenerate `js/config-bundle.js` (`--check` verifies it is current).
3. Reload. No UI code changes are needed; `section` decides where the value lands in the Markdown.

## Walkthrough video

[`docs/media/SAP-Spec-Builder-Walkthrough.mp4`](docs/media/SAP-Spec-Builder-Walkthrough.mp4) (2:56, 1080p, voice-over): a single ABAP artifact from the builder to VS Code with the SAP ABAP ADT MCP server and the `dewa-abap` agent — specify the class, generate, Open in VS Code, confirm target, class + ABAP Unit test, evidence, `CONFIRM ARTEFACT`. The builder scenes are real; the VS Code / Copilot scenes are illustrations (marked in the video) and their evidence values are examples.

## Agent workflows page

The **Agents** button (header, or Ctrl K → "Agent workflows") opens an info page on the DEWA VS Code agents — `dewa-abap`, `dewa-codereview` and the read-only `dewa-fs-discovery`: when to use which, their flows, confirmation keywords and boundaries, and how the VS Code extension installs them. Source: `docs/AGENT_WORKFLOWS.md` (content in `js/agents-guide.js`).

## Try it

**Examples** in Functional mode: FI-AP vendor ageing, MM goods receipt from WMS, SD billing block rules, IS-U implausible meter readings, CRM interaction log — each a complete FS. In Technical mode, **Try Example** offers complete worked examples: FI-AP vendor ageing report (Report + Class + DDIC), MM goods receipt RFC for an external WMS, SD billing block rules app (Table + CDS + RAP + Fiori), IS-U meter reading CDS view, CRM interaction log on CAP.

## Branding assets

`assets/morohub-logo.png` is the MoroHub logo (transparent background, 4x upscaled from the supplied 101×33 image). For the sharpest result on high-DPI screens, replace it with the original SVG and update the two `<img>` paths in `index.html`. The font stack is `Open Sans` → `Segoe UI` → system fonts (no external font loading, to keep the app offline-capable).

## Roadmap

Further output profiles (Claude Code, Codex, Cursor, SAP Joule, Gemini, Amazon Q), more object types (OData, Fiori Elements, SAPUI5, BAdI, enhancements, workflow, IDoc, Adobe Forms, background jobs, AMDP, integration).

Not in scope by design: login, backend, database, AI API, chat, Jira/GitHub connections, a direct browser-to-SAP connection (system facts come only through the read-only Copilot agent), project management, analytics, collaboration.
