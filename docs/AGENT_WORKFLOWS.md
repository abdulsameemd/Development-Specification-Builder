# DEWA Agent Workflows

A practical guide to choosing and working with the DEWA backend agents. The source of truth for exact rules remains each agent file under `agents/` and the shared router in `AGENTS.md`.

## At a Glance

| Agent | Choose it for | Main output | User checkpoint |
| --- | --- | --- | --- |
| `dewa-abap` | Building new ABAP, CDS, RAP, or CAP backend artifacts | One new/changed artifact at a time, with tests and validation status | Type `CONFIRM ARTEFACT` before the next artifact |
| `dewa-codereview` | Reviewing or safely improving existing ABAP, CDS, RAP, or CAP code | Full review report, findings, safe fixes, and optionally an as-built technical specification | Answer Y/N for flagged changes; type `CONFIRM REVIEW` before handoff |
| `dewa-adobeagent` | Building or maintaining SAP Adobe Forms and their ABAP integration | Form interface, form object/context, data provider or driver, and validation evidence | One artifact at a time; no named confirmation keyword is specified in this agent |

All three agents are backend-focused and use the ADT MCP server for SAP repository operations where available. They do not replace target-system authorization, SAP activation, ATC, ABAP Unit, Basis/ADS checks, or required technical approvals.

## How to Choose

```mermaid
flowchart TD
    A[What are you working on?] --> B{Adobe Form / SFP / ADS?}
    B -->|Yes| C[Use dewa-adobeagent]
    B -->|No| D{Is the code already present?}
    D -->|No - create new backend artifacts| E[Use dewa-abap]
    D -->|Yes - inspect, fix, modernize, or optimize| F[Use dewa-codereview]
    C --> G[Graphical layout work is done in Adobe LiveCycle Designer]
    E --> H[One artifact at a time]
    F --> I[Review first; fixes require the defined confirmation flow]
```

The agents are separate entry points, not a dependency chain. A typical handoff is optional: build with `dewa-abap`, then review the result with `dewa-codereview`; for an Adobe Form, use `dewa-adobeagent` for ABAP/form-contract work and LiveCycle Designer for graphical layout.

## Shared Session Pattern

Before SAP backend changes, establish the target and inspect the local context. The exact checklist depends on the agent, but commonly includes the target system/release, package/software component, ABAP language version, existing objects, test coverage, transport context, and the functional requirement. Do not guess system facts or claim checks that were not run.

```mermaid
flowchart LR
    A[Select the matching agent] --> B[Read the relevant project requirement and existing objects]
    B --> C[Confirm target, package, language version, and scope]
    C --> D[Make the smallest in-scope change]
    D --> E[Run available activation, tests, and static checks]
    E --> F[Report evidence and unresolved prerequisites]
    F --> G[Stop at that agent's approval boundary]
```

In the ADT virtual workspace, repository files may be virtual. Follow the agent's directory-first navigation instructions and use the ADT MCP server for SAP operations. A file edit alone does not prove that an SAP object activated or passed tests/ATC.

## `dewa-abap`: Build New Backend Work

Use for new backend implementation: ABAP classes, CDS, RAP, CAP, and related service artifacts. The agent treats `BUSINESS_REQUIREMENTS.md` as the requirement source when present and follows the project's target and package rules.

### Build Flow

1. Confirm target/release, tier, backend model, OData version, draft requirement, entity structure, package, language version, and existing repository context. Use applicable DEWA defaults rather than repeatedly asking for already-confirmed defaults.
2. For approved cloud-ready development, check the assigned `ZS4DEWA_CLOUD` software component and approved `ZCLOUD_ROOT`/module package. Otherwise follow the project package convention. Never assume package assignment without target context.
3. Choose the implementation path:
   - RAP for new transactional OData V4 business objects.
   - CAP for BTP side-by-side applications.
   - Standalone OO ABAP only for suitable non-RAP business logic.
4. For RAP, follow the declared dependency order: persistence table; draft table only when explicitly required; interface/root/projection CDS; metadata extension and access control; interface/projection behavior definitions; behavior implementation and tests; service definition; service binding.
5. Create one artifact, validate it, and present its result before proceeding. Do not batch the generation order.
6. Add the required unit-test stub with each handler/service. Run unit tests after source changes using the ADT MCP server where available. Activate changed development objects as part of the authorized development workflow; report failures or unavailable checks.
7. Run the applicable target-mandated ATC/Clean Core checks in ADT. Report the actual variant and result; do not claim a pass without tool evidence.
8. Present the artifact, changes, activation/test/ATC evidence, and open items. Stop until the developer types the exact keyword `CONFIRM ARTEFACT` before creating the next artifact.

### Important Boundaries

- No unrequested RAP draft behavior.
- Do not use `COMMIT WORK` for RAP; use RAP transaction handling and EML as required.
- Use released APIs for ABAP Cloud. If release status is unknown, stop before depending on the object from Cloud code.
- Do not directly change production, release transports, or import transports without required explicit approval.
- Review for Clean Core and security evidence through the target system/ATC, not code appearance alone.

## `dewa-codereview`: Review Existing Code

Use for code that already exists when the task is to inspect quality, refactor safely, modernize, or optimize. It is not the primary agent for creating a new application from scratch.

### Review and Fix Flow

