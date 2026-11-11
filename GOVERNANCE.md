# Governance

The DEWA SAP Spec Builder treats **security, authorization, grounding, guardrails, human approval, audit, telemetry,
testing and governance as mandatory parts of the design**, not as optional add-ons. This page describes the controls
that are in place, who owns them, and what is still planned. The threat model is in [SECURITY.md](SECURITY.md).

| Component | Status | Where |
|---|---|---|
| Human approval (gates G1, G2, G3) | in place (1.0.16; by file 1.0.17) | builder + VS Code settings + email / Teams |
| Audit trail | in place (1.0.16) | spec, documents, `.dewa/audit/` |
| Authorization (who may approve) | in place (1.0.16) | `dewaSpecBuilder.approvers.*` |
| Guardrails: read-only SAP access | in place | `discoveryRunner.js` allow-list + write-verb deny-list, max. 30 tool calls |
| Human review of every AI result | in place | review dialogs: nothing is taken over without your choice |
| Testing | in place (1.0.16) | unit tests + browser end-to-end tests in CI |
| Grounding: SAP names in AI drafts checked against what SAP returned | in place (1.0.18) | review dialog; unverified names marked `[NOT VERIFIED IN SAP]` |
| Guardrails: untrusted text fenced, prompt-injection flagged, model allow-list | in place (1.0.18) | `js/guard.js`, `src/guardrails.js`, `dewaSpecBuilder.models.allowed` |
| Data masking before prompts | in place (1.0.19) | `dewaSpecBuilder.masking`, `.masking.patterns` |
| Telemetry (local usage statistics, never sent) | in place (1.0.19) | header → *Usage*; `dewaSpecBuilder.telemetry` |

## Roles

| Role | Does |
|---|---|
| **Business owner** | Writes or confirms the requirement (BRD); accepts the functional spec content. |
| **FS approver** | Approves the functional spec (gate G1). Listed in `dewaSpecBuilder.approvers.functional`. |
| **TS approver** | Approves the technical spec (gate G2), usually the technical lead. Listed in `dewaSpecBuilder.approvers.technical`. |
| **Developer / analyst** | Writes the specs with Copilot, reviews every AI result, runs *Check & read in SAP*. Cannot approve unless listed. |
| **IT / platform team** | Sets and distributes the settings, runs the SAP MCP servers with read-only users, keeps the approver lists up to date. |
| **Code reviewer** | Reviews the code `dewa-abap` produces before it is released for transport (gate G3). |

## Approval gates

