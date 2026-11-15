/* Configuration from environment variables (specification §5). Host, client, expected system and user are required
   – there are no defaults; the password comes from VS Code's password prompt (${input:sap-password}). In mock mode
   (SAP_TESTDATA_MOCK=1) no SAP values are needed. Secrets are never logged or printed. */
import { userInfo } from 'node:os';
import { TestDataError } from './errors.js';

export interface Config {
  mock: boolean;
  host: string;            // https://host:port
  client: string;          // e.g. 300
  expectedSystem: string;  // e.g. T01
  user: string;
  password: string;
  timeoutMs: number;
  requester: string;       // self-reported (OS user) – for tracing, not proof of identity
  logFile: string;
}

const REQUIRED = ['SAP_HOST', 'SAP_CLIENT', 'SAP_EXPECTED_SYSTEM', 'SAP_USER', 'SAP_PASSWORD'] as const;

function requesterName(env: NodeJS.ProcessEnv): string {
  try { return userInfo().username || env.USER || env.USERNAME || 'unknown'; } catch { return env.USER || env.USERNAME || 'unknown'; }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mock = env.SAP_TESTDATA_MOCK === '1' || env.SAP_TESTDATA_MOCK === 'true';
  const timeoutMs = Number(env.SAP_TIMEOUT_MS || 60000);
  const home = env.HOME || env.USERPROFILE || '.';
  const base = {
    mock,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000 ? timeoutMs : 60000,
    requester: requesterName(env).slice(0, 60),
    logFile: env.SAP_TESTDATA_LOG || home + '/.sap-test-data/log.jsonl'
  };
  if (mock) {
    return { ...base, host: 'mock://test-system', client: env.SAP_CLIENT || '300', expectedSystem: env.SAP_EXPECTED_SYSTEM || 'T01', user: env.SAP_USER || 'MOCK_USER', password: '' };
  }
  const missing = REQUIRED.filter((k) => !String(env[k] ?? '').trim() || String(env[k]).includes('${input:'));
  if (missing.length) throw new TestDataError('CONFIG_MISSING', 'Missing: ' + missing.join(', ') + '. Set them in .vscode/mcp.json (see docs/setup-guide.md).');
  const host = String(env.SAP_HOST).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(host)) throw new TestDataError('CONFIG_MISSING', 'SAP_HOST must be an https:// address (encrypted connections only).');
  const client = String(env.SAP_CLIENT).trim();
  if (!/^\d{3}$/.test(client)) throw new TestDataError('CONFIG_MISSING', 'SAP_CLIENT must be a three-digit client number, e.g. 300.');
  return {
    ...base,
    host,
    client,
    expectedSystem: String(env.SAP_EXPECTED_SYSTEM).trim().toUpperCase(),
    user: String(env.SAP_USER).trim(),
    password: String(env.SAP_PASSWORD)
  };
}

/** For status output and logs: the configuration without secrets. */
export function publicConfig(c: Config): Record<string, unknown> {
  return { mock: c.mock, host: c.host, client: c.client, expectedSystem: c.expectedSystem, user: c.user, timeoutMs: c.timeoutMs, requester: c.requester };
}
