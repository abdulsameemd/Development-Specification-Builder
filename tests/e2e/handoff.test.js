/* End-to-end: Technical spec hand-off – new objects to dewa-abap, changed objects to dewa-abap-change, both → choice. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.addInitScript(() => {
    window.__posted = [];
    window.APB_HOST = { kind: 'vscode', version: 'test', storage: {} };
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), setState() {}, getState() {} });
  });
  await p.goto(APP);
  await p.waitForFunction(() => window.APB && APB.markdown && APB.markdown.handoff);
  await p.evaluate((m) => window.postMessage(m, '*'), { type: 'auth', signedIn: true, account: 'dev', copilot: true, policy: { gates: 'warn' } });
  return p;
}
async function handOver(p, objects) {
  await p.evaluate((objs) => {
    APB.state.replace(APB.state.migrate({ requirement: { text: 'Bonus duplicate check before posting' }, types: ['REPORT'], objects: objs }));
    window.__posted.length = 0;
    APB.ui.renderMain();
  }, objects);
  await p.evaluate(() => document.querySelector('[data-action="vscode"]').click());
  await p.locator('#toast .toast-btn').click(); // warn mode: continue without approval
  await p.waitForTimeout(150);
}
const chats = (p) => p.evaluate(() => window.__posted.filter((m) => m.type === 'open-chat').map((m) => m.agent + '|' + m.prompt.slice(0, 22)));

const NEW = { type: 'Table', name: 'ZHR_BONUS_AI_LOG', status: 'new' };
const CHANGE = { type: 'Report', name: 'ZHR_BONUS_UPDATE', status: 'change', purpose: 'Add duplicate check' };

test('new only → dewa-abap; change only → dewa-abap-change; both → choice with two hand-offs', async () => {
  const browser = await chromium.launch();
  try {
    const p = await page(browser);
    await handOver(p, [NEW]);
    assert.deepStrictEqual(await chats(p), ['dewa-abap|Implement the SAP deve']);

    await handOver(p, [CHANGE]);
    assert.deepStrictEqual(await chats(p), ['dewa-abap-change|DEWA-ABAP-CHANGE v1\nCh']);

    await handOver(p, [NEW, CHANGE]);
    assert.ok(await p.locator('#handoff-dialog[open]').isVisible(), 'choice shown');
    assert.deepStrictEqual(await chats(p), [], 'nothing sent before choosing');
    await p.click('[data-action="handoff-new"]');
    await p.evaluate(() => document.querySelector('[data-action="vscode"]').click());
    await p.locator('#toast .toast-btn').click();
    await p.click('[data-action="handoff-change"]');
    const sent = await chats(p);
    assert.deepStrictEqual(sent, ['dewa-abap|Implement the SAP deve', 'dewa-abap-change|DEWA-ABAP-CHANGE v1\nCh']);
    const audit = await p.evaluate(() => APB.state.get().audit.filter((e) => e.type === 'export').map((e) => e.data.to));
    assert.ok(audit.includes('Copilot Chat (dewa-abap)') && audit.includes('Copilot Chat (dewa-abap-change)'));
    assert.deepStrictEqual(p.errors, []);
  } finally {
    await browser.close();
  }
});
