// End to end over MCP (stdio): the built server in mock mode, called by the official MCP client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

test('mock server over stdio: 8 tools, read tools answer, writes not available, nothing personal in the log', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'td-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: { ...process.env, SAP_TESTDATA_MOCK: '1', SAP_TESTDATA_LOG: join(logDir, 'log.jsonl') } as Record<string, string>, stderr: 'pipe' });
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name), ['get_connection_status', 'describe_infotype', 'find_employees', 'read_infotype', 'list_scenarios', 'plan_changes', 'execute_plan', 'list_runs']);
    const exec = tools.find((t) => t.name === 'execute_plan')!;
    assert.equal(exec.annotations?.readOnlyHint, false);
    assert.equal(exec.annotations?.destructiveHint, true, 'Copilot asks for confirmation');
    assert.deepEqual(Object.keys((exec.inputSchema as { properties: object }).properties), ['planId'], 'execute_plan takes only a plan id');

    assert.match(text(await client.callTool({ name: 'get_connection_status', arguments: {} })), /Connected to T01 client 300 .*MOCK MODE/);
    assert.match(text(await client.callTool({ name: 'describe_infotype', arguments: { infotype: '0006' } })), /Infotype 0006 Addresses .* masked on read: STRAS, PSTLZ/);
    assert.match(text(await client.callTool({ name: 'describe_infotype', arguments: { infotype: '9001' } })), /Custom: DEWA allowance/);
    const found = text(await client.callTool({ name: 'find_employees', arguments: { personnelArea: '1000', hasRecord: { infotype: '0105', subtype: '0010', present: false }, limit: 3 } }));
    assert.match(found, /^2 eligible employees found: 09000002, 09000003/);
    assert.doesNotMatch(found, /Testperson|Mock/, 'no names');
    const read = text(await client.callTool({ name: 'read_infotype', arguments: { objectId: '9000003', infotype: '0009' } }));
    assert.match(read, /"BANKN": "\*\*\*"/);
    assert.doesNotMatch(read, /000123456789|AE0703/);
    assert.match(text(await client.callTool({ name: 'list_scenarios', arguments: {} })), /^6 scenarios: absence_with_quota, add_work_email/);
    const plan = await client.callTool({ name: 'plan_changes', arguments: { items: [{ target: '9000001', infotype: '0105', subtype: '0010', operation: 'create', validFrom: '2026-12-01' }] } });
    assert.equal(plan.isError, true);
    assert.match(text(plan), /^NOT_AVAILABLE_PHASE1/);
    assert.match(text(await client.callTool({ name: 'execute_plan', arguments: { planId: 'P1' } })), /^NOT_AVAILABLE_PHASE1/);
    const bad = await client.callTool({ name: 'read_infotype', arguments: { objectId: '9000001', infotype: '6' } });
    assert.equal(bad.isError, true, 'invalid input refused by the schema');
  } finally {
    await client.close();
  }
  const log = readFileSync(join(logDir, 'log.jsonl'), 'utf8');
  assert.match(log, /"tool":"read_infotype","outcome":"ok"/);
  assert.doesNotMatch(log, /Testperson|BANKN|000123456789|example\.invalid|password/i, 'no values or personal data in the log');
});

test('the server refuses to start without the required configuration', async () => {
  const { spawnSync } = await import('node:child_process');
  const env = { ...process.env, SAP_TESTDATA_MOCK: '', SAP_HOST: 'https://t01.example.invalid:44300', SAP_CLIENT: '300', SAP_EXPECTED_SYSTEM: 'T01', SAP_USER: 'ZHR_TESTDATA_FU', SAP_PASSWORD: '' };
  const r = spawnSync(process.execPath, ['dist/index.js'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not started: The test data server is not configured completely\. Missing: SAP_PASSWORD/);
});
