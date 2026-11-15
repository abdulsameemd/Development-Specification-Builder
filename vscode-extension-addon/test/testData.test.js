'use strict';
// Test data (SAP HR) in the Technical spec (js/test-data.js) and its link to the sap-test-data MCP server.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const window = {};
const ctx = vm.createContext({ window, console, Date, JSON, Math });
['config-bundle', 'host', 'governance', 'flow-diagram', 'test-data', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator']
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
const APB = window.APB;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the builder offers exactly the scenarios of the sap-test-data server', () => {
  const server = fs.readdirSync(path.join(ROOT, 'sap-test-data-server/src/scenarios')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepStrictEqual(plain(APB.testData.SCENARIOS.map((s) => s.id)).sort(), server);
  for (const s of APB.testData.SCENARIOS) assert.ok(s.rows.length && s.rows.every((r) => /^\d{4}$/.test(r.infotype)), s.id);
});

test('state keeps the rows (sanitised); the document has the table and the Copilot instruction', () => {
  const s = APB.state.migrate({ requirement: { text: 'Absence report' }, quality: { testData: [{ scenario: 'Leave', employees: 'pers. area 1000', infotype: '2001', subtype: '0100', operation: 'create', validFrom: '2026-12-01', validTo: '2026-12-03', values: 'AWART = 0100', check: '1 record', junk: 'x' }, null, 'bad'] } });
  assert.deepStrictEqual(plain(Object.keys(s.quality.testData[0])), ['scenario', 'employees', 'infotype', 'subtype', 'operation', 'validFrom', 'validTo', 'values', 'check']);
  assert.strictEqual(s.quality.testData.length, 1);
  const md = APB.markdown.build(s);
  assert.match(md, /Test data \(SAP HR\)/);
  assert.match(md, /\| Leave \| pers\. area 1000 \| 2001 \| 0100 \| Create \| 2026-12-01 \| 2026-12-03 \| AWART = 0100 \| 1 record \|/);
  assert.match(md, /Test data: prepare the rows of "Test data \(SAP HR\)" .* sap-test-data MCP tools .* Never call execute_plan without the developer's explicit confirmation/);
  assert.doesNotMatch(APB.markdown.build(APB.state.migrate({ requirement: { text: 'x' } })), /sap-test-data/, 'no instruction without rows');
});

test('the Copilot prompt: connection first, dry runs only, no execute without confirmation, the rows listed', () => {
  const s = APB.state.migrate({ project: { name: 'HR absence report' }, requirement: { text: 'x' }, quality: { testData: APB.testData.scenarioRows('absence_with_quota') } });
  const p = APB.testData.prompt(s);
  assert.match(p, /^Prepare SAP HR test data for the technical specification "HR absence report" with the sap-test-data MCP server/);
  assert.match(p, /Start with get_connection_status/);
  assert.match(p, /plan_changes only \(a dry run\)/);
  assert.match(p, /NEVER call execute_plan unless I explicitly confirm/);
  assert.match(p, /NOT_AVAILABLE_PHASE1/);
  assert.match(p, /1\. Quota deduction · employees: Employee with an absence quota \(2006\) · infotype 2006\/01 · operation read/);
  assert.match(p, /2\. Quota deduction · .*infotype 2001\/0100 · operation create/);
});
