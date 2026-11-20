# SAP test data server

Model Context Protocol server that lets GitHub Copilot (agent mode, VS Code) work with **HR test data in the SAP test
client 300** – through a small ABAP wrapper service that holds all safety policy. Full design:
[docs/specification.md](docs/specification.md).

**Status: Phase 1 – read-only, mock mode.** Tools: `get_connection_status`, `describe_infotype`, `find_employees`,
`read_infotype`, `list_scenarios`, `list_runs`; `plan_changes` and `execute_plan` are declared and answer
`NOT_AVAILABLE_PHASE1` until Phase 0 (in SAP) and Phase 2 are done.

- Developers: [docs/setup-guide.md](docs/setup-guide.md)
- SAP administrators: [docs/admin-guide.md](docs/admin-guide.md), [abap/README.md](abap/README.md), [abap/PHASE0-CHECKLIST.md](abap/PHASE0-CHECKLIST.md)
- Clean core: `npm run check-api-state -- --download` (zero findings), exceptions in [docs/clean-core-exceptions.md](docs/clean-core-exceptions.md)

```bash
npm ci && npm run build && npm test      # unit, contract, mock, negative, MCP over stdio
SAP_TESTDATA_MOCK=1 npm start            # the server with fake data
```
