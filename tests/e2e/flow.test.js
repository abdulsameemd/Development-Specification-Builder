/* End-to-end: AS-IS / TO-BE swimlanes in the FS preview, as pictures in Word, and the TO-BE in the Technical spec. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

test('swimlane diagrams in the FS, Word pictures, TO-BE handed to the Technical spec', async () => {
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
    await p.waitForFunction(() => window.APB && APB.flow);
    await p.evaluate((m) => window.postMessage(m, '*'), { type: 'auth', signedIn: true, account: 'a', copilot: true, policy: { gates: 'warn' } });
    await p.click('[data-mode="fs"]');
    await p.click('[data-action="examples"]');
    await p.locator('#examples-dialog [data-action="load-example"]').first().click();
    await p.evaluate(() => {
      const s = APB.state.get();
      s.process.toBe = [{ step: 'Run ageing report', role: 'AP accountant', tx: 'ZFI_AGEING', change: 'new' }, { step: 'Buckets by the system', role: 'System', change: 'automated' }, { step: 'Approve list', role: 'AP lead', change: 'changed' }];
      APB.state.replace(s); APB.ui.ui.generated = true; APB.ui.renderMain();
    });
    const figs = p.locator('#main .flow-diagram svg');
    assert.strictEqual(await figs.count(), 2, 'AS-IS and TO-BE');
    assert.match(await figs.nth(1).getAttribute('aria-label'), /Proposed process \(TO-BE\), steps 1 to 3/);

    // Word: two pictures
    await p.evaluate(() => APB.fsApp.actions['fs-docx']());
    await p.waitForFunction(() => window.__posted.some((m) => m.type === 'save-file' && /\.docx$/.test(m.name)));
    const docx = Buffer.from(await p.evaluate(() => window.__posted.filter((m) => m.type === 'save-file').pop().base64), 'base64').toString('latin1');
    assert.ok(docx.includes('word/media/flow1.png') && docx.includes('word/media/flow2.png'));
    assert.ok(docx.includes('\x89PNG'), 'real PNG data');

    // hand-off: the Technical spec carries the TO-BE and draws it
    await p.evaluate(() => APB.fsApp.actions['fs-handoff-all']());
    await p.locator('#toast .toast-btn').click();
    await p.waitForFunction(() => APB.state.get().kind !== 'fs');
    const ts = await p.evaluate(() => ({ steps: APB.state.get().processToBe.length, md: APB.markdown.build(APB.state.get()) }));
    assert.strictEqual(ts.steps, 3);
    assert.match(ts.md, /Business Process \(TO-BE\)\n\n```mermaid/);
    await p.evaluate(() => { APB.ui.ui.generated = true; APB.ui.renderMain(); });
    assert.ok(await p.locator('#main .flow-diagram svg').count() >= 1, 'drawn in the TS document');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
