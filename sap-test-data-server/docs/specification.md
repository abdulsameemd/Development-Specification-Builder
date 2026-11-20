# SAP Test Data Server: High-Level Specification

Version 1.0 · 2026-11-12 · Status: confirmed, ready to hand to Claude Code for building

---

## 1. Purpose and scope

Build a **separate Model Context Protocol server** (called "the test data server" in this document) that lets an AI assistant create and change **test master data** in an SAP **test client** (client 300), so developers can unit test and integration test their SAP developments.

**Phase 1 focus: SAP Human Resources.** Roughly 90 percent of scenarios work on **employees that already exist** in the system. The server therefore mainly:

- creates, changes and delimits records on **Personnel Administration infotypes** (employee record types such as 0001 organizational assignment, 0006 addresses, 0105 communication),
- creates, changes and delimits records on **Organizational Management infotypes** (organizational units, positions, jobs and their relationships),
- creates, changes and delimits records on **Time Management infotypes** (the 2000 range, such as absences 2001, attendances 2002, substitutions 2003, absence quotas 2006 and similar),
- always saves a **before-image** so every change can be restored.

**Scope of capability:** all Personnel Administration infotypes, all Time Management infotypes and all Organizational Management (Human Resources Planning) infotypes are supported **technically**, including custom Z infotypes. Which ones are actually **enabled** is decided by the policy table in SAP (section 8), so rollout can start small and grow without code changes.

Later phases may add other modules (finance, materials, sales) as separate "domain packs" using the same engine.

### What the server will NOT do

- It never runs against a production client.
- It never writes directly into database tables. All writes go through SAP's classic APIs (section 4.4) so SAP's own checks and your custom enhancements run. It also never reads SAP tables directly.
- It does not create or delete whole employees in Phase 1 (hiring actions are out of scope).
- It does not run payroll.
- Pay-related, bank and personal identification infotypes are enabled, but their sensitive fields are always masked when read (section 9), and an administrator can switch any infotype off.
- It never returns personal details (names, pay, bank data, addresses) to the AI model unless the policy allows it.

---

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Relationship to existing tooling | Separate server, next to SAP's ABAP development tools server. That one handles code and transports. This one handles business data only. |
| AI client | GitHub Copilot in agent mode, inside Visual Studio Code. |
| Where the server runs | On the developer's own computer, started by Visual Studio Code, talking over standard input and output. |
| SAP release | SAP S/4HANA 2023 (latest statement). Earlier notes said 2021 feature pack stack 03, so **confirm on the system status screen in Phase 0**. The API lists in section 4.5 are release specific. |
| Human Resources mode | Human Capital Management for S/4HANA. |
| Initial scope enabled | All Personnel Administration, Time Management and Organizational Management infotypes, plus the basic payroll infotypes. Sensitive fields stay masked on read (section 9). |
| SAP user | One functional user that already holds all required roles in the test client. Used only by this server. |
| Employee eligibility | Any employee in client 300 that matches the criteria. An optional exclusion list (empty by default) can protect specific employees. |
| Dates | Past and current dates are both needed. Past dates are allowed with warnings (section 8, rule 6). |
| Server language | TypeScript on Node.js. |
| ABAP delivery | ABAP development tools, with normal transports from development to test. |
| Data protection | Approved: masked employee numbers may pass through the Copilot model service. |
| Interfaces | None are active in the test system (confirmed). The wrapper still warns if change pointers become active later. |
| Target system | Test client 300 only. |
| Connection to SAP | Secure web requests to a small **ABAP wrapper service** in the test system. (A prototype may use an ABAP development tools class run, but it is not the target design.) |
| How data is written | SAP **classic APIs** only (classes and function modules that SAP lists as classic APIs), called from the wrapper. See section 4.4. |
| Clean core | Every SAP object used must be marked released or classic API on SAP's published lists. No unlisted, deprecated or "noAPI" objects, and no direct selects from SAP tables. Checked automatically (section 4.5). |
| Change workflow | **Plan first, then execute.** The plan is built and stored inside SAP. The execute step can only run a stored plan. |
| Undo | A ledger in SAP stores before-images. Restore applies the reverse operations. |
| Who plans | The AI model plans. Plain code validates. The model never decides whether a write is safe. |

Everything above is confirmed. The verification steps for the first phase are listed in section 14.

---

## 3. Architecture

```
Visual Studio Code (developer's computer)
┌──────────────────────────────────────────────────────────┐
│  Copilot chat (agent mode)                               │
│      │                                                   │
│      ├──► SAP ABAP development tools server  ──► Development system (code, transports)
│      │        (already in place)                         │
│      │                                                   │
│      └──► TEST DATA SERVER (new, this spec)              │
│               │ secure web requests                      │
└───────────────┼──────────────────────────────────────────┘
                ▼
        SAP TEST SYSTEM, CLIENT 300
        ┌──────────────────────────────────────────────┐
        │ ABAP wrapper service (new)                   │
        │   safety checks → ledger → lock → write →    │
        │   commit / roll back → unlock                │
        │ SAP classic APIs (see section 4.4)         │
        │ Human Resources data (existing)              │
        └──────────────────────────────────────────────┘
```

