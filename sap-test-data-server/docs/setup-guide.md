# SAP test data server – setup guide for developers

**Phase 1 (this version): read-only.** You can check the connection, describe infotypes, find eligible test employees,
read their records (sensitive fields masked) and list scenarios. Planning and executing changes come in Phase 2.

## 1. Build once

```bash
cd sap-test-data-server
npm ci
npm run build
```

Node.js 20 or later. The build writes `dist/`.

## 2. Add the server to VS Code

Copy `.vscode/mcp.example.json` into your workspace's `.vscode/mcp.json` (or your user MCP settings) and fill in:

| Setting | Value |
|---|---|
| `SAP_HOST` | `https://<test system host>:<port>` – encrypted connections only |
| `SAP_CLIENT` | `300` |
| `SAP_EXPECTED_SYSTEM` | the test system ID – the server refuses writes when another system answers |
| `SAP_USER` | the functional user of the test data service (never your personal user) |
| `SAP_PASSWORD` | leave `${input:sap-password}` – VS Code asks at start-up; it is never stored |

All four values and the password are **required**; there are no defaults and the server does not start without them.
Optional: `SAP_TIMEOUT_MS` (default 60000), `SAP_SERVICE_PATH` (default `/sap/bc/zhr_testdata/v1`),
`SAP_TESTDATA_LOG` (default `~/.sap-test-data/log.jsonl`).

The password of the shared functional user is kept in the team's approved secrets store and rotated when a developer
leaves (Phase 0 item E). Data protection approval for masked employee numbers through Copilot: reference ______.

## 3. Use it in Copilot Chat (agent mode)

Start the server from *MCP: List Servers* (or let VS Code start it), then ask, for example:

- "Check the SAP test data connection." → `get_connection_status`
- "Describe infotype 2001." → `describe_infotype`
- "Find 3 employees in personnel area 1000 without a work e-mail." → `find_employees`
- "Read the addresses of employee 9000001." → `read_infotype` (street and postal code come back as `***`)
- "Which test data scenarios exist?" → `list_scenarios`

Copilot may run read tools without asking. `execute_plan` (Phase 2) always needs your confirmation.

## 4. Mock mode (no SAP)

The `sap-test-data-mock` entry (or `SAP_TESTDATA_MOCK=1`) answers with fake data – employees `0900000x`, infotypes
0001, 0002, 0006, 0008, 0009, 0105, 2001, 2006, a custom 9001, OM 1000 / 1001 – and the same safety rules and masking
as the ABAP wrapper. Use it to try the tools and for tests.

## 5. What you will see when something is wrong

| Message | Meaning |
|---|---|
| `Not started: … Missing: SAP_PASSWORD` | A required setting is empty. |
| `Writes are refused: Connected to system X, expected T01` | Another system answered; nothing will be written. |
| `CLIENT_NOT_ALLOWED` | The system / client is not on the allow-list in SAP – every request is refused. |
| `INFOTYPE_NOT_ALLOWED`, `EMPLOYEE_NOT_ELIGIBLE` | The policy in SAP does not allow this infotype / employee. |
| `NOT_AVAILABLE_PHASE1` | Planning / executing changes is not built yet. |

## 6. Tests

`npm test` (unit, contract, mock, negative, MCP over stdio) · `npm run check-api-state -- --download` (clean core gate on
`abap/`, downloads SAP's list files from github.com/SAP/abap-atc-cr-cv-s4hc).
