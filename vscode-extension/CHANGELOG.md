# Changelog

## 1.0.22

- **SAP jobs can no longer hang.** Each SAP tool call has a time limit (60 s, `dewaSpecBuilder.toolTimeoutSeconds`): a call that does not answer is skipped (⏱ in the log) and the job goes on. While a call runs, the log says every 15 s what it is waiting for – and reminds you to allow the SAP tool if VS Code asks for it.
- **Time budget for reading SAP** (5 minutes, `dewaSpecBuilder.sapTimeBudgetSeconds`): then no more SAP calls are made and Copilot writes the answer from what was read. The SAP search of the BRD job (phase 1) uses at most 8 rounds.
- **Finish now** in the busy overlay (next to Stop): stop reading SAP at any time and get the result from what was read so far – for the BRD job the FS is then written as usual. **Stop** still cancels and keeps nothing. Recorded in the audit trail.
- A Copilot answer that stops arriving for 2 minutes ends the job with a clear message instead of waiting forever.

## 1.0.21

- **Faster *Generate FS from the documents*.** The job now runs in two phases (VS Code, automatic): (1) the read-only SAP search gets a short brief – the SAP names found in the documents, the start of each document, module and title – instead of the full documents; (2) the full documents and the SAP findings go to Copilot once, without tools, to write the FS. Before, every SAP tool round sent the whole documents again. SAP facts in the review (objects, candidates, programs read, current logic, type of change) come only from phase 1. Copilot Chat and Copy prompt work as before.
- **Faster SAP tool loop for every job:** up to 4 independent SAP calls run at the same time, and long tool results (e.g. a whole program source) are shortened to 12,000 characters for the model – new setting `dewaSpecBuilder.maxToolResultChars`; the grounding check still uses the full result.
- **Token consumption and ABAP artifacts read** for every Copilot job: tokens in / out counted with the model's tokenizer (≈ when estimated), model calls, SAP searches and the ABAP artifacts read – live in the busy overlay, in the review dialog (*Copilot used 42,300 tokens … · 3 ABAP artifacts read: …*), in the audit trail (*AI job finished*) and in **Usage** (tokens and artifacts per job; CSV).

## 1.0.20

- **The BRD upload searches the SAP system by process** – also when the BRD names no SAP object. From 3–6 business keywords of the documents, Copilot looks (read-only) for DEWA's custom objects of the module (`ZHR*<keyword>*`, `ZWHR*<keyword>*`, `ZFI*…` – prefixes per module, changeable with the new setting `dewaSpecBuilder.namespaces`), standard transactions and Fiori apps whose description matches, released CDS views / APIs and BAdIs of the area, and reads the logic of the best matches.
- **Targeted, not the whole system:** at most 12 searches (4 when the documents already name 3 or more objects), never a bare `Z*`, at most 50 hits per search, at most 3 objects read, no table contents.
- **Candidates in the review:** the hits are listed **unticked**, each with why it was found (keyword, origin custom / SAP standard). Only what you tick goes into *Existing SAP objects*, with the note *candidate – …*; the audit trail records how many were offered and which were taken.
- **Functional step 1 in a clear order:** *Where will this run?* comes first, then title and module, then **Start from documents**, then – *or describe the need yourself* – the business requirement, *Generate the whole spec*, *Existing SAP objects* and *More details*. The documents card explains what it will do for the chosen system and shows the module's prefixes it searches (e.g. `ZHR*`, `ZWHR*` for HCM), or asks you to pick the module first.

## 1.0.19

- **Personal data is masked before it reaches the AI.** E-mail addresses, phone numbers, Emirates IDs, IBANs and card numbers in prompts (sent to Copilot or copied to the clipboard) become tokens such as `[EMAIL_1]`; the answer gets the real values back before you review it. SAP tool results are masked too (`[EMAIL]`). IT can add patterns (`dewaSpecBuilder.masking.patterns`, e.g. personnel numbers) or switch it off (`dewaSpecBuilder.masking`). Each masking is recorded in the audit trail.
- **Usage (header):** AI jobs per month with runs, results, average time, steps and model; review decisions; unverified SAP names; masked items; guardrail warnings; approvals; gate blocks and overrides – counted on this computer only, without content, nothing is sent. Export as CSV; `dewaSpecBuilder.telemetry` = `off` switches it off.