Responsibilities are split deliberately:

| Layer | Responsible for | Must NOT be responsible for |
|---|---|---|
| Copilot model | Understanding the request, choosing tools, explaining results | Safety decisions, validation |
| Test data server | Exposing tools, checking inputs, talking to SAP, reducing output | Business rules, policy, deciding what is allowed |
| ABAP wrapper | **All policy**: client check, allowed infotypes, eligible employees, limits, masking, ledger, locking, writing | Talking to the AI model |
| SAP standard functions | Validating and saving records | Anything custom |

**Key principle: policy lives in SAP, not in the server.** Even a modified or misbehaving server cannot bypass the production block, the allowed list or the masking rules.

---

## 4. Components to build

### 4.1 Test data server (runs on the developer's computer)

- Language: TypeScript on Node.js with the official Model Context Protocol software development kit (decided: strict type checking, input schemas for every tool, easy to run on developer computers without extra environments).
- Transport: standard input and output.
- Responsibilities: tool definitions, input validation, SAP web client (logon, session cookie, security token handling for write requests), structured error mapping, local log file without personal data, a **mock mode** that returns fake wrapper responses so development and tests work without SAP.
- Configuration comes from environment variables (see section 5).

### 4.2 ABAP wrapper (lives in the test system)

Delivered as one development package (suggested name `ZHR_TESTDATA`) and transported through the normal route. Suggested parts (names are suggestions):

| Part | Purpose |
|---|---|
| Web handler class | Receives requests, routes to operations, returns structured responses. Activated as a service in the Internet Communication Framework in the **test system only**. |
| Safety class | Environment allow-list check (system and client), expected-system check, policy lookup, limits, production block. |
| Personnel Administration operations class | Read, create, change, delimit and delete employee infotype records using the classic classes listed in section 4.4. |
| Organizational Management operations class | Same for organization objects and relationships, using the Organizational Management classic classes (see section 4.4). **Confirm that each one exists and behaves as described during discovery.** |
| Time Management operations class | Same approach for the 2000-range infotypes (absences, attendances, quotas and so on) through the same classic classes, plus checks specific to time data (overlaps with other time records, quota interaction). **Confirm behavior of each time infotype during discovery.** |
| Dictionary class | Describes any infotype (fields, mandatory fields, subtypes, time constraint) by reading the dictionary, so custom Z infotypes work automatically. |
| Ledger class and tables | Stores plans, runs, before-images and results. |
| Policy tables | Allowed infotypes, field visibility (masking), limits, exclusion list. Maintained by an administrator. |
| Plan and restore class | Builds dry runs, executes stored plans, builds and executes restore plans. |

### 4.3 Configuration and documentation

- A shared example settings file for Visual Studio Code (`mcp.example.json`).
- A setup guide for developers and a short guide for SAP administrators (service activation, user role, policy tables).

### 4.4 SAP APIs to use (clean core, SAP S/4HANA 2023)

**Principle.** The wrapper may use only SAP objects that SAP's own published lists mark as **released** (stable) or **classic API** (accepted when no released API exists). For Human Resources, no released APIs for writing employee or organization data were found in the lists checked, so the design uses **classic APIs**. Several function modules common in older Human Resources code are **not on SAP's lists at all** and are excluded.

**Source.** SAP's public list repository `SAP/abap-atc-cr-cv-s4hc` (release file for 2023 feature pack stack 03 and the classic API file), checked on 2026-11-12. Re-run the check in section 4.5 once the release is confirmed and whenever SAP updates the lists. Also confirm each state in ABAP development tools (API state in the object properties). **Class method names below are not verified. Phase 0 must confirm them. Never guess.**

**Employee infotypes (Personnel Administration and Time Management)**

