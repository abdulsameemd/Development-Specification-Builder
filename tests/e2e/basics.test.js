/* End-to-end: New starts clean, delete + Undo works where confirm() is blocked (VS Code webview), no page errors. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

test('New clears an example; deleting a requirement offers Undo', async () => {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(() => { window.confirm = () => false; window.alert = () => {}; });
    await p.goto(APP);
    await p.waitForFunction(() => window.APB && APB.state);
    await p.click('[data-mode="fs"]');
    await p.click('[data-action="examples"]');
    await p.locator('#examples-dialog [data-action="load-example"]').first().click();
    assert.ok(await p.evaluate(() => APB.state.get().context.title));
    await p.click('[data-action="new"]');
    assert.strictEqual(await p.evaluate(() => APB.state.get().context.title || ''), '');
    assert.strictEqual(await p.evaluate(() => APB.storage.list().length), 0, 'an unchanged example is not saved');

    await p.evaluate(() => {
      const s = APB.state.get();
      s.context.system = 'sap'; s.context.module = 'FI/CO'; s.context.requirement = 'Ageing report for vendors';
      s.reqs.frs = [{ title: 'FR one' }, { title: 'FR two' }];
      APB.state.replace(s); APB.ui.ui.step = 2; APB.ui.renderMain();
    });
    await p.locator('[data-action="rec-del"][data-path="reqs.frs"]').first().click();
    assert.deepStrictEqual(await p.evaluate(() => APB.state.get().reqs.frs.map((f) => f.title)), ['FR two']);
    await p.locator('#toast .toast-btn').click();
    assert.deepStrictEqual(await p.evaluate(() => APB.state.get().reqs.frs.map((f) => f.title)), ['FR one', 'FR two']);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