## 1.0.18

- **Grounding.** When Copilot reads SAP for a draft, the extension keeps the evidence (tools called, SAP names in their results). The review dialog shows how many SAP names in the draft were read from the system and lists the others as **Not verified in SAP**; accepted rows with such a name are marked `[NOT VERIFIED IN SAP]`. The audit trail records the counts.
- **Guardrails.** Uploaded documents and SAP tool results are passed to the model as data, with the rule never to follow instructions inside them. Text that looks like an instruction to the AI ("ignore previous instructions", "activate … without approval" …) in documents, tool results or the answer is flagged in the review and recorded.
- **Allowed models.** `dewaSpecBuilder.models.allowed` restricts which Copilot models may run (e.g. `["gpt-5*", "*sonnet*"]`); otherwise the job stops with the list of available models.

## 1.0.17

- **Approval by email or Teams – no Git or shared folder needed.** On the Approval card the author presses **Request approval**: the builder saves `FS_<title>_FOR-APPROVAL.md` (or `TS_…`), records the request in the audit trail and copies a message to paste into Outlook or Teams with the file attached.
- **The approver** opens the attachment with **Upload**; the builder says *Approval requested by …* and goes to the Approval card. After **Approve**, **Save approved file to send back** saves `…_APPROVED.md` and copies the reply text.
- **The author** uploads the approved file: it **replaces their draft of that spec** (Undo offered) instead of creating a second copy, and the gate is open. The Approval card shows who requested approval, when and from whom.
- The approver settings no longer claim IT can lock them (VS Code cannot lock an extension's settings); they show an example instead.

## 1.0.16

- **Approval gates.** A functional spec must be **approved** before Technical specs are created from it (gate G1), and a technical spec before `dewa-abap` builds from it (gate G2). The new **Approval** card shows the status, who approved and when, and who may approve. Approvers are GitHub accounts listed in the VS Code settings `dewaSpecBuilder.approvers.functional` / `.technical`; only they see **Approve**.
- **Any change after approval needs a new approval.** The approval stores a fingerprint of the spec content; editing the spec afterwards closes the gate again. A technical spec handed to Copilot without a valid approval starts with a STOP instruction.
- **G2 needs the SAP check.** A technical spec can be approved only after *Check & read in SAP* ran without open ✗ findings (setting `dewaSpecBuilder.gates.requireSapCheck`).
- **Enforced by default, IT can relax it.** `dewaSpecBuilder.gates` = `enforce` blocks the action; `warn` lets the user continue, and that is recorded as an override. In a plain browser the gates only warn (no signed-in identity).
- **Audit trail.** Each spec records AI jobs (start, end, model, duration, outcome), documents read, review decisions, approvals, gate blocks and overrides, hand-offs and exports. It appears in the documents (*Audit trail* / *Approval & Audit Trail*) and, in VS Code, is also written to `.dewa/audit/<spec-id>.jsonl` in the workspace.
- **Tests in CI.** Unit tests and browser end-to-end tests (gates, approval, audit, New / Undo) run on every pull request. New [GOVERNANCE.md](https://github.com/abdulsameemd/Development-Specification-Builder/blob/main/GOVERNANCE.md) and [SECURITY.md](https://github.com/abdulsameemd/Development-Specification-Builder/blob/main/SECURITY.md).

## 1.0.15

- **Busy overlay while the AI works.** Whenever the builder reads the DEWA SAP system or asks Copilot to generate something, an overlay shows what is happening – for example *AI is reading DEWA SAP ABAP artifacts* or *AI is reading your BRD and solution document* – with what the agent is doing right now (reading program source, checking objects read-only, classifying the change …), the latest step from the SAP tools, elapsed time and **Stop**. **Keep working** hides it into a small pill that reopens it. In Copilot Chat mode it says to follow the progress in Chat.
- **Deleting works in VS Code.** The ✕ on a functional requirement (and on any other entry with sub-fields, such as methods or RAP entities) did nothing inside VS Code, because VS Code blocks the browser's confirmation box. It now deletes right away and offers **Undo** for a few seconds.
- **New starts clean.** Opening another spec (New, Drafts, Upload, switching Functional / Technical) clears what belonged to the previous one: uploaded BRD / solution documents, Copilot progress and errors, discovery and SAP-check results. Object names typed in the old single "programs" field (before 1.0.11) no longer reappear.
- **Examples are not saved to Drafts unless you change them**, so switching between Functional and Technical no longer reopens an example. Examples saved by earlier versions can be removed in *Drafts*.

## 1.0.14

- **Functional spec, step 1: Start from documents.** Upload the BRD and/or the solution document – Word (.docx), PDF with text, Excel (.xlsx), Markdown or text. Copilot reads them, checks the SAP objects they name read-only, classifies the change as **new**, **enhancement** or **as-built**, and drafts the whole FS (requirements with their BRD IDs, rules, AS-IS / TO-BE, objects, RICEFW items, tests, risks) for your review.
- The type of change and the source documents are shown in step 1 and written to the document.
- **Step 3: Create Technical specs for all RICEFW items.** The main object follows the type of change (new, existing – change, existing); in VS Code each Technical spec opens with Check & read in SAP.
- Priorities written as High / Medium / Low are mapped to Must / Should / Could.

## 1.0.13

- **Functional spec, step 2: TO-BE process from the AS-IS and the requirement.** *Proposed process (TO-BE)* has **Generate TO-BE**: Copilot designs the process after the change from the AS-IS steps, their pain points, the requirement, scope and the existing objects. Each step comes with role, transaction / app and a change mark (unchanged, changed, new, automated). You review it first; steps you typed stay. Works for SAP and non-SAP specs, without system access.
- AI answers now keep the transaction / app of TO-BE steps.

## 1.0.12

- **Functional spec, step 2: AS-IS process from the existing objects.** Step 2 opens with *Current process (AS-IS)*. With the existing objects listed in step 1, **Generate AS-IS from the objects** has Copilot read them read-only and write the current business process: steps in order, with the role, the transaction / app / job / interface and the pain points where the code shows manual work. You review it first; steps you typed stay.
- The AS-IS steps are drawn as a flow in the builder and in the document, next to the table.
- AI answers now keep the transaction / app of each AS-IS step.

## 1.0.11

- **Functional spec, step 1: Existing SAP objects.** List several existing objects, each with its type: report / program, transaction code, ABAP class or interface, function module, RFC, function group, CDS view, RAP business object, OData service, proxy class, table, BAdI, form, IDoc type, Fiori app or background job. Rows can be pasted from Excel.
  - *Read automatically* / *Read in Copilot Chat* read all of them (read-only) and describe the current logic.
  - The list is in the document (*Current System → Existing SAP objects*), is checked by discovery, and goes to every Technical spec created from the FS with the matching object type.
  - Replaces the single "Programs, transactions, classes or function modules" text field; names typed there before are still read.

## 1.0.10

- **Check & read in SAP for Technical specs** (step 3 Objects), read-only through the SAP MCP servers:
  - every object name is checked: in system, not found, name free, or a new name that already exists;
  - the existing objects are read: fields and keys, CDS elements, method and parameter signatures, the current logic and where-used;
  - *To Be Confirmed* objects become *Existing* or *New* after your review;
  - the current state is shown read-only in step 4, and goes into a new **Current State in SAP** section of the specification for `dewa-abap`. Your own design is never changed.
- Runs automatically in VS Code, in Copilot Chat with `dewa-fs-discovery` (new `dewa_submitDevContext` tool), or with a copied prompt in the browser.
- Walkthrough videos: a functional consultant's intro for the Functional video, one-word pronunciation of DEWA and ABAP, and *Powered by MORO* at the end of both.

## 1.0.9

- **Read an existing program:** the data requirements now keep the table and the field in separate columns, so discovery's reference check finds the tables. Before, a value such as `BSIK-LIFNR` was reported as not found.
- The review dialog no longer says the AI only knows the requirement, which was wrong for results read from a program.
- New walkthrough video, inside VS Code only, from running the extension to the developer hand-off.

## 1.0.8

- **Technical specs stay in step with their functional spec.** A Technical spec created from an FS, from a RICEFW item or "change the program", remembers its source.
  - When the FS changes, including after an upload, the Technical spec shows what changed.
  - **Update from FS** takes over only what came from the FS. Everything the developer added or edited stays.
  - **Keep my version** accepts the change without updating.
  - The FS lists its Technical specs, each marked *up to date* or *FS changed*.
- **Upload still restores only the spec you upload.** Nothing flows from a Technical spec back to the FS.

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