| Purpose | Use | State | Notes |
|---|---|---|---|
| Create, change, delete, delimit records | `CL_HRPA_MASTERDATA_BL`, obtained through `CL_HRPA_MASTERDATA_FACTORY` | Classic API | SAP names this class as the **successor** of function module `HR_MAINTAIN_MASTERDATA`. Confirm which methods exist and whether they cover Time Management infotypes (2000 range) and custom Z infotypes. |
| Hold infotype records | `CL_HRPA_INFOTYPE_CONTAINER`, `CL_HR_PNNNN_TYPE_CAST` | Classic API | |
| Read records | `CL_HRPA_READ_INFOTYPE` | Classic API | |
| Lock and unlock an employee | `CL_HRPA_MASTERDATA_ENQ_DEQ` (alternative: `BAPI_EMPLOYEE_ENQUEUE`, `BAPI_EMPLOYEE_DEQUEUE`) | Classic API | Always unlock, also after errors. |
| Authorization check | `CL_HRPAD00AUTH_CHECK_STD` | Classic API | |
| Collect messages | `CL_HRPA_MESSAGE_LIST` | Classic API | Return SAP's own message text. |
| Commit or roll back | `BAPI_TRANSACTION_COMMIT`, `BAPI_TRANSACTION_ROLLBACK` | **Released** | |
| Describe an infotype | Runtime type information (`CL_ABAP_STRUCTDESCR`, `CL_ABAP_TYPEDESCR`) on the infotype structure | Released | Do **not** read tables `T582A` or `T591A` (not classified). Time constraint and subtype information must come from the classic infotype classes. Confirm in Phase 0. |
| Find employees | `BAPI_EMPLOYEE_GETLIST` plus reads through `CL_HRPA_READ_INFOTYPE` | Classic API | SAP offers no classified search by criteria, so searches scan in pages up to a policy cap. Do **not** select from `PA0001` or similar tables. |

Per-infotype BAPIs (for example `BAPI_ADDRESSEMP_*`, `BAPI_EMPLCOMM_*`, `BAPI_BASICPAY_*`, and `BAPI_PTMGRATTABS_MNGCREATION`, `_MNGCHANGE`, `_MNGDELETE` for attendances and absences) cover only some infotypes. Use them only as a fallback where the class does not cover an infotype, after checking their state.

**Organization objects (Organizational Management, Human Resources Planning infotypes)**

| Purpose | Use | State | Notes |
|---|---|---|---|
| Read objects, records, relationships | `CL_HRBAS_PD_OBJECT` (alternatives: `RH_READ_OBJECT`, `RH_READ_INFTY`, `RH_SELECT_OBJECTS_FOR_OTYPE`) | Classic API | |
| Create and maintain objects and relationships | `CL_HRBAS_PD_OBJECT_ADMIN` (object creation alternative: `RH_OBJECT_CREATE`) | Classic API | Confirm which methods create, change, delimit and delete records and relationships (infotype 1001). |
| Lock and unlock an object | `HR_ENQUEUE_OBJECT`, `HR_DEQUEUE_OBJECT` | Classic API | |
| Collect messages | `CL_HRBAS_MESSAGE_LIST` | Classic API | |

**Web service and utilities.** `IF_HTTP_EXTENSION` (handler), `/UI2/CL_JSON`, `CL_SYSTEM_UUID`, `CL_ABAP_TSTMP`. Confirm each state with the check in section 4.5. Your own tables (ledger, policy, allow-list) are fine.

