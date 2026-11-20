// SAP web client (spec §5, §12): sap-client, basic logon, session cookie, CSRF token for POST (fetched again once),
// timeout, error mapping with SAP's messages – and never leaking the password.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SapClient, HttpWrapper, type FetchLike } from '../../src/sapClient.ts';
import { loadConfig } from '../../src/config.ts';
import { TestDataError } from '../../src/errors.ts';

const cfg = { ...loadConfig({ SAP_HOST: 'https://t01.example.invalid', SAP_CLIENT: '300', SAP_EXPECTED_SYSTEM: 'T01', SAP_USER: 'FU', SAP_PASSWORD: 'pw' }), timeoutMs: 1000 };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fake(handler: (c: Call, n: number) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return { calls, fetch: async (url, init) => { const c = { url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined }; calls.push(c); return handler(c, calls.length); } };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('GET: service path, sap-client, basic logon, requester header; cookie kept for the next call', async () => {
  const f = fake((c, n) => n === 1 ? json(200, { system: 'T01' }, { 'set-cookie': 'SAP_SESSIONID_T01_300=abc; path=/; HttpOnly' }) : json(200, { runs: [] }));
  const client = new SapClient(cfg, f.fetch);
  await client.get('/status');
  await new HttpWrapper(client).listRuns({ limit: 5 });
  assert.equal(f.calls[0]!.url, 'https://t01.example.invalid/sap/bc/zhr_testdata/v1/status?sap-client=300');
  assert.equal(f.calls[0]!.headers.authorization, 'Basic ' + Buffer.from('FU:pw').toString('base64'));
  assert.ok(f.calls[0]!.headers['x-requester']);
  assert.equal(f.calls[1]!.headers.cookie, 'SAP_SESSIONID_T01_300=abc');
  assert.match(f.calls[1]!.url, /\/runs\?sap-client=300&limit=5$/);
});

test('POST: fetches the CSRF token first, reuses it, fetches again once when SAP says it is required', async () => {
  let tokenNo = 0;
  const f = fake((c) => {
    if (c.method === 'GET') return json(200, { system: 'T01' }, { 'x-csrf-token': 'T' + (++tokenNo) });
    if (c.headers['x-csrf-token'] === 'T1' && f.calls.filter((x) => x.method === 'POST').length === 2) return new Response('', { status: 403, headers: { 'x-csrf-token': 'Required' } });
    return json(200, { records: [], maskedFields: [] });
  });
  const w = new HttpWrapper(new SapClient(cfg, f.fetch));
  await w.readInfotype({ kind: 'employee', objectId: '09000001', infotype: '0006' });
  await w.readInfotype({ kind: 'employee', objectId: '09000001', infotype: '0006' });
  const seq = f.calls.map((c) => c.method + (c.headers['x-csrf-token'] ? ' ' + c.headers['x-csrf-token'] : ''));
  assert.deepEqual(seq, ['GET Fetch', 'POST T1', 'POST T1', 'GET Fetch', 'POST T2']);
  assert.equal(f.calls[1]!.headers['content-type'], 'application/json');
});

test('errors: wrapper codes with SAP messages, 401, redirect, non-JSON, timeout; password never in a message', async () => {
  const cases: [Response | 'hang', string][] = [
    [json(403, { error: { code: 'INFOTYPE_NOT_ALLOWED', message: 'Infotype 0021 is not enabled.', sapMessages: ['PG 123 blocked'] } }), 'INFOTYPE_NOT_ALLOWED'],
    [new Response('', { status: 401 }), 'AUTHORIZATION_MISSING'],
    [new Response('', { status: 302, headers: { location: '/sap/public/bc/icf/logon' } }), 'SERVICE_UNAVAILABLE'],
    [new Response('<html>oops</html>', { status: 500 }), 'SERVICE_UNAVAILABLE'],
    ['hang', 'TIMEOUT']
  ];
  for (const [res, code] of cases) {
    const fetchFn: FetchLike = res === 'hang'
      ? (_u, init) => new Promise((_, rej) => (init.signal as AbortSignal).addEventListener('abort', () => rej(new Error('aborted'))))
      : async () => res.clone();
    const client = new SapClient({ ...cfg, timeoutMs: 1000 }, fetchFn);
    await assert.rejects(client.get('/status'), (e: unknown) => {
      assert.ok(e instanceof TestDataError);
      assert.equal(e.code, code);
      assert.ok(!e.message.includes('pw') || code !== 'x');
      if (code === 'INFOTYPE_NOT_ALLOWED') assert.deepEqual(e.sapMessages, ['PG 123 blocked']);
      return true;
    });
  }
});