| Gate | Needed before | Opens when |
|---|---|---|
| **G1** | Technical specs are created from a functional spec (*Create Technical spec*, *for all RICEFW items*, *from the program*) | the FS is approved by an FS approver **and has not changed since** |
| **G2** | The technical spec goes to `dewa-abap` (*Open in Copilot Chat*, copy for VS Code) | the TS is approved by a TS approver **and has not changed since**; with `gates.requireSapCheck` the TS can only be approved after *Check & read in SAP* ran without open ✗ findings |
| **G3** | Generated code is transported | the generated code is reviewed (DEWA's code review / transport approval in SAP) |

How an approval works – by sending the file (email or Teams; no Git or shared folder needed):

1. **Author:** Approval card → **Request approval**. The builder records the request in the audit trail, saves
   `FS_<title>_FOR-APPROVAL.md` (or `TS_…`) and copies a short message. Attach the file to an email or Teams message
   to the approvers and paste the message.
2. **Approver:** VS Code → *DEWA: Open SAP Spec Builder* → **Upload** the attachment. The builder says *Approval
   requested by …* and opens the Approval card. Review the spec, press **Approve**, then **Save approved file to
   send back** (`…_APPROVED.md`) and reply with it.
3. **Author:** **Upload** the approved file. It **replaces the author's own draft of that spec** (Undo is offered)
   instead of creating a second copy; gate G1 / G2 is now open.

The file carries the whole spec with its approval and audit trail (a hidden data block at the end), so nothing else
has to be exchanged. Details:

- The **Approval** card (FS step 3 and finished document; TS step 5 and finished document) shows the status, who
  approved and when, and the required approvers. Only a listed approver, signed in to GitHub in VS Code, sees
  **Approve**. The account is compared case-insensitively with the GitHub account VS Code is signed in with.
- An approval stores `{ by, at, version, hash }`. `hash` is a fingerprint of the spec **content** (not of the audit
  trail, timestamps or the approval itself). Any change afterwards makes the status *changed after approval*, closes
  the gate again and needs a new approval.
- The generated documents carry the approval (and its fingerprint). A Technical spec handed to `dewa-abap` without a
  valid approval starts with a **STOP** instruction to the agent.
- In a plain browser there is no signed-in identity: nobody can approve, and the gates only warn.

### Settings (VS Code)

| Setting | Default | Meaning |
|---|---|---|
| `dewaSpecBuilder.gates` | `enforce` | `enforce`: a closed gate blocks the action. `warn`: the user may *Continue anyway*; that is recorded as **gate override** in the audit trail. |
| `dewaSpecBuilder.gates.requireSapCheck` | `true` | G2: the TS needs a SAP check without open findings before it can be approved. |
| `dewaSpecBuilder.approvers.functional` | `[]` | GitHub accounts that may approve functional specs. |
| `dewaSpecBuilder.approvers.technical` | `[]` | GitHub accounts that may approve technical specs. |

With no approvers configured, nobody can approve and enforced gates stay closed. Configure the lists before rolling
out with `enforce`.

**How IT sets and locks them.** VS Code's enterprise *policies* (Windows Group Policy, macOS profiles, Linux
`policy.json`) can lock VS Code's own settings, but an ordinary extension cannot declare its settings as
policy-controlled. So these four settings **cannot be hard-locked** by VS Code today. What IT can do:

1. Distribute them in the **user settings** of managed machines (software distribution / login script writing
   `settings.json`) and, per project, in the repository's `.vscode/settings.json`.
2. Use VS Code's policy `extensions.allowed` to allow only the approved version of this extension.
3. Rely on the **audit trail and G3**: a gate override, or an approval by an account that is not on the published
   approver list, is visible in the document and in `.dewa/audit/`, and code only reaches SAP after review (G3).

A user who edits their own settings can relax the gates on their machine; the audit trail records `warn`-mode
overrides. If a hard lock is required later, approval must move to a central system (for example a document
management or Git workflow) – not available at DEWA today.

## Audit trail

Every spec keeps an append-only list of `{ at, by, type, data }` (newest last, at most 500 entries; older ones are
summarised in one entry). Recorded events:

- AI jobs: started / finished (job, automatic or Copilot Chat, read-only SAP access, outcome, duration, steps, model);
- AI input: the documents read (name, size, fingerprint) and the prompt length;
- review decisions on AI results (offered, accepted, declined);
- approvals (gate, version, fingerprint);
- gate blocks and gate overrides;
- hand-offs FS → TS and *created from* on the Technical spec;
- exports (Word, Markdown, Copilot Chat) with the approval status at that moment;
- uploads and examples loaded.

Where it goes:

- **In the documents:** the FS has *Audit trail* under Document Control; `BUSINESS_REQUIREMENTS.md` has *Approval &
  Audit Trail*.
- **In VS Code:** each entry is also appended to `<workspace>/.dewa/audit/<spec-id>.jsonl`. Copy that folder to a
  central share to keep a copy outside the user's machine.
- **In the browser:** the trail stays with the spec in local storage and in the downloaded documents.

## Testing

Every pull request and every push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- `node --test vscode-extension-addon/test/*.test.js`: unit tests (governance, panel routes, tool loop guardrails, document reader, …);
- `node scripts/build-config.js --check`: the config bundle matches `config/`;
- `node scripts/build-single.js`: the single-file app builds;
- `node --test tests/e2e/*.test.js`: browser end-to-end tests of the built app with a simulated VS Code host (gates, approval, audit).

**Branch protection** (GitHub → Settings → Branches → `main`): require a pull request, at least one approving
review, and the *CI* check to pass. This is a repository setting; it is not set by the code.

## Releases

