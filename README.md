# ABAP Copilot Prompt Builder

> Turn SAP business requirements into structured GitHub Copilot development specifications.

A small, static web app that helps an SAP developer give GitHub Copilot the right context **before** coding starts. Fill in a requirement in 5–10 minutes, download a `*_COPILOT_REQUIREMENT.md`, and hand it to Copilot (VS Code or Eclipse ADT).

- **No backend, no database, no login, no AI API.** Open `index.html` — that's it.
- **Private by design.** Requirements never leave your browser. Drafts are kept in the browser's local storage only.
- **Easy to share.** Send the `.md`, an exported project `.json`, or a share link. Or host the folder on any static host.
- Styled with the MoroHub look: charcoal chrome, lime-green accent, rounded controls.

## How to run

```text
open index.html          # double-click it; works from file://
```

Optional: serve the folder with any static host (GitHub Pages: *Settings → Pages → Deploy from branch → root*).

## How developers use it

```text
Business Requirement → Select Object → Add Existing/New Objects → Add Important Rules
        → Review → Generate .md → GitHub Copilot → Development
```

| Step | What you do |
|---|---|
| 1. Build | Pick Report / ABAP Class / RFC / RAP / CDS / CAPM / DDIC / Enhancement / OData / Fiori / IDoc / Form and paste the business requirement (the only two mandatory inputs). The main object is added automatically. |
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
| OData, API, Fiori/UI5, BAdI / Enhancement, IDoc, Form, Background Job, Workflow | Entity sets & functions, payload & errors, app type & pages, enhancement spot / exit & logic, message/basic type & segments, form interface, job schedule, workflow steps |

Grids accept **Paste from Excel** (tab-separated, same column order) and **Enter** moves to the next row (adding one at the end). Customer DDIC objects referenced in grids but not listed (e.g. a Z data element in a table field) are offered as one-click "+ add" chips.

A live Markdown preview sits next to the form (an Edit/Preview tab on small screens).

## Quick Mode and Advanced Mode

- **Quick** (default): essential questions only; optional fields hide behind *Advanced details ▼*.
- **Advanced**: opens those fields and adds architecture, detailed data model, integration, security, error handling, workflow, deployment, detailed testing, technical constraints, package, naming conventions and release.

## Generated Markdown

`<Project>_COPILOT_REQUIREMENT.md` with only the relevant sections, numbered automatically:
Requirement · Development Object · Business Objective · Existing / New Objects · Dependencies · Functional Requirements · Technical Details · Business Rules · Input · Output · Authorization · Error Handling · Performance · Testing · Acceptance Criteria (Given/When/Then) · Clean Core · Assumptions · Open Questions · Definition of Done · Copilot Development Instructions.

Rules baked in: nothing is invented, unknown values become `[TO BE CONFIRMED]`, no empty sections, and tables/lists are preferred to prose to keep tokens low.

## Sharing

| Option | What it is |
|---|---|
| **Download .md** / **Copy Markdown** | The specification for Copilot. |
| **Export / Import** (`.json`) | The whole project, to continue later or hand to a colleague. |
| **Copy share link** (🔗 in the header) | The project is encoded in the URL fragment (`#s=…`). Whoever opens it gets a copy as a new local draft. The fragment is not sent to any server, but anyone you send the link to can read the requirement, so treat it like the file itself. |

## Local storage

Everything auto-saves in this browser (`localStorage`): save, resume and delete from **Saved Drafts**. Clearing site data removes them — export what you want to keep. Nothing is uploaded.

## Supported object types

Development types: Report, ABAP Class, RFC / Function Module, RAP, CDS, CAPM, DDIC objects, Enhancement / BAdI, OData service, Fiori / UI5 app, IDoc / interface, Form. Object types (28): Table, Structure, Data Element, Domain, Table Type, Search Help, Lock Object, Message Class, Authorization Object, Report, Class, Interface, Function Module, RFC, BAdI / Enhancement, IDoc, Form, Background Job, Workflow, CDS, RAP, CAPM, OData, API, Fiori/UI5, Infotype, LDB, Other. Combine as many as needed.

## Architecture

```text
index.html
css/styles.css
config/                 ← source of truth (edit these)
  object-definitions.json   types, fields, conditional fields, SAP object types, suggestions, DoD
  validation-rules.json     mandatory + recommended checks
  templates.json            quick-start templates + demo example
js/
  config-bundle.js      generated from /config (so it works from file://)
  object-definitions.js config accessors
  state.js              tool-neutral specification model + store
  validation.js         mandatory checks
  completeness.js       "Ready for Copilot", open questions, dependency tree, suggestions
  markdown-generator.js Markdown builder + output profiles (GitHub Copilot) + preview renderer
  templates.js          templates and demo
  storage.js            localStorage drafts
  export.js             download, copy, JSON import/export, share link
  app.js                UI
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

## Try it

**Try Example** offers complete worked examples: FI-AP vendor ageing report (Report + Class + DDIC), MM goods receipt RFC for an external WMS, SD billing block rules app (Table + CDS + RAP + Fiori), IS-U meter reading CDS view, CRM interaction log on CAP.

## Branding assets

`assets/morohub-logo.png` is the MoroHub logo (transparent background, 4x upscaled from the supplied 101×33 image). For the sharpest result on high-DPI screens, replace it with the original SVG and update the two `<img>` paths in `index.html`. The font stack is `Open Sans` → `Segoe UI` → system fonts (no external font loading, to keep the app offline-capable).

## Roadmap

Further output profiles (Claude Code, Codex, Cursor, SAP Joule, Gemini, Amazon Q), more object types (OData, Fiori Elements, SAPUI5, BAdI, enhancements, workflow, IDoc, Adobe Forms, background jobs, AMDP, integration).

Not in scope by design: login, backend, database, AI API, chat, Jira/GitHub/SAP connections, project management, analytics, collaboration.
