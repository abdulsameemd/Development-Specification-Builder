---
name: rap-build
description: Build a SAP RAP business object (managed or unmanaged, optional draft) from BUSINESS_REQUIREMENTS.md in activation groups, with a correct behavior pool, draft table and ETag setup, and an error-loop limit. Use with dewa-abap whenever the task creates or changes RAP objects.
---

## RAP build mode (managed / unmanaged business objects)

**Source of truth.** If `BUSINESS_REQUIREMENTS.md` contains a *RAP Implementation Blueprint*:
- use its artifact names, behavior definition statements and handler method signatures exactly;
- implement only method bodies and the items marked `[TO BE CONFIRMED]`;
- do not redesign the BO;
- if a *Readiness finding* is marked **Fix before build**, ask the developer to fix it in the builder (or confirm your fix) before you create anything.

**Work unit = activation group, not single object.**

| Group | Objects | Activate |
|---|---|---|
| 1 · Dictionary | persistent table(s), draft table(s) | together |
| 2 · Data model | root / child view entities, projection views, access controls, metadata extensions | together |
| 3 · Behavior | interface BDEF, projection BDEF, behavior pool (with ABAP Unit test class) | together |
| 4 · Service | service definition, service binding (then publish) | together |

For each group:
1. Create every object of the group.
2. Run the syntax check for each object.
3. **Activate the whole group in one activation call** through the ADT MCP server.
4. Run the ABAP Unit tests (group 3) and ATC where available.
5. Present one result for the group, then wait for `CONFIRM ARTEFACT`.

Do **not** ask the developer to activate objects; activation is part of your work. Ask only at the end of a group.

**Behavior pool.**
- Create the global class as `CLASS zbp_… DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF <root entity>.` with an empty implementation.
- Put one local handler class per entity in the **local types** include (`lhc_<alias> INHERITING FROM cl_abap_behavior_handler`), with the method signatures from the blueprint. Add a saver class only for unmanaged or additional save.
- Never create the behavior pool as a normal class, and never put handler methods in the global class.
- Create the behavior pool in the same group as the BDEF, after the BDEF source exists. The two are activated together.

**Draft.**
- Use draft only when the blueprint or specification says `with draft`.
- Generate the draft table from the BDEF (ADT quick fix on `draft table`), or define it with one field per **CDS element name** plus `"%admin" : include sych_bdl_draft_admin_inc;`. Never copy the persistent table's field names.
- A draft root needs `lock master total etag <LastChangedAt>` and the draft actions `Edit`, `Activate optimized`, `Discard`, `Resume` and `draft determine action Prepare`.

**ETag and admin fields.**
- Every field used in `etag master` / `total etag` must be an element of the CDS view entity and a field of the table: LocalLastChangedAt with data element ABP_LOCINST_LASTCHANGE_TSTMPL, and LastChangedAt with ABP_LASTCHANGE_TSTMPL.
- Admin fields get the `@Semantics.user.*` / `@Semantics.systemDateTime.*` annotations and are `field ( readonly )` in the BDEF.

**Error loop limit.**
1. On activation errors, collect the **complete** error list of the whole group first.
2. Analyse dependencies. Typical causes:
   - a missing CDS element;
   - a field name mismatch between the mapping and the table;
   - a missing handler method;
   - an inactive dependency.
3. Fix all errors in one pass.
4. After **3** unsuccessful rounds, stop. Report the remaining errors with your analysis and the proposed fix, and ask how to proceed. Do not keep retrying.

**Service.** Publish the service binding only after group 3 is active without errors. If the MCP server cannot publish, say so and give the developer the one manual step (*Publish* in the binding editor).
