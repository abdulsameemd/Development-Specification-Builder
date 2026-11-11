# Security

This page lists what can go wrong with the DEWA SAP Spec Builder and what controls it. Roles, gates and the audit
trail are described in [GOVERNANCE.md](GOVERNANCE.md).

## What the builder is

- A static web app (one HTML file). In the browser everything stays in local storage; nothing is uploaded.
- In VS Code, the same app runs in a webview of the extension. The extension talks to GitHub Copilot (`vscode.lm`)
  and to the SAP MCP servers configured in VS Code, and writes files only through VS Code's save dialog and to
  `.dewa/audit/` in the workspace.

## Threats and controls

| Threat | Control | Limit |
|---|---|---|
| **The AI changes SAP** (creates, changes or activates objects) | The automatic tool loop only offers *read* tools: an allow-list plus a deny-list of write verbs (create, update, delete, change, edit, write, save, activate, generate, …); at most 30 tool calls per job. Copilot Chat agents (`dewa-fs-discovery`) are instructed read-only. | In Copilot Chat the user's own agent setup decides which tools exist. The SAP MCP servers should use **read-only SAP users**; that is the real boundary. |
| **Prompt injection** through uploaded documents or SAP tool results ("ignore your instructions…") | Results never act by themselves: every AI result opens a review dialog and only what the user accepts is taken over; SAP is read-only (above); the Technical spec reaches `dewa-abap` only through gate G2, and code only through gate G3. | Documents and tool results are fenced as data and screened; instruction-like text is shown to the reviewer and audited (1.0.18). The screening is pattern-based: an injected text can still produce a wrong draft, so the reviewer must read it. |
| **Untrusted / invented answers** | Unknown fields stay empty and become open questions; *Check & read in SAP* verifies every object name; the review dialog shows what is new. | Grounding (1.0.18): SAP names in AI drafts are checked against what the read-only tools returned; unverified ones are marked `[NOT VERIFIED IN SAP]`. Business statements (rules, steps) are not verified – the reviewer and the approver are. |
| **Code is built from an unapproved or changed spec** | Gate G2 with a content fingerprint: any change after approval closes the gate. The prompt for an unapproved spec starts with STOP. | See *tampering* below. |
| **Tampering with approvals** | Approvals are recorded with account, time and fingerprint, in the document and in `.dewa/audit/`. Only listed accounts see *Approve*. | **Approvals are recorded, not tamper-proof.** They live in the user's local storage and settings; a technically skilled user can edit storage or relax their own settings (see GOVERNANCE.md: VS Code cannot lock extension settings). The approved files sent by email / Teams (with the approver's reply), gate G3 (code review before transport) and the audit files are the backstop. A hard guarantee needs a central approval system. |
| **Data leaving DEWA** | Only GitHub Copilot (the organisation's licence and its data terms) receives prompts; the browser app sends nothing; share links keep data in the URL fragment. | Masking (1.0.19) replaces e-mail, phone, Emirates ID, IBAN, card numbers and IT-defined patterns before prompts and in SAP tool results; names of people and free-text personal data are not detected. In Copilot Chat mode, tool results are not masked by the builder. Follow the data classification. |
| **Cross-site scripting in the webview** | Strict Content-Security-Policy with a nonce for the one inline script; every user and AI text is escaped before it is shown; messages from the webview are validated by type and size in the extension (file names, spec ids `[A-Za-z0-9_-]`, paths kept inside the workspace). | – |
| **Path traversal when saving** | Save goes through VS Code's save dialog; audit files are written only under `<workspace>/.dewa/audit/` with a validated spec id. | – |
| **Unapproved models** | `dewaSpecBuilder.models.allowed` restricts which Copilot models may run; the model used is audited. | Copilot's own data terms apply to every allowed model. |
| **Usage data leaking** | Usage statistics are local counts without content; nothing is sent. | – |
| **Malicious extension build** | The `.vsix` is built in the repository (`scripts/build-vsix.js`) from reviewed sources; CI runs the tests; IT can allow only this extension version (`extensions.allowed`). | – |

## Reporting a problem

Report a security problem to the repository owner privately (not in a public issue). Include what you did, what
happened and which version (*Help → About* in VS Code, or the version in the extension list).
