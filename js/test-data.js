/* Test data (SAP HR) for a Technical spec: the rows of quality.testData, the starter scenarios of the sap-test-data
   MCP server (sap-test-data-server/src/scenarios – keep in step), and the prompt that hands them to Copilot Chat in
   agent mode. The server is read-only in Phase 1; the prompt asks for dry runs only and never for execute_plan
   without the developer's confirmation. */
(function (APB) {
  'use strict';

  /* starter rows, one per scenario of the server (scenario id → rows of the grid) */
  const SCENARIOS = [
    { id: 'future_dated_address_change', label: 'Future-dated address change', rows: [
      { scenario: 'Address valid on a date', employees: 'Eligible employee with a permanent address', infotype: '0006', subtype: '1', operation: 'delimit', validFrom: '', validTo: '', values: 'End current address the day before the change', check: '' },
      { scenario: 'Address valid on a date', employees: 'Same employee', infotype: '0006', subtype: '1', operation: 'create', validFrom: '', validTo: '9999-12-31', values: 'ORT01 = Testcity B', check: 'Two records, no overlap, no gap' }] },
    { id: 'add_work_email', label: 'Add a work e-mail', rows: [
      { scenario: 'Communication data', employees: 'Employees without a work e-mail (0105/0010)', infotype: '0105', subtype: '0010', operation: 'create', validFrom: '', validTo: '9999-12-31', values: 'USRID_LONG = test.<pernr>@example.invalid', check: 'One active 0105/0010 record' }] },
    { id: 'open_absence_record', label: 'Open absence record', rows: [
      { scenario: 'Absence-dependent logic', employees: 'Eligible employee', infotype: '2001', subtype: '0100', operation: 'create', validFrom: '', validTo: '', values: 'AWART = 0100, 3 days', check: 'One absence in the period, no collision' }] },
    { id: 'absence_with_quota', label: 'Absence with quota deduction', rows: [
      { scenario: 'Quota deduction', employees: 'Employee with an absence quota (2006)', infotype: '2006', subtype: '01', operation: 'read', validFrom: '', validTo: '', values: '', check: 'Note the deduction before' },
      { scenario: 'Quota deduction', employees: 'Same employee', infotype: '2001', subtype: '0100', operation: 'create', validFrom: '', validTo: '', values: 'AWART = 0100, 2 days', check: 'Quota deduction increased by 2 days' }] },
    { id: 'organizational_reassignment', label: 'Organizational reassignment', rows: [
      { scenario: 'Organizational assignment', employees: 'Eligible employee', infotype: '0001', subtype: '', operation: 'create', validFrom: '', validTo: '9999-12-31', values: 'ORGEH = <new org unit>, PLANS = <new position>', check: 'Previous 0001 ends the day before' }] },
    { id: 'position_relationship', label: 'Position relationship', rows: [
      { scenario: 'Organization structure', employees: 'Position S <id> → org unit O <id>', infotype: '1001', subtype: 'A003', operation: 'create', validFrom: '', validTo: '9999-12-31', values: 'SCLAS = O, SOBID = <org unit>', check: 'Relationship A003 exists, inverse B003 by SAP' }] }
  ];

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function rowsOf(s) {
    return ((s && s.quality && s.quality.testData) || []).filter(function (r) { return r && (str(r.infotype) || str(r.scenario) || str(r.employees)); });
  }
  function scenarioRows(id) {
    const sc = SCENARIOS.filter(function (x) { return x.id === id; })[0];
    return sc ? sc.rows.map(function (r) { return Object.assign({}, r); }) : [];
  }

  /* The prompt for Copilot Chat (agent mode) with the sap-test-data MCP tools. */
  function prompt(s) {
    const rows = rowsOf(s);
    const name = (s.project && s.project.name || '').trim() || (s.requirement && s.requirement.text || '').trim().split(/\r?\n/)[0].slice(0, 80);
    const line = function (r, i) {
      return (i + 1) + '. ' + [str(r.scenario), str(r.employees) && 'employees: ' + str(r.employees), str(r.infotype) && 'infotype ' + str(r.infotype) + (str(r.subtype) ? '/' + str(r.subtype) : ''),
        str(r.operation) && 'operation ' + str(r.operation), (str(r.validFrom) || str(r.validTo)) && 'valid ' + (str(r.validFrom) || '?') + ' – ' + (str(r.validTo) || '?'),
        str(r.values) && 'values: ' + str(r.values), str(r.check) && 'check: ' + str(r.check)].filter(Boolean).join(' · ');
    };
    return [
      'Prepare SAP HR test data for the technical specification "' + name + '" with the sap-test-data MCP server (SAP test client only).',
      '',
      'Rules:',
      '- Start with get_connection_status. If writes are refused or the system is not the expected test system, stop and tell me.',
      '- Use describe_infotype to check fields, subtypes and the policy of each infotype; find_employees to pick eligible test employees (names are never returned); read_infotype to see their current records (sensitive fields come back as ***).',
      '- For changes use plan_changes only (a dry run) and show me the plan with its warnings. NEVER call execute_plan unless I explicitly confirm that exact plan in this chat.',
      '- Use list_scenarios when a row matches a saved scenario. Use obviously fake values (e-mail ending .invalid).',
      '- If a tool says NOT_AVAILABLE_PHASE1, the server is still read-only: give me the employees you would use and the exact plan items instead.',
      '- Do not read or show personal data beyond what the tools return.',
      '',
      'Test data needed:',
      rows.length ? rows.map(line).join('\n') : '(no rows yet – suggest test data from the test scenarios and acceptance criteria of the spec)',
      '',
      'Finish with a table: row, employee(s), infotype/subtype, operation, dates, status (ready / planned / needs decision).'
    ].join('\n');
  }

  APB.testData = { SCENARIOS: SCENARIOS, rows: rowsOf, scenarioRows: scenarioRows, prompt: prompt };
})(window.APB = window.APB || {});
