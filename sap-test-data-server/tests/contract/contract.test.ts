// Contract (spec §13.2): the same request / response examples drive both sides. Here: the server's HttpWrapper sends
// exactly the documented request and understands the documented response; the mock wrapper answers with the same
// shape. The ABAP wrapper is checked against the same files (ABAP Unit, Phase 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SapClient, HttpWrapper, type FetchLike } from '../../src/sapClient.ts';
import { MockWrapper } from '../../src/mock/mockWrapper.ts';
import { loadConfig } from '../../src/config.ts';
import { TestDataError } from '../../src/errors.ts';

interface Example { name: string; call: [string, ...unknown[]]; request: { method: string; path: string; query?: Record<string, string>; body?: unknown }; response: { status: number; body: unknown } }
const examples: Example[] = readdirSync('tests/contract').filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync('tests/contract/' + f, 'utf8')));
const cfg = loadConfig({ SAP_HOST: 'https://t01.example.invalid', SAP_CLIENT: '300', SAP_EXPECTED_SYSTEM: 'T01', SAP_USER: 'FU', SAP_PASSWORD: 'pw' });

/** keys (recursively, first element of arrays) – the "shape" both sides must share */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, k === 'fields' && !Array.isArray((v as Record<string, unknown>)[k]) ? 'map' : shape((v as Record<string, unknown>)[k])]));
  return typeof v;
}

for (const ex of examples) {
  test('contract ' + ex.name + ': server request and response handling', async () => {
    let seen: { url: URL; method: string; body?: unknown } | null = null;
    const fetchFn: FetchLike = async (url, init) => {
      if (init.headers && (init.headers as Record<string, string>)['x-csrf-token'] === 'Fetch') return new Response('{"system":"T01"}', { status: 200, headers: { 'x-csrf-token': 'tok' } });
      seen = { url: new URL(url), method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined };
      return new Response(JSON.stringify(ex.response.body), { status: ex.response.status, headers: { 'content-type': 'application/json' } });
    };
    const w = new HttpWrapper(new SapClient(cfg, fetchFn)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const [method, ...args] = ex.call;
    let result: unknown, error: unknown;
    try { result = await w[method]!(...args); } catch (e) { error = e; }
    const s = seen as unknown as { url: URL; method: string; body?: unknown };
    assert.equal(s.method, ex.request.method);
    assert.equal(s.url.pathname, '/sap/bc/zhr_testdata/v1' + ex.request.path);
    assert.equal(s.url.searchParams.get('sap-client'), '300');
    for (const [k, v] of Object.entries(ex.request.query || {})) assert.equal(s.url.searchParams.get(k), v);
    if (ex.request.body !== undefined) assert.deepEqual(s.body, ex.request.body);
    if (ex.response.status >= 400) {
      const code = (ex.response.body as { error: { code: string } }).error.code;
      assert.ok(error instanceof TestDataError && error.code === code, 'error code ' + code);
    } else {
      assert.deepEqual(result, method === 'listRuns' ? (ex.response.body as { runs: unknown }).runs : ex.response.body);
    }
  });

  test('contract ' + ex.name + ': mock wrapper answers with the same shape', async () => {
    const mock = new MockWrapper(ex.name === 'error_client_not_allowed' ? { allowListed: false } : {}) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const [method, ...args] = ex.call;
    if (ex.response.status >= 400) {
      const code = (ex.response.body as { error: { code: string } }).error.code;
      await assert.rejects(mock[method]!(...args), (e: unknown) => e instanceof TestDataError && e.code === code);
    } else {
      assert.deepEqual(shape(await mock[method]!(...args)), shape(ex.response.body));
    }
  });
}