**Do NOT use (checked against SAP's lists)**

| Object | Result |
|---|---|
| `HR_INFOTYPE_OPERATION`, `HR_EMPLOYEE_ENQUEUE`, `HR_EMPLOYEE_DEQUEUE`, `HR_CHECK_AUTHORITY_INFTY` | Not listed (no release statement). |
| `RH_INSERT_INFTY`, `RH_UPDATE_INFTY`, `RH_UPDATE_DATABASE`, `RH_DELETE_INFTY`, `RH_PNNNN_MAINTAIN`, `RH_RELATION_MAINTAIN`, `RH_CUT_INFTY_1001_EXT`, `RH_DELETE_INFTY_1001_EXT`, `RH_INSERT_INFTY_1001_EXT`, `RH_OBJECT_DELETE`, `RH_BASE_AUTHORITY_CHECK`, `RH_STRU_AUTHORITY_CHECK` | Not listed. |
| `BAPI_ABSENCE_CREATE`, `_CHANGE`, `_DELETE` and other `BAPI_ABSENCE_*` | Marked **noAPI**. |
| Direct selects from `PA0001`, `PA2001`, `HRP1000`, `HRP1001`, `T000`, `T582A`, `T591A` | Not classified. |
| `HR_MAINTAIN_MASTERDATA`, `HR_READ_INFOTYPE` | Superseded by the classes above where SAP names a successor. |

**Consequences built into the design**

1. The production block uses an environment allow-list (section 8, rule 1), because SAP offers no classified way to read the client role.
2. Find employees is a paged scan with a cap.
3. Dry runs use a check method if the classes offer one, otherwise the real write followed by a rollback (section 14, item I).
4. If a classic class lacks an operation (for example delimiting a relationship), the operation is left out or you approve a documented exception (section 14, item F). Claude Code must not substitute an unlisted function module on its own.

**Rules for using the APIs**

1. **Commit pattern.** Write the ledger entry as "running" and commit it first. Perform the writes without committing. On success, commit once and mark it "done". On error, roll back, mark it "failed" and commit that status. In Phase 0, verify that rollback undoes each family of writes. If not, mark that family "restore by reverse operation only" in the plan.
2. **Never trust a clean return message alone.** Read the record back after every write and compare it with the plan.
3. **Delimit.** Confirm in Phase 0 how the class delimits a record.
4. **Automatic delimiting.** Creating a record inside an existing one usually delimits the earlier record. The plan shows this as an extra item and the before-image covers **all records of that infotype and subtype in the affected date range**.
5. **Changes need the full record.** Read it, change fields, send the whole record.
6. **Organization objects** need the structural authorization check before writing, if the classes expose it.

### 4.5 Clean core compliance and automatic checking

1. **Rule.** Every SAP-delivered object the wrapper uses must be marked **released** or **classicAPI** on SAP's lists for the release. Unlisted, deprecated and noAPI objects are forbidden. No modifications, no implicit enhancements. Only your own objects in the customer namespace are created.
2. **Language version.** The wrapper uses the standard ABAP language version, because the Human Resources classic APIs cannot be called from the restricted cloud version. Keep the wrapper thin, with every Human Resources call in one class per area, so SAP's later successors replace only one place (the classic-API-as-wrapper pattern).
3. **Source of truth.** `github.com/SAP/abap-atc-cr-cv-s4hc`, folder `src`: the release file for your release (2023 feature pack stack 03: `objectReleaseInfo_PCE2023_3.json`) and `objectClassifications_SAP.json`. Entries carry `objectType`, `objectKey`, `state` (`released`, `classicAPI`, `noAPI`, `deprecated`) and `successors`.
4. **Check in SAP.** Run the ABAP Test Cockpit clean core checks ("Usage of APIs" and the Cloudification Repository check) with SAP's file for the release. The repository documentation names the SAP notes to apply (3284711, 3377462, 3507814, 3565942). Basis applies them in the test system.
5. **Check in the repository.** Claude Code builds `scripts/check-api-state`, which extracts SAP object names from the ABAP source copies in `abap/` and fails if any is not `released` or `classicAPI`. It runs in the pipeline.
6. **Zero findings** are required at the end of every phase. Any exception goes into `docs/clean-core-exceptions.md` with owner approval, reason, and removal plan.

---

## 5. Connection and configuration

Settings are placed in the Visual Studio Code server settings file (`.vscode/mcp.json` in the project, or the user settings). Non-secret values go in the environment section. The password is **prompted at start-up and never stored**.

```json
{
  "inputs": [
    { "type": "promptString", "id": "sap-password",
      "description": "SAP password for the test client", "password": true }
  ],
  "servers": {
    "sap-test-data": {
      "type": "stdio",
      "command": "node",
      "args": ["<path>/sap-test-data-server/dist/index.js"],
      "env": {
        "SAP_HOST": "<https://test-system-host:port>",
        "SAP_CLIENT": "300",
        "SAP_EXPECTED_SYSTEM": "<test system id>",
        "SAP_USER": "<user>",
        "SAP_PASSWORD": "${input:sap-password}"
      }
    }
  }
}
```

Rules for the server:

1. Host, client, expected system and user are **required**. There are no defaults. If any is missing, the server refuses to start.
2. On start-up and in `get_connection_status`, the server asks SAP for its system name, client and allow-list status and refuses all write tools if they do not match the expected values.
3. Never log or print the password, session cookies or security tokens.
4. Use encrypted connections only.

**User model (decided):** one functional user that already holds all required roles in client 300. Consequences to design for:
- SAP's own authorization checks are broad for this user, so **the policy table in the ABAP wrapper is the effective control** (section 8).
- SAP sees only the functional user, so the server sends a self-reported **requester name** (the developer's operating system user name) with every plan, and the ledger stores it. It is useful for tracing but it is not proof of identity.
- Use this user **only** for the server, never for manual logons, so its activity in SAP is clearly the server's.
- Every developer enters the same password at start-up. Keep the password in your approved secrets store, and rotate it when a developer leaves the team.

---

## 6. Tools exposed to the AI assistant

Keep the tool list short (about eight tools) with plain-language descriptions. Copilot works best with few, well-described tools.

| Tool | Kind | Purpose | Main inputs | Returns |
|---|---|---|---|---|
| `get_connection_status` | Read | Shows system, client, environment allow-list status, logged-in user, wrapper version, and whether writes are allowed. | none | Status and warnings |
| `describe_infotype` | Read | Explains an infotype: fields, mandatory fields, subtypes, time constraint, existing policy (allowed or blocked). Works for employee and organization infotypes and for custom Z infotypes. | infotype number, kind (employee or organization) | Structured description |
| `find_employees` | Read | Finds eligible employees by criteria, for example personnel area, employee group, has or has no active record in an infotype and subtype. | criteria, limit | Employee numbers and the reason each matched. Names masked. |
| `read_infotype` | Read | Reads current records of one employee or organization object. Output is reduced by the masking policy. | object number, infotype, subtype, date range | Records (allowed fields only) |
| `list_scenarios` | Read | Lists saved scenario templates and the parameters each needs. | none | Scenario list |
| `plan_changes` | Read, creates a stored plan | Builds a **dry run** for either a change request or a restore of an earlier run. Nothing is written to Human Resources data. | change request or run number to restore | Plan identifier, item list, warnings, expiry time |
| `execute_plan` | **Write** | Executes a stored plan exactly as planned. | plan identifier | Run number, per-item result, messages |
| `list_runs` | Read | Shows ledger entries: who ran what, when, status. | filters | Run list |

Notes:

- `execute_plan` takes **only a plan identifier**. The model cannot alter the contents between planning and executing.
- Mark `execute_plan` so Copilot **always asks the human for confirmation**. Read tools may run automatically.
- Restore is done through `plan_changes` (restore kind) then `execute_plan`, so it gets the same checks, the same dry run and the same confirmation.
- Organization objects (organizational units, positions, jobs) use the same tools with the kind parameter, rather than separate tools.

### Change request content (high level)

A change request contains a list of items. Each item has: target (employee number or organization object), infotype, subtype, operation (**create**, **change**, **delimit**, **delete**), valid-from and valid-to dates (9999-12-31 means open-ended), field values, and an optional note. A request may instead name a **scenario** with parameters.

### Plan content (high level)

Plan identifier, created time, expiry (default 30 minutes), kind (change or restore), system and client, item list with the **exact before and after values** (reduced by masking when shown to the model), counts, and **warnings**, such as: dates in the past, overlapping records, employee currently locked, outgoing interfaces if any become active (none are active today), extra confirmation required.

---

## 7. What happens inside SAP

For every write (and restore), the wrapper performs these steps in order:

1. **Log in and authorize.** SAP logs the user into client 300. The user's normal authorizations apply.
2. **Safety checks.** System and client are on the environment allow-list and match the expected values; infotype is on the allowed list; employee is eligible; counts are within limits; dates pass the date rules. Any failure stops here with nothing written.
3. **Save the before-image.** Current records are read and stored in the ledger with the run number.
4. **Lock the employee** using SAP standard locking.
5. **Write the record** through the classic API (section 4.4). SAP applies mandatory fields, date overlap rules, time constraints, authorization checks, and any custom enhancements on that infotype. Messages are captured.
6. **Commit, log, unlock.** On success: save, mark ledger entry done, release lock. On any error: roll back, mark failed, release lock, return SAP's own message text.

Side effects to document for developers: SAP's standard change history records who changed what; change pointers may be written (no interfaces are active in the test system, so nothing is expected to be sent out, and the wrapper warns if that changes); changes in past periods may move the employee's earliest payroll recalculation date.

Additional side effects for SAP S/4HANA and Time Management: absence and attendance records interact with quotas (2006, 2007), time evaluation and payroll. **The server does not run time evaluation or payroll**, so any result that depends on them needs a separate run. No interfaces are active in the test system (confirmed), so no replication to other systems is expected.

### Restore

1. `plan_changes` with a run number reads the ledger and builds the reverse operations (delete the new record, reopen the old one with its original end date, and so on) in reverse order.
2. Before executing, the wrapper compares the employee's **current state** with the **after-state** recorded by the run. If someone else changed the data in the meantime, that employee is reported as a **conflict** and skipped, never overwritten silently.
3. Execution follows steps 1 to 6 above.

---

## 8. Safety rules (enforced inside the ABAP wrapper)

| # | Rule |
|---|---|
| 1 | Hard block unless the system name and client number are on the **environment allow-list** (a table filled by hand in the test system only, never transported; **empty means refuse everything**) **and** they equal the configured expected values. SAP offers no classified way to read the client's role, so this allow-list replaces a role check. |
| 2 | The service is **activated only in the test system**. The authorization role for the user is **assigned only in the test client**. The code also refuses to run whenever the allow-list is empty or does not contain this system and client, which is true of every system where nobody has filled it, even if the code is transported by mistake. |
| 3 | **Allowed list of infotypes and subtypes** held in a policy table in SAP. The server supports every infotype technically; **this table decides which are enabled**, so rollout can start small and grow. **Initial enabled set: all Personnel Administration, Time Management and Organizational Management infotypes, plus the basic payroll infotypes** (for example 0008 basic pay, 0009 bank details, 0014 recurring payments, 0015 additional payments, 0267 additional off-cycle payments). Because pay, bank and identification data are the most sensitive, these are enabled for writing but **masked on read** (rule 9). An administrator can disable any infotype at any time without a code change. |
| 4 | **Eligible employees**: any employee in the test client that matches the criteria, except those on an **exclusion list** (empty by default, maintained by an administrator, for employees who must never be touched, such as executives). Employees locked by payroll or another process are skipped with a message. |
| 5 | **Limits per plan**: default maximum 10 employees and 50 records. Larger plans are refused, not truncated. |
| 6 | **Date rules**: past and current dates are both allowed. A plan item that starts in the past carries a visible warning (possible payroll recalculation) and requires the plan to be marked "allow past". A policy value sets **how far back** a plan may go (suggested default: 12 months, to be agreed). SAP itself rejects changes before the employee's earliest allowed master data change date; the server must **show SAP's message and never work around it**. |
| 7 | **Plans expire** (default 30 minutes), are **single use**, and executing the same plan twice returns the earlier result. |
| 8 | **Staleness check**: if an employee's data changed since the plan was made, the plan item is refused ("plan stale"). |
| 9 | **Masking in SAP**: fields marked sensitive in the policy table are never returned to the server, even when the model asks. |
| 10 | **Broad user, narrow policy**: the functional user holds many roles, so SAP's authorization checks alone do not limit it. The allowed list (rule 3), exclusion list (rule 4) and limits (rule 5) in the wrapper are what limit it. Review the user's roles once a year. |
| 11 | **Human confirmation**: Copilot's confirmation prompt on `execute_plan` is the human gate. The server cannot verify that a human clicked, which is why rules 1 to 10 live in SAP. |
| 12 | **No direct table writes, no payroll runs, no deletion of employees.** |

---

## 9. Data privacy

- Because quality and test clients are often copies of production, the employees are **real people**. Treat all returned data as sensitive.
- Whatever a read tool returns is sent to the AI model service. Therefore:
  - default output contains only employee number, infotype, subtype, dates and non-personal fields,
  - names, addresses, pay, bank details and identification numbers are masked by policy,
  - masking is enforced in SAP, so the server cannot return more than SAP allows.
- Test values the server generates (for example email addresses) use obviously fake, safe values, such as the reserved `.invalid` ending, so no real mailbox is ever contacted.
- Your data protection team has **approved** masked employee numbers passing through the Copilot model service. Record the approval reference in the setup guide.
- Basic payroll infotypes (pay, bank details) and identification infotypes are enabled for writing, so their sensitive fields must be masked on read by default (policy table).

---

## 10. Scenario templates

A scenario is a saved, parameterized change request plus expected checks. Starter set (illustrative; refine during discovery):

| Scenario | Goal | Steps |
|---|---|---|
| `future_dated_address_change` | Test programs that read the address valid on a date | Delimit the current permanent address at end of month. Create a new record next month with a different city. Check: two records, no overlap, no gap. |
| `add_work_email` | Test programs that read communication data | Find employees with no work email in infotype 0105. Create a record with a fake address. |
| `open_absence_record` | Test absence-dependent logic | Create an absence (infotype 2001) of given length for an eligible employee. |
| `absence_with_quota` | Test absence quota deduction logic | Check the employee has an absence quota (infotype 2006) for the absence type. Create an absence (2001). Read the quota used. Check the deduction matches. |
| `organizational_reassignment` | Test logic depending on organizational assignment | Delimit and recreate infotype 0001 with a different organizational unit or position. |
| `position_relationship` | Test organization structure reads | Create or delimit a relationship (infotype 1001) between a position and an organizational unit. |

Scenarios are stored in the server (versioned files in the repository). Each lists required parameters, default values, the steps, and the check after execution.

---

## 11. Errors, logging and audit

**Error codes** returned by the wrapper (the server passes them on in plain language):
`CLIENT_NOT_ALLOWED`, `SYSTEM_MISMATCH`, `INFOTYPE_NOT_ALLOWED`, `EMPLOYEE_NOT_ELIGIBLE`, `LIMIT_EXCEEDED`, `DATE_NOT_ALLOWED`, `VALIDATION_FAILED` (with SAP's own messages), `EMPLOYEE_LOCKED`, `PLAN_EXPIRED`, `PLAN_STALE`, `PLAN_ALREADY_EXECUTED`, `RESTORE_CONFLICT`, `AUTHORIZATION_MISSING`, `SERVICE_UNAVAILABLE`.

**Audit:**
- SAP side: ledger tables (header per run, one item per record) with functional user, **self-reported requester name**, time, client, kind, status, before-image, after key, and messages.
- Server side: a local log of tool calls, plan identifiers and outcomes. **No personal data, no secrets.**

---

## 12. Non-functional requirements

- **Timeouts**: default 60 seconds per call. Plans over the limit are refused instead of run in the background.
- **Idempotency**: executing a plan twice does not write twice.
- **Concurrency**: one write per employee at a time, enforced by SAP locking.
- **Compatibility**: do not rely on optional protocol features such as the server asking the user a question mid-call, since client support varies. Verify against the Copilot version in use.
- **Tool count**: keep to about eight to ten tools.
- **Releases**: version the wrapper's web interface (`/v1`) so server and wrapper can evolve separately. The server checks the wrapper version at start-up.

### Wrapper web interface (suggested outline)

| Method and path | Purpose |
|---|---|
| `GET /v1/status` | System, client, role, user, version |
| `GET /v1/infotypes/{number}` | Describe infotype |
| `POST /v1/employees/search` | Find employees |
| `POST /v1/infotypes/read` | Read records (masked) |
| `POST /v1/plans` | Create plan (change or restore) |
| `POST /v1/plans/{id}/execute` | Execute plan |
| `GET /v1/runs` | List ledger entries |

State-changing requests use SAP's standard security token (fetched with a first request) and the session cookie.

---

## 13. Testing strategy

1. **Mock mode** in the server: fake wrapper responses so tools can be built and unit tested without SAP.
2. **Contract tests**: a written description of each wrapper request and response, used to test both sides against the same examples.
3. **ABAP Unit tests** for wrapper classes, using test doubles for database access where possible.
4. **Acceptance tests** in client 300 using **designated test employees**.
5. **Negative tests** (must all fail safely): wrong client, system or client missing from the allow-list, wrong system name, blocked infotype, ineligible employee, plan over limit, past date without flag, overlapping dates, locked employee, expired plan, stale plan, executing twice, restore after another change, missing password.
6. **Restore test**: after every acceptance write test, restore and compare to the before-image. The state must be identical, including records that SAP changed automatically (for example an earlier record that was delimited).

---

## 14. Decisions and remaining checks

### Answered

| # | Question | Answer |
|---|---|---|
| 1 | SAP release and Human Resources mode | SAP S/4HANA 2023 (to be confirmed; earlier stated as 2021 feature pack stack 03), with Human Capital Management for S/4HANA. |
| 2 | Can developer computers reach the test system over secure web requests? | Yes. ABAP development tools already reach development and test. A custom web service is allowed. Web logon to client 300 is possible. |
| 3 | User model | One functional user holding all required roles in client 300, used only by this server (see section 5). |
| 4 | Server language | TypeScript on Node.js. |
| 5 | Eligible employees | Any matching employee, with an optional exclusion list. |
| 6 | Infotypes to enable first | All Personnel Administration, Time Management, Organizational Management, plus basic payroll infotypes. Sensitive fields masked on read. |
| 7 | Dates in the past | Needed. Allowed with warnings and a policy limit on how far back. |
| 8 | ABAP delivery | ABAP development tools with normal transports. |
| 9 | Data protection approval | Approved for masked employee numbers through the Copilot model service. |
| 10 | Interfaces active in the test system | None (confirmed). |

### Still to verify in Phase 0

| # | Item | Why it matters |
|---|---|---|
| A | In ABAP development tools, open each class in section 4.4 and confirm which methods create, change, delimit and delete records for (1) employee infotypes, (2) Time Management infotypes including 2006, (3) custom Z infotypes, (4) organization infotypes and relationships. Also confirm: whether creating a record automatically delimits the previous one, and whether a rollback really undoes the writes. | The coverage of the classes decides whether any operation has a gap. Never assume method names. |
| B | How far back past dates may go (policy value). Suggested default: 12 months. | Controls payroll recalculation exposure. |
| C | Behavior of payroll-related infotypes and the earliest master data change date. Confirm SAP rejects changes before it and returns a clear message. | The server must surface this message and never bypass it. |
| D | Exclusion list: any employees that must never be changed (for example executives)? Default empty. | Optional extra protection since any employee is eligible. |
| E | Password handling for the shared functional user: who holds it, where it is stored, how it is rotated. | One shared password is a weak point. |
| F | **Gap decision.** For any operation that has no classic API, choose (a) leave that operation out, or (b) approve a documented exception that uses an unlisted function module inside one isolated class. | Must be decided by you, never by Claude Code alone. |
| G | Confirm the SAP release on the system status screen (stated as 2023; earlier notes said 2021 feature pack stack 03) and use SAP's list file for that release. | The API lists are release specific. |
| H | Confirm that `find_employees` works with classic APIs only (for example `BAPI_EMPLOYEE_GETLIST` plus reads) and set the scan cap. | No classified search by criteria exists. |
| I | Decide how dry runs work: a check method if the classes offer one, otherwise the real write followed by a rollback that leaves no trace. | A dry run must never save anything. |
| J | Activate the clean core check in the test system for the wrapper package, with SAP's list file for the release (section 4.5). | Compliance gate. |

---

## 15. Phases and acceptance criteria

**Phase 0: Discovery (in the SAP system, before coding)**
- Work through the checks in section 14 ("Still to verify"). All earlier decisions are closed.
- Verify the classes and API states in sections 4.4 and 4.5 (items A and F to J in section 14). Do not assume method names.
- Choose test employees and the initial allowed list.
- Acceptance: written answers and a confirmed list of classes and methods with their API states.

**Phase 1: Read-only**
- Server skeleton, mock mode, settings example.
- Wrapper: status, describe infotype, find employees, read infotype (with masking).
- Acceptance: from Copilot, describe infotype 0006 (and one custom infotype), find three eligible employees, read their records with masking. Wrong client or system refuses to start writes. All negative tests that apply to read tools pass. Clean core check: zero findings.

**Phase 2: Single-record writes with ledger and restore**
- Plan and execute for create, change and delimit on three infotypes, including **one Time Management infotype** (for example 2001 absences). Ledger tables. Locking. Restore.
- Acceptance: each operation works on test employees. Failures roll back. Restore gives identical state. All safety rules 1 to 12 verified by negative tests. Clean core check: zero findings.

**Phase 3: Organization objects, scenarios, run history**
- Organizational Management infotypes and relationships, scenario templates, `list_runs`.
- Acceptance: all starter scenarios in section 10 run end to end and restore. Clean core check: zero findings.

**Phase 4: Hardening and rollout**
- Past-date confirmation text, limits, documentation, shared settings file, security and data protection review, short training for developers.
- Acceptance: review sign-off. Two developers use it independently from the setup guide alone.

**Phase 5 (later)**
- Other module packs (finance, materials, sales), generation of ABAP Unit tests from code using the same scenarios, export of scenario data as fixtures for tests that use test doubles.

---

## 16. Instructions for Claude Code (how to build this)

**Order of work**
1. Read this whole document. All decisions are closed. Ask only about anything unclear that blocks the current phase before coding it.
2. Build Phase 1 in this order: repository structure, server skeleton with mock mode, tool definitions with plain-language descriptions, configuration checks, then the web client. Only then write the ABAP wrapper.
3. Do **not** implement any write path until all read tools and the safety checks work and have passing negative tests.

**Rules**
- Use only SAP objects that SAP's published lists mark as released or classic API (sections 4.4 and 4.5). Verify names and method signatures in the actual system. Never use an object that is unlisted, deprecated or marked "noAPI", and never select directly from SAP tables. If an operation cannot be done with listed APIs, stop and report it. Do not work around it.
- Build the API-state checker (section 4.5) **before** the first ABAP class.
- Policy, masking and the production block go in the ABAP wrapper, never only in the server.
- Never log or print passwords, cookies or tokens.
- `execute_plan` accepts only a plan identifier.
- Keep tool descriptions short and in plain language, because a different AI model than yours will read them.
- Write tests with each feature, including the negative tests in section 13.
- Keep functions small and name them after what they do. Prefer clear code over clever code.

**Suggested repository layout**

```
sap-test-data-server/
  src/
    index.ts            start-up, configuration checks
    config.ts           environment variables, required values
    sapClient.ts        secure web client, logon, security token
    tools/              one file per tool
    scenarios/          scenario template files
    mock/               fake wrapper responses
    logging.ts          log without personal data or secrets
  abap/                 copies of wrapper source, table definitions, setup notes (the SAP system is the source of truth; the ABAP is built with ABAP development tools and moved with normal transports; refresh these copies at each release)
  tests/
    unit/  contract/  mock/
  docs/
    specification.md    this document
    setup-guide.md      developers
    admin-guide.md      SAP administrators
  .vscode/
    mcp.example.json
```

**Definition of done for each phase:** the acceptance criteria in section 15 pass, negative tests pass, and the setup guide is updated.

---

## 17. Glossary

| Term | Plain meaning |
|---|---|
| Model Context Protocol server | A small program that gives an AI assistant a set of tools it can call. |
| Infotype | An SAP record type that holds one kind of Human Resources data (for example addresses). |
| Subtype | A variant within an infotype (for example permanent versus temporary address). |
| Personnel Administration | The part of SAP Human Resources that holds employee records. |
| Organizational Management | The part that holds organizational units, positions, jobs and their relationships. |
| Time constraint | A rule on how records of an infotype may follow each other in time (for example, no overlap). |
| Delimit | End an existing record at a date instead of deleting it. |
| Client | A separate business data area inside one SAP system. Client 300 is your test client. |
| Before-image | A saved copy of a record as it was before a change, used for restore. |
| Ledger | The SAP table that stores plans, runs, before-images and results. |
| Dry run | A preview of what would change, with nothing written. |
| Internet Communication Framework | SAP's way of exposing ABAP code as a secure web service. |
| Function module | A reusable ABAP routine, shipped by SAP or written by you, that other code can call by name. |
| Classic API | An SAP interface that SAP lists as usable by custom code when no released (stable) API exists. Not as stable as a released API, but accepted by SAP's clean core approach. |
| Clean core | Keeping custom code on SAP's published, upgrade-safe interfaces so SAP upgrades do not break it. |
| Change pointer | A marker SAP writes when data changes so interfaces can pick it up. |
| Wrapper | The custom ABAP code that sits between the server and SAP's standard functions. |
