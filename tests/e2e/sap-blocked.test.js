/* End-to-end: when the ADT MCP server refuses SAP access, the review says so plainly, with the destinations. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

test('refused SAP access is shown in the review with the destinations and recorded in the audit', async () => {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(() => {
      window.__posted = [];
      window.APB_HOST = { kind: 'vscode', version: 'test', storage: {} };
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), setState() {}, getState() {} });
    });
    await p.goto(APP);
    await p.waitForFunction(() => window.APB && APB.guard);
    const send = (m) => p.evaluate((m) => window.postMessage(m, '*'), m);
    await send({ type: 'auth', signedIn: true, account: 'analyst', copilot: true, policy: {} });
    await p.click('[data-mode="fs"]');
    await p.evaluate(() => { APB.state.set('context.system', 'sap'); APB.state.set('context.module', 'HCM'); APB.state.set('context.objects', [{ type: 'PROG', name: 'ZHR_OFFCYCLE_UPLOAD' }]); APB.ui.renderMain(); });
    await p.evaluate(() => APB.fsApp.actions['fs-prog-auto']());
    const draft = { kind: 'fs-draft', version: 1, currentLogic: 'Not read: ZHR_OFFCYCLE_UPLOAD', programs: [{ type: 'PROG', name: 'ZHR_OFFCYCLE_UPLOAD', role: 'main' }] };
    await send({ type: 'draft-result', text: '```json\n' + JSON.stringify(draft) + '\n```', evidence: { calls: [{}, {}, {}], names: [], flags: 0, masked: 0, searches: 0, artifacts: [],
      blocked: { count: 3, destinations: ['SBE_210', 'SBE_210_E0099009073_EN'], first: 'Destination SBE_210 is blocked by ADT MCP Server access restrictions.' },
      usage: { requests: 2, inputTokens: 3000, outputTokens: 200 } } });
    await p.waitForSelector('#draft-dialog[open]');
    const box = await p.locator('#draft-guard').innerText();
    assert.match(box, /⛔ SAP could not be read: the ABAP ADT MCP server refused 3 calls for destination SBE_210, SBE_210_E0099009073_EN \(its message: “Destination SBE_210 is blocked/);
    assert.match(box, /SAP calls now run one at a time/);
    await p.click('[data-action="fs-draft-apply"]');
    const end = await p.evaluate(() => APB.state.get().audit.filter((e) => e.type === 'ai-end').pop().data);
    assert.strictEqual(end.sapBlocked, '3 refused – SBE_210, SBE_210_E0099009073_EN');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
