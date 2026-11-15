# Phase 0 – checks in the SAP test system before activation (specification §14)

Answer each item in ADT / the test system and record the result here. Nothing marked `TODO-PHASE0` in the ABAP
copies may be activated before its item is confirmed. **Never guess method names.**

Already checked from SAP's published lists (github.com/SAP/abap-atc-cr-cv-s4hc, `objectReleaseInfo_PCE2023_3.json`
+ `objectClassifications_SAP.json`): every class / function module of spec §4.4 is `classicAPI` or `released`;
`HR_INFOTYPE_OPERATION` is unlisted and `BAPI_ABSENCE_CREATE` is `noAPI` (as the spec says). The ABAP copies here
pass `npm run check-api-state` with **zero findings**.

| # | Item | Where it matters in the code | Answer |
|---|---|---|---|
| G | SAP release on the system status screen (spec says S/4HANA 2023; earlier notes 2021 FPS03). Use the matching list file (`--release-file`). | `scripts/check-api-state.ts` default `objectReleaseInfo_PCE2023_3.json` | |
| A1 | `CL_HRPA_READ_INFOTYPE=>GET_INSTANCE` and `IF_HRPA_READ_INFOTYPE~READ`: exact parameters (tclas, infty, begda, endda, no_auth_check, infotype_tab, data_exists). | `ZCL_HR_TD_PA_READ->READ_RECORDS` | |
| A2 | `CL_HR_PNNNN_TYPE_CAST=>PRELP_TO_PNNNN` parameter names. | `ZCL_HR_TD_PA_READ->READ_RECORDS` | |
| A3 | Which classic class / method gives **mandatory fields, subtypes and the time constraint** of an infotype (not T582A / T591A). | `ZCL_HR_TD_PA_READ->DESCRIBE_FIELDS` | |
| A4 | `CL_HRPA_MASTERDATA_BL` (via `CL_HRPA_MASTERDATA_FACTORY`): methods to create, change, delimit, delete – for PA, Time Management (incl. 2006) and custom Z infotypes; does create delimit the previous record automatically; does rollback undo the writes. | Phase 2 | |
| A5 | `CL_HRBAS_PD_OBJECT` / `CL_HRBAS_PD_OBJECT_ADMIN`: read and maintain OM records and relationships (1001), delimit a relationship. | `ZCL_HR_TD_OM_READ` (uses RH_READ_INFTY now), Phase 2 | |
| A6 | `RH_READ_INFTY` parameter names (PLVAR, OTYPE, OBJID, INFTY, SUBTY, BEGDA, ENDDA, INNNN) and exceptions. | `ZCL_HR_TD_OM_READ->READ_RECORDS` | |
| B | How far back past dates may go (suggested 12 months) → `ZHR_TD_LIMIT-PAST_MONTHS`. | Phase 2 | |
| C | Payroll infotypes and the earliest master data change date: SAP rejects older changes with a clear message. | Phase 2 | |
| D | Exclusion list entries (default empty) → `ZHR_TD_EXCL`. | `ZCL_HR_TD_SAFETY` | |
| E | Password of the functional user: owner, secrets store, rotation when a developer leaves. | `docs/setup-guide.md` | |
| F | **Gap decision** for any operation without a classic API: leave out, or documented exception in one isolated class (`docs/clean-core-exceptions.md`). Decided by the owner, never by the developer alone. | Phase 2 | |
| H | `find_employees` with classic APIs only: `BAPI_EMPLOYEE_GETLIST` parameters for a broad search, then 0001 reads; set `SCAN_CAP`. | `ZCL_HR_TD_PA_READ->LIST_EMPLOYEES`, `/employees/search` | |
| I | Dry runs: a check method of the classes, otherwise write + rollback that leaves no trace. | Phase 2 | |
| J | ATC clean core checks ("Usage of APIs", Cloudification Repository) active for package `ZHR_TESTDATA` with SAP's list file; SAP notes 3284711, 3377462, 3507814, 3565942 applied by Basis. | Test system | |
