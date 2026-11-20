// Negative tests that apply to the read tools (spec §13.5) and the write refusal (spec §5 rule 2), in mock mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockWrapper } from '../../src/mock/mockWrapper.ts';
import { loadConfig } from '../../src/config.ts';
import { Logger } from '../../src/logging.ts';
import { checkConnection, type Context } from '../../src/context.ts';
import { invoke } from '../../src/tools/common.ts';
import { TOOLS } from '../../src/tools/index.ts';

function ctx(opt: ConstructorParameters<typeof MockWrapper>[0] = {}, env: Record<string, string> = {}): Context {
  return { cfg: loadConfig({ SAP_TESTDATA_MOCK: '1', ...env }), wrapper: new MockWrapper(opt), log: new Logger('/dev/null', false), lastCheck: null };
}
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
const call = async (c: Context, n: string, args: Record<string, unknown> = {}) => {
  const r = await invoke(c, tool(n) as never, args as never);
  return { error: !!r.isError, text: (r.content[0] as { text: string }).text };
};

test('allowed environment: writes would be allowed, reads answer', async () => {
  const c = ctx();
  assert.equal((await checkConnection(c)).writesAllowed, true);
  assert.equal((await call(c, 'read_infotype', { kind: 'employee', objectId: '09000001', infotype: '0001' })).error, false);
});

test('wrong client / wrong system / not on the allow-list / unsupported wrapper → writes refused with the reason', async () => {
  const cases: [Parameters<typeof ctx>[0], Record<string, string>, RegExp][] = [
    [{ client: '100' }, {}, /client 100, expected 300/],
    [{ system: 'P01' }, {}, /system P01, expected T01/],
    [{ allowListed: false }, {}, /not on the test data allow-list/],
    [{ wrapperVersion: '2.0.0' }, {}, /version 2\.0\.0 is not supported/],
    [{}, { SAP_EXPECTED_SYSTEM: 'Q01' }, /expected Q01/]
  ];
  for (const [opt, env, re] of cases) {
    const c = ctx(opt, env);
    const check = await checkConnection(c);
    assert.equal(check.writesAllowed, false);
    assert.match(check.problems.join(' '), re);
    const exec = await call(c, 'execute_plan', { planId: 'P-1' });
    assert.equal(exec.error, true);
    assert.match(exec.text, /^WRITES_REFUSED/);
    const status = await call(c, 'get_connection_status');
    assert.match(status.text, /Writes are refused/);
  }
});

test('empty allow-list: every read is refused too (hard block in SAP)', async () => {
  const c = ctx({ allowListed: false });
  for (const [n, a] of [['describe_infotype', { infotype: '0006', kind: 'employee' }], ['find_employees', { limit: 5 }], ['read_infotype', { kind: 'employee', objectId: '09000001', infotype: '0006' }], ['list_runs', { limit: 5 }]] as const) {
    const r = await call(c, n, a);
    assert.equal(r.error, true, n);
    assert.match(r.text, /^CLIENT_NOT_ALLOWED/, n);
  }
});

test('blocked infotype, ineligible (excluded / unknown) employee', async () => {
  const c = ctx();
  assert.match((await call(c, 'read_infotype', { kind: 'employee', objectId: '09000001', infotype: '0021' })).text, /^INFOTYPE_NOT_ALLOWED/);
  assert.match((await call(c, 'read_infotype', { kind: 'employee', objectId: '09009999', infotype: '0001' })).text, /^EMPLOYEE_NOT_ELIGIBLE/);
  assert.match((await call(c, 'read_infotype', { kind: 'employee', objectId: '12345678', infotype: '0001' })).text, /^EMPLOYEE_NOT_ELIGIBLE/);
  const found = await call(c, 'find_employees', { limit: 50 });
  assert.doesNotMatch(found.text, /09009999/, 'excluded employees are never listed');
});

test('masking: names, addresses, pay, bank and e-mail never come back; organization reads work', async () => {
  const c = ctx();
  const out = [
    await call(c, 'read_infotype', { kind: 'employee', objectId: '09000001', infotype: '0002' }),
    await call(c, 'read_infotype', { kind: 'employee', objectId: '09000001', infotype: '0006' }),
    await call(c, 'read_infotype', { kind: 'employee', objectId: '09000003', infotype: '0008' }),
    await call(c, 'read_infotype', { kind: 'employee', objectId: '09000003', infotype: '0009' }),
    await call(c, 'read_infotype', { kind: 'employee', objectId: '09000001', infotype: '0105' })
  ].map((r) => r.text).join('\n');
  for (const secret of ['Testperson', 'Fake Street', '"PSTLZ": "00001"', '12000.00', '000123456789', 'AE0703', 'mock.person01']) assert.ok(!out.includes(secret), secret);
  assert.match(out, /"ORT01": "Testcity"/, 'non-sensitive fields stay');
  const org = await call(c, 'read_infotype', { kind: 'organization', objectType: 'S', objectId: '50000200', infotype: '1001' });
  assert.match(org.text, /A003/);
});

test('plan_changes: input checked first; then refused in Phase 1', async () => {
  const c = ctx();
  assert.match((await call(c, 'plan_changes', { kind: 'change', allowPast: false })).text, /^INVALID_INPUT: .*Give items or a scenario/);
  assert.match((await call(c, 'plan_changes', { kind: 'restore', allowPast: false })).text, /^INVALID_INPUT: .*restoreRunId/);
  assert.match((await call(c, 'plan_changes', { kind: 'change', allowPast: false, scenario: { id: 'add_work_email', params: { employee: '09000002' } } })).text, /^NOT_AVAILABLE_PHASE1/);
});

test('search: criteria, has / has-no record, limit and reasons', async () => {
  const c = ctx();
  const r = await call(c, 'find_employees', { personnelArea: '1000', hasRecord: { infotype: '2006', present: true, onDate: '2026-06-01' }, limit: 10 });
  assert.match(r.text, /^1 eligible employee found: 09000001/);
  assert.match(r.text, /has active 2006 on 2026-06-01/);
  assert.match((await call(c, 'find_employees', { limit: 2 })).text, /^2 eligible employees found/);
  assert.match((await call(c, 'find_employees', { hasRecord: { infotype: '0021', present: true }, limit: 2 })).text, /^INFOTYPE_NOT_ALLOWED/);
});
