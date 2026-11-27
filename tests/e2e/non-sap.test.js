/* End-to-end: non-SAP ("Other system") FS → solution components → generic Technical spec (no SAP check) →
   "Complete the TS with Copilot" → hand-off to Copilot agent mode. SAP stays as it is (see sap-snapshot.test.js). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

test('Other system: components → generic TS (API from the FS data, authorization No) → completion → agent mode', async () => {
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
    await p.waitForFunction(() => window.APB && APB.fsApp && APB.tsDraft);
    const send = (m) => p.evaluate((m) => window.postMessage(m, '*'), m);
    await send({ type: 'auth', signedIn: true, account: 'dev', copilot: true, policy: { gates: 'warn' } });
    await p.click('[data-mode="fs"]');
    await p.evaluate(() => {
      const s = APB.fs.model.blank();
      s.context.system = 'other'; s.context.systemName = 'Customer portal (.NET)'; s.context.title = 'Open orders for the customer portal';
      s.context.requirement = 'The customer portal shows the open orders of the logged-in customer.';
      s.reqs.frs = [{ title: 'List open orders', priority: 'must', description: 'Customer sees open orders', acceptance: 'When the customer opens the page, then the open orders are listed' }];
      s.reqs.data = [
        { field: 'Order status', table: 'Order', sapField: 'Status', usage: 'selection', mandatory: true },
        { field: 'Order number', table: 'Order', sapField: 'OrderNo', usage: 'output' },
        { field: 'Order total', table: 'Order', sapField: 'Total', usage: 'output' }];
      s.solution.ricefw = [{ type: 'api', name: '', description: 'Open orders REST service for the portal', frs: 'FR-01' }];
      APB.state.replace(APB.fs.model.migrate(s));
      APB.ui.renderMain();
    });
    // the FS shows solution components (not RICEFW) and the non-SAP document has them
    const md = await p.evaluate(() => APB.fsMarkdown.build(APB.state.get()));
    assert.match(md, /Solution components/);
    assert.match(md, /\| C-01 \| API \/ service \|/);
    assert.doesNotMatch(md, /RICEFW|Configuration \(SPRO\)/);
    assert.match(md, /\| FR \| Requirement \| Fit-gap \| Solution \| Component \| UAT \|/);

    await p.evaluate(() => APB.fsApp.actions['fs-handoff-one']({ dataset: { i: '0' } }));
    await p.waitForFunction(() => window.__posted.some((m) => m.type === 'ts-draft'));
    assert.strictEqual(await p.evaluate(() => window.__posted.filter((m) => m.type === 'read-dev').length), 0, 'no SAP check for non-SAP');
    const st = await p.evaluate(() => APB.state.get());
    assert.strictEqual(st.platform, 'generic');
    assert.strictEqual(st.stack, '.NET (C# / ASP.NET Core)');
    assert.deepStrictEqual(st.types, ['G_API']);
    const api = st.objects[0];
    assert.deepStrictEqual([api.type, api.name], ['API Endpoint', 'OpenOrdersRestApi']);
    assert.deepStrictEqual(api.detail.request.map((r) => [r.name, r.required]), [['orderStatus', true]]);
    assert.deepStrictEqual(api.detail.response.map((r) => r.source), ['Order.OrderNo', 'Order.Total']);
    assert.strictEqual(st.quality.authorization, 'no');
    const prompt = await p.evaluate(() => window.__posted.filter((m) => m.type === 'ts-draft').pop().prompt);
    assert.match(prompt, /^TS-DRAFT v1\nComplete the technical specification below for GitHub Copilot \(agent mode\)/);
    assert.doesNotMatch(prompt, /SAP|ABAP|dewa-abap/);

    // completion: one invented column → TBC
    const ans = { kind: 'dewa-ts-draft', version: 1, objects: [{ name: 'OpenOrdersRestApi', type: 'API Endpoint', detail: {
      method: 'GET', path: '/api/v1/orders/open', logic: '1. Filter Order.Status = open and Order.CustomerId = current user\n2. Return Order.OrderNo and Order.Total, DateTime.Now as timestamp' } }],
      quality: { testScenarios: 'Customer with 2 open orders => 2 rows' }, openQuestions: [] };
    await send({ type: 'tsdraft-result', text: '```json\n' + JSON.stringify(ans) + '\n```', evidence: { calls: [], names: [], flags: 0, masked: 0 } });
    await p.waitForSelector('#tsd-dialog[open]');
    assert.match(await p.locator('#tsd-list').innerText(), /1 name not found in the FS or the TS – marked \[TO BE CONFIRMED\]/);
    await p.click('[data-action="tsd-apply"]');
    const after = await p.evaluate(() => APB.state.get());
    assert.match(after.objects[0].detail.logic, /\[TO BE CONFIRMED\] Order\.CustomerId/);
    assert.match(after.objects[0].detail.logic, /Order\.Status = open/);
    assert.doesNotMatch(after.objects[0].detail.logic, /\[TO BE CONFIRMED\] DateTime/);
    assert.strictEqual(after.objects[0].detail.method, 'GET');

    // the TS document and the hand-off: agent mode, generic instructions, no SAP sections
    const tsMd = await p.evaluate(() => APB.markdown.build(APB.state.get()));
    assert.match(tsMd, /Inspect the existing repository first[^\n]*\(tech stack: \.NET \(C# \/ ASP\.NET Core\)\)/);
    assert.match(tsMd, /parameterised queries/);
    assert.doesNotMatch(tsMd, /Clean ABAP|SAP Clean Core|dewa-abap|Current State in SAP/);
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await p.locator('#toast .toast-btn').click();
    await p.waitForTimeout(150);
    const chat = await p.evaluate(() => window.__posted.filter((m) => m.type === 'open-chat').pop());
    assert.strictEqual(chat.agent, 'agent');
    assert.match(chat.prompt, /^DEWA-GENERIC v1\nImplement the technical specification below in this repository \(\.NET/);

    // step 1 shows the non-SAP types only; switching back to SAP shows the SAP types
    await p.evaluate(() => { const b = document.querySelector('[data-action="goto"][data-step="1"]'); if (b) b.click(); });
    await p.waitForTimeout(100);
    const typesGen = await p.$$eval('.type-card .type-name', (e) => e.map((x) => x.textContent));
    assert.deepStrictEqual(typesGen, ['Web application', 'API / service', 'Database', 'Power App', 'Power Automate flow', 'Integration', 'Scheduled job']);
    await p.click('[data-action="ts-platform"][data-platform="sap"]');
    const typesSap = await p.$$eval('.type-card .type-name', (e) => e.map((x) => x.textContent));
    assert.ok(typesSap.includes('Report') && !typesSap.includes('Power App'));
    assert.strictEqual(await p.evaluate(() => APB.state.get().platform), undefined, 'SAP: no platform key');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