1. Select one object. Read its source and tests. Review the full object before presenting findings; do not stream partial results.
2. Analyze the object across performance (`PERF`), style (`STY`), security (`SEC`), modernization/Clean Core, and performance optimization checks.
3. Present the complete review report before changing anything. Review is read-only until the developer confirms fixes.
4. Safe, behavior-preserving fixes may be applied according to the agent rules. Present flagged or behavior-affecting suggestions and obtain a clear Y/N decision before applying them.
5. **Never auto-fix security findings.** Report them for remediation. Critical security findings block handoff; escalate the specified critical authorization concern to the security owner.
6. After fixes, activate the object, rerun ABAP Unit tests, and run ATC when available. Confirm no new violations; report anything not run.
7. Always show the complete review report in chat; this is the guaranteed delivery path for developers working in an ADT virtual workspace.
8. Offer an optional Desktop copy with a `cmd.exe` command, for example `notepad "%USERPROFILE%\Desktop\review_report_zcl_fi_invoice_processor.md"`. The developer runs it, copies the report from chat into Notepad, and saves. Never claim the file was saved unless the developer confirms it.
9. Stop at the review gate. The developer must type `CONFIRM REVIEW` before handoff and generation of the as-built technical specification.
10. After confirmation, generate the technical specification from actual changes and validation evidence, show it in chat, and offer a similar Desktop-save command. Do not invent test, ATC, activation, or performance results.

The agent must not attempt to create report files inside the ADT virtual workspace; it has no local file storage.

### Review Output Categories

- **Auto-fixed:** safe behavior-preserving changes made, with locations and rationale.
- **Flagged:** changes that need a developer decision, including behavior risk.
- **Security:** findings are report-only and never auto-fixed.
- **Performance:** recommendations; measure uncertain/high-impact changes with approved runtime or SQL analysis rather than guessing.

## `dewa-adobeagent`: Adobe Forms and ABAP Integration

Use for SFP/ADS form interfaces and objects, form context, ABAP data providers/drivers, output integration, and PDF-render troubleshooting. It owns the ABAP side and form contract. Graphical XDP layout changes belong in Adobe LiveCycle Designer.

### Form Delivery Flow

1. Confirm document type, trigger, data source and keys, output channel, language/country needs, existing reusable form objects, and interface type. Dictionary-based is the default for ABAP callers; ask explicitly before choosing XML Schema-based.
2. Design the contract and objects separately. The expected structure is a form interface, a form object/context, a LiveCycle layout inside the form, and a caller implemented as a thin driver plus a testable data provider where applicable.
3. Generate in order, one artifact at a time: interface then activate; form/context then activate; driver/data-provider then activate. Do not collapse these contracts into one artifact.
4. Keep data selection and display formatting in the data provider. Keep the driver thin. Resolve the generated form function-module name at runtime; do not hardcode the generated name.
5. Run the applicable data-provider ABAP Unit tests, activation, ATC, SFP preview, and end-to-end render checks where the environment permits. Confirm PDF output and ADS connectivity when required. Keep `FP_JOB_CLOSE` guaranteed on errors.
6. Report exactly which checks passed and which could not be run. Do not mark the task complete based only on ABAP activation if form binding, rendering, or delivery is still unverified.
7. Clearly identify remaining work outside the agent, such as LiveCycle Designer layout updates, ADS/Basis prerequisites, or print destination setup.

### Form-Specific Boundaries

- Preserve transported interface parameters; add optional parameters rather than removing or retyping contract fields.
- Do not put database reads or business logic in form code initialization.
- Format amounts, dates, units, addresses, and translated display text in ABAP before the form consumes it.
- Treat customer, financial, and tax data as sensitive. Do not use real production data in examples or committed fixtures.
- Do not invent ADS destinations, printers, SAP object names, or render results.

## VS Code Extension Distribution

The VS Code extension is a delivery mechanism for the agent files; it does not create a runtime dependency between agents.

```mermaid
flowchart LR
    A[Source agents in agents/] --> B[build-kit.js copies *.agent.md]
    B --> C[Generated vscode-extension/kit/]
    C --> D[VSIX package]
    D --> E[VS Code extension activates]
    E --> F[Copies agent files to user prompts folder]
    F --> G[Developer selects an agent in Chat]
```

- The extension bundles `agents/*.agent.md` into `vscode-extension/kit/` during packaging.
- On startup, `extension.js` copies bundled agent files into `%APPDATA%\Code\User\prompts` when `dewaAbapAgent.autoInstall` is enabled.
- Agent copies refresh when the extension version changes. The reinstall command can copy them again manually.
- `skills/` and the root `AGENTS.md` router belong to the repository-level kit workflow; the VS Code extension package described here bundles and installs agents only.
- Installing files makes agents available; it does not auto-select an agent, connect to SAP by itself, or validate ABAP code.

## Quick Comparison

| Concern | `dewa-abap` | `dewa-codereview` | `dewa-adobeagent` |
| --- | --- | --- | --- |
| Main task | Build new backend artifacts | Review/fix existing backend objects | Build/maintain Adobe Forms and ABAP integration |
| Primary focus | RAP/CAP/CDS/ABAP implementation | PERF/STY/SEC and safe refactoring | Form contract, data provider, driver, output/render |
| Work unit | One artifact at a time | One object at a time | One form artifact at a time |
| Human gate | `CONFIRM ARTEFACT` between artifacts | Y/N for flagged fixes, then `CONFIRM REVIEW` | Sequential artifact workflow; no named keyword in the agent file |
| Specialized manual work | SAP system activation/ATC/tests | Security owner sign-off for critical findings | Adobe LiveCycle Designer and possible Basis/ADS work |

## Source Files

- `AGENTS.md`: repository-level router and shared process rules.
- `agents/dewa-abap.agent.md`: new backend development.
- `agents/dewa-codereview.agent.md`: existing-code review/refactor/optimization.
- `agents/dewa-adobeagent.agent.md`: Adobe Forms and ABAP-side delivery.
- `vscode-extension/extension.js`: agent installation into the VS Code user profile.
- `vscode-extension/scripts/build-kit.js`: packaging source agents into the extension bundle.
