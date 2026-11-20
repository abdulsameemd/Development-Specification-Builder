// Configuration (spec §5): required values, https only, no defaults outside mock mode, secrets never exposed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, publicConfig } from '../../src/config.ts';
import { TestDataError } from '../../src/errors.ts';

const FULL = { SAP_HOST: 'https://t01.example.invalid:44300/', SAP_CLIENT: '300', SAP_EXPECTED_SYSTEM: 't01', SAP_USER: 'ZHR_TESTDATA_FU', SAP_PASSWORD: 's3cret' };

test('complete configuration is read; host normalised; system upper case; password not in the public view', () => {
  const c = loadConfig(FULL);
  assert.equal(c.host, 'https://t01.example.invalid:44300');
  assert.equal(c.expectedSystem, 'T01');
  assert.equal(c.timeoutMs, 60000);
  assert.ok(!JSON.stringify(publicConfig(c)).includes('s3cret'));
});

test('refuses to start: any required value missing, an unfilled VS Code input, http, or a bad client', () => {
  for (const k of Object.keys(FULL)) {
    const env = { ...FULL, [k]: '' };
    assert.throws(() => loadConfig(env), (e: unknown) => e instanceof TestDataError && e.code === 'CONFIG_MISSING' && e.message.includes(k), k);
  }
  assert.throws(() => loadConfig({ ...FULL, SAP_PASSWORD: '${input:sap-password}' }), /Missing: SAP_PASSWORD/);
  assert.throws(() => loadConfig({ ...FULL, SAP_HOST: 'http://t01:8000' }), /https:\/\/ address/);
  assert.throws(() => loadConfig({ ...FULL, SAP_CLIENT: '30' }), /three-digit client/);
});

test('mock mode needs no SAP values', () => {
  const c = loadConfig({ SAP_TESTDATA_MOCK: '1' });
  assert.equal(c.mock, true);
  assert.equal(c.client, '300');
});