- Version in `vscode-extension/package.json`; one entry per version in `vscode-extension/CHANGELOG.md`.
- Every change goes through a pull request with CI green; `main` is what users install.
- The release artefacts are rebuilt in the same pull request: `dist/SAP-Development-Specification-Builder.html`,
  `dist/dewa-sap-spec-builder-<version>.vsix` and the unpacked `dist/vscode-extension/`.

## Models and data

- Only the GitHub Copilot models available in the user's VS Code are used (`vscode.lm`); the builder has no own model
  keys. IT can restrict them with `dewaSpecBuilder.models.allowed` (e.g. `["gpt-5*", "*sonnet*"]`); if no available
  model is allowed, AI jobs stop with a message. The model used is in the audit trail (*AI job finished*).
- What is sent to Copilot: the requirement and spec text the user entered, uploaded documents (BRD, solution
  document), and what the read-only SAP tools return. Do not upload documents your data classification does not
  allow to be processed by GitHub Copilot.
- **Masking** (`dewaSpecBuilder.masking`, on by default): e-mail addresses, phone numbers, Emirates IDs, IBANs and
  card numbers – plus IT's own patterns in `dewaSpecBuilder.masking.patterns` (e.g. personnel numbers) – are replaced
  by tokens such as `[EMAIL_1]` before a prompt leaves the builder (also when it is copied to the clipboard), and put
  back in the answer before review; the token map stays in memory. In SAP tool results they are replaced by `[EMAIL]`
  before the model sees them. Each masking is recorded (*Personal data masked*). Names of people are **not** detected
  automatically – keep them out of documents or add a pattern. In Copilot Chat mode, the SAP tool results go through
  Copilot Chat directly and are not masked by the builder.

## Grounding and guardrails

- **Grounding.** When Copilot reads SAP for a draft (documents, existing objects, AS-IS), the extension keeps the
  evidence: which read-only tools were called and which SAP names their results contain (a *not found* answer
  verifies nothing). The review dialog then shows how many SAP names in the draft were read from the system, and lists
  the others as **Not verified in SAP**. Accepted rows with such a name carry `[NOT VERIFIED IN SAP]`, so nobody takes
  them for checked facts; the count is in the audit trail (*AI result reviewed*). Results from Copilot Chat or pasted
  answers have no evidence and say so.
- **Process search (BRD upload).** The read-only BRD job also searches SAP by process, within a fixed budget: at most
  12 searches by name / description (module prefixes from `dewaSpecBuilder.namespaces`, e.g. `ZHR*<keyword>*`; standard
  transactions, Fiori apps, released CDS / APIs, BAdIs), never a bare wildcard, at most 50 hits each, the logic of at
  most 3 objects, no table contents – inside the general limit of 30 tool calls. Hits are offered as unticked
  *candidates* with the reason; what is ticked is recorded (*AI result reviewed*: candidates offered / taken).
- **Untrusted input.** Uploaded documents are wrapped as `<<<BEGIN UNTRUSTED …>>>` data blocks, and every SAP tool
  result is labelled as data; the prompts tell the model never to follow instructions inside them.
- **Prompt-injection screening.** Documents, SAP tool results and AI answers are screened for text that looks like
  instructions to the AI ("ignore previous instructions", "you are now…", "activate … without approval" …). It is not
  acted on; the reviewer sees it in the review dialog and it is recorded (*Guardrail warning*).
- **Read-only SAP** (allow-list + write-verb deny-list, 30 calls) and **human review** of every AI result stay as before.

## Telemetry (local)

`dewaSpecBuilder.telemetry` = `local` (default) counts per month, on this computer only: AI jobs (runs, with result,
average time and steps, model), review decisions (accepted / declined parts, unverified SAP names), masked items,
guardrail warnings, approvals and requests, gate blocks and overrides, exports. No spec content is kept and nothing is
sent anywhere. Header → **Usage** shows the last three months and exports a CSV (to collect centrally if wanted).
`off` counts nothing.
- SAP access is read-only by design (see SECURITY.md); the SAP MCP servers should also run with read-only SAP users.
