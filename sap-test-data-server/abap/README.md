# ABAP wrapper – source copies (Phase 1: read part)

The SAP test system is the source of truth: the wrapper is built with ABAP development tools in package
`ZHR_TESTDATA` and moved with normal transports (development → test). These files are **copies** for review, the
clean core check (`npm run check-api-state`) and the contract with the server; refresh them at each release.

| Object | Purpose |
|---|---|
| `ZCL_HR_TD_HTTP_HANDLER` | ICF handler, web interface `/v1` (status, infotypes, search, read, runs) |
| `ZCL_HR_TD_SAFETY` | Rules 1, 3, 4, 5, 9: allow-list, enabled infotypes, exclusion list, limits, masking |
| `ZCL_HR_TD_PA_READ` | Personnel Administration / Time Management reads through classic APIs |
| `ZCL_HR_TD_OM_READ` | Organizational Management reads through classic APIs |
| `ZCX_HR_TD` | Error with the codes of specification §11 |
| `ZIF_HR_TD_TYPES` | JSON shapes of `/v1` |
| Tables (below) | Allow-list, policy, masking, exclusion list, limits |

**Not here yet (Phase 2, after Phase 0):** plan / execute / restore, ledger tables, locking, any write.
Every SAP method or parameter that was not verified in the system is marked `TODO-PHASE0` – see
[PHASE0-CHECKLIST.md](PHASE0-CHECKLIST.md). Do not activate before those are confirmed.

## Tables (customer namespace, delivery class C, maintained with SM30 in the test system)

| Table | Key fields | Other fields | Notes |
|---|---|---|---|
| `ZHR_TD_ALLOW` | `SYSID` (CHAR 8), `MANDT_ALLOWED` (CLNT 3) | `NOTE` (CHAR 60) | **Environment allow-list.** Filled by hand in the test system only, **never transported** (exclude from transport / no table content in TR). Empty = every request refused (rule 1). |
| `ZHR_TD_POLICY` | `KIND` (CHAR 1: P employee, O organization), `INFTY` (CHAR 4), `SUBTY` (CHAR 4, space = whole infotype) | `ENABLED` (BOOLE), `WRITABLE` (BOOLE) | Which infotypes / subtypes are enabled (rule 3). Initial set: all PA, Time Management, OM infotypes + basic payroll (0008, 0009, 0014, 0015, 0267). |
| `ZHR_TD_MASK` | `KIND`, `INFTY`, `FIELDNAME` (CHAR 30) | – | Fields never returned (rule 9), e.g. 0002 NACHN VORNA GBDAT; 0006 STRAS PSTLZ; 0008 BETRG01…; 0009 BANKL BANKN IBAN; 0105 USRID_LONG. |
| `ZHR_TD_EXCL` | `PERNR` (NUMC 8) | `REASON` (CHAR 60) | Exclusion list (rule 4), empty by default. |
| `ZHR_TD_LIMIT` | `LIMIT_KEY` (CHAR 20) | `VALUE` (INT4) | `MAX_EMPLOYEES` 10, `MAX_RECORDS` 50, `SCAN_CAP`, `PAST_MONTHS` 12, `PLAN_MINUTES` 30. |

## ICF service

`/sap/bc/zhr_testdata` with handler `ZCL_HR_TD_HTTP_HANDLER`, **activated in the test system only** (SICF). Logon
with the functional user; role assigned only in client 300. The server calls `/sap/bc/zhr_testdata/v1/…`
(override with `SAP_SERVICE_PATH`).
