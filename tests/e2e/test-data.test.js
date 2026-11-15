/* End-to-end: Test data (SAP HR) card in the Technical spec – scenario rows, Copilot Chat in agent mode, document. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

test('add scenario rows, hand them to Copilot Chat (agent mode), and see them in the document', async () => {
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
    await p.waitForFunction(() => window.APB && APB.testData);
    await p.click('[data-action="examples"]');
    await p.locator('#examples-dialog [data-action="load-example"]').first().click();
    await p.evaluate(() => { APB.ui.ui.step = 4; APB.ui.renderMain(); });
    assert.strictEqual(await p.locator('.td-card [data-action="td-scenario"]').count(), 6);
    await p.click('[data-action="td-scenario"][data-id="future_dated_address_change"]');
    assert.strictEqual(await p.evaluate(() => APB.state.get().quality.testData.length), 2);
    await p.locator('.td-card input[data-bind="quality.testData.1.validFrom"]').fill('2026-12-01');
    await p.locator('.td-card input[data-bind="quality.testData.1.validFrom"]').blur();
    assert.strictEqual(await p.evaluate(() => APB.state.get().quality.testData[1].validFrom), '2026-12-01');
    await p.click('[data-action="td-chat"]');
    const m = await p.evaluate(() => window.__posted.filter((x) => x.type === 'open-chat').pop());
    assert.strictEqual(m.agent, 'agent');
    assert.match(m.prompt, /2\. Address valid on a date · .*infotype 0006\/1 · operation create · valid 2026-12-01 – 9999-12-31/);
    assert.ok(await p.evaluate(() => APB.state.get().audit.some((e) => e.type === 'export' && /sap-test-data/.test(e.data.to))));
    const md = await p.evaluate(() => APB.markdown.build(APB.state.get()));
    assert.match(md, /\| Address valid on a date \| Same employee \| 0006 \| 1 \| Create \| 2026-12-01 \|/);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
