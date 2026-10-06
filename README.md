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
| 1. What are you building? | Pick Report / ABAP Class / RFC / RAP / CDS / CAPM and paste the business requirement. Only these two are mandatory. |
| 2. What do you want to build? | Optional objective, users, expected output, business rules, acceptance criteria, assumptions. |
| 3. SAP objects | Add objects as **Existing**, **New** or **To Be Confirmed** (type, name, purpose). Suggestions are offered, never assumed. A dependency map is drawn from your list. |
| 4. Details | Only the questions relevant to your selection, plus authorization, testing and clean core. |
| 5. Review | A friendly "Ready for Copilot" check, counts, open questions, editable Definition of Done → **Generate Specification**. |

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

REPORT, ABAP CLASS, RFC / FUNCTION MODULE, RAP, CDS, CAPM. You can combine several in one requirement.

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

1. Edit `config/object-definitions.json` (a type with `label`, `hint`, `mainObject` and `fields`; a field has `id`, `label`, `kind` = `text | textarea | lines | select | radio | multicheck`, `section`, optional `advanced`, `showIf`).
2. Run `node scripts/build-config.js` to regenerate `js/config-bundle.js` (`--check` verifies it is current).
3. Reload. No UI code changes are needed; `section` decides where the value lands in the Markdown.

## Try it

Click **Try Example** for the *Employee Leave Balance Report* demo.

## Branding assets

`assets/morohub-logo.png` is the MoroHub logo (transparent background, 4x upscaled from the supplied 101×33 image). For the sharpest result on high-DPI screens, replace it with the original SVG and update the two `<img>` paths in `index.html`. The font stack is `Open Sans` → `Segoe UI` → system fonts (no external font loading, to keep the app offline-capable).

## Roadmap

Further output profiles (Claude Code, Codex, Cursor, SAP Joule, Gemini, Amazon Q), more object types (OData, Fiori Elements, SAPUI5, BAdI, enhancements, workflow, IDoc, Adobe Forms, background jobs, AMDP, integration).

Not in scope by design: login, backend, database, AI API, chat, Jira/GitHub/SAP connections, project management, analytics, collaboration.
