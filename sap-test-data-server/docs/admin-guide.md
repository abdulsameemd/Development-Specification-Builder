# SAP test data server – guide for SAP administrators

The MCP server on the developer's computer talks only to a small ABAP wrapper service in the **test system**. All
policy lives in that wrapper (specification §3, §8): even a modified server cannot bypass it.

## 1. Before activation: Phase 0

Work through `abap/PHASE0-CHECKLIST.md` (release, classic API methods, gap decisions). Nothing marked `TODO-PHASE0`
in the ABAP copies may be activated before its item is confirmed.

## 2. Transport and service

1. Package `ZHR_TESTDATA`, objects as listed in `abap/README.md`, built in ADT, transported development → test.
2. SICF: create `/sap/bc/zhr_testdata` with handler `ZCL_HR_TD_HTTP_HANDLER` **in the test system only**; do not
   activate it anywhere else.
3. ATC: clean core checks ("Usage of APIs", Cloudification Repository) for the package with SAP's list file for the
   release; zero findings at the end of every phase (SAP notes 3284711, 3377462, 3507814, 3565942).

## 3. User and role

One functional user, used **only** by the server (never for manual logons), with the required HR roles assigned
**only in client 300**. Its authorizations are broad, so the policy tables are the effective control. Review the
roles once a year.

## 4. Policy tables (SM30, test system)

| Table | What to maintain |
|---|---|
| `ZHR_TD_ALLOW` | One row: test system ID + client 300. **Never transport its content.** Empty = everything refused. |
| `ZHR_TD_POLICY` | Enabled infotypes / subtypes (initially all PA, Time Management, OM + basic payroll 0008, 0009, 0014, 0015, 0267). |
| `ZHR_TD_MASK` | Fields never returned (names, addresses, pay, bank, IDs, e-mail). |
| `ZHR_TD_EXCL` | Employees that must never be touched (default empty). |
| `ZHR_TD_LIMIT` | `MAX_EMPLOYEES` 10, `MAX_RECORDS` 50, `SCAN_CAP`, `PAST_MONTHS` 12, `PLAN_MINUTES` 30. |

Switching an infotype off is a table change – no code change, effective immediately.
