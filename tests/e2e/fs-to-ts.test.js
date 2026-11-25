/* End-to-end: FS (simple ALV report) → Technical spec. Fixed mapping (selection screen, ALV columns, authorization No),
   then the read-only SAP check, then "Complete the TS with Copilot" with review – invented names marked TBC. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');

test('FS → TS: selection screen and ALV columns from the FS, authorization No; SAP check, then Copilot completes the empty fields', async () => {
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
      s.context.system = 'sap'; s.context.module = 'SD'; s.context.title = 'Open sales orders report';
      s.context.requirement = 'Simple ALV list of open sales orders per sales organization.';
      s.reqs.frs = [{ title: 'Show open orders', priority: 'must', description: 'List open orders', acceptance: 'When I run it, then open orders are listed' }];
      s.reqs.data = [
        { field: 'Sales organization', table: 'VBAK', sapField: 'VKORG', mandatory: true, usage: 'selection' },
        { field: 'Sales order', table: 'VBAK', sapField: 'VBELN', usage: 'output' },
        { field: 'Net value', table: 'VBAK', sapField: 'NETWR', usage: 'output' }];
      s.solution.ricefw = [{ type: 'report', name: '', description: 'Open sales orders ALV report', frs: 'FR-01' }];
      APB.state.replace(APB.fs.model.migrate(s));
      APB.fsApp.actions['fs-handoff-one']({ dataset: { i: '0' } });
    });
    await p.waitForFunction(() => window.__posted.some((m) => m.type === 'read-dev'));
    const st = await p.evaluate(() => APB.state.get());
    const main = st.objects[0];
    assert.deepStrictEqual([main.type, main.name, main.status], ['Report', 'ZSD_OPEN_SALES_ORDERS_ALV', 'new']);
    assert.deepStrictEqual(main.detail.selection.map((r) => r.name + ' ' + r.type), ['S_VKORG VBAK-VKORG']);
    assert.deepStrictEqual(main.detail.columns.map((c) => c.source), ['VBAK-VBELN', 'VBAK-NETWR']);
    assert.deepStrictEqual(main.detail.outputType, ['ALV (CL_SALV_TABLE)']);
    assert.strictEqual(st.quality.authorization, 'no');
    const devPrompt = await p.evaluate(() => window.__posted.filter((m) => m.type === 'read-dev').pop().prompt);
    assert.match(devPrompt, /Fields used in the design \(TABLE-FIELD\)[^\n]*VBAK-VKORG/);
    assert.strictEqual(await p.evaluate(() => window.__posted.filter((m) => m.type === 'ts-draft').length), 0, 'completion waits for the SAP check');

    // the SAP check answers: name free, VBAK exists, VBAK-NETWR unknown in this (test) answer
    await send({ type: 'devctx-result', text: '```json\n' + JSON.stringify({ kind: 'dewa-dev-context', version: 1, checked: [{ name: 'ZSD_OPEN_SALES_ORDERS_ALV', result: 'missing' }], objects: [], notFound: ['VBAK-NETWR'] }) + '\n```', evidence: { calls: [], names: [], flags: 0, masked: 0 } });
    await p.waitForSelector('#devctx-dialog[open]');
    assert.match(await p.locator('#devctx-list').innerText(), /Fields of the design not found in SAP/);
    await p.click('[data-action="devctx-apply"]');
    await p.waitForFunction(() => window.__posted.some((m) => m.type === 'ts-draft'));
    const tsPrompt = await p.evaluate(() => window.__posted.filter((m) => m.type === 'ts-draft').pop());
    assert.strictEqual(tsPrompt.mode, 'auto');
    assert.match(tsPrompt.prompt, /^TS-DRAFT v1/);
    assert.match(tsPrompt.prompt, /FS EXTRACT/);
    assert.match(await p.evaluate(() => APB.state.get().objects[0].detail.columns[1].source), /^\[TO BE CONFIRMED\] VBAK-NETWR$/);

    // Copilot's completion: logic with one invented field; columns already filled (not offered)
    const ans = { kind: 'dewa-ts-draft', version: 1, objects: [{ name: 'ZSD_OPEN_SALES_ORDERS_ALV', type: 'Report', detail: {
      logic: '1. Read open orders from VBAK where VBAK-VKORG in S_VKORG and VBUK-GBSTK <> C\n2. Show them with CL_SALV_TABLE', background: 'no', columns: [{ field: 'X' }] } }],
      quality: { dataVolume: 'medium', testScenarios: 'Sales org 1000 => open orders listed' }, expectedOutput: 'ALV list', openQuestions: ['Which statuses count as open?'] };
    await send({ type: 'tsdraft-result', text: '```json\n' + JSON.stringify(ans) + '\n```', evidence: { calls: [], names: [], flags: 0, masked: 0 } });
    await p.waitForSelector('#tsd-dialog[open]');
    const list = await p.locator('#tsd-list').innerText();
    assert.match(list, /Processing logic \(contains \[TO BE CONFIRMED\]\)/);
    assert.match(list, /1 SAP name not found in the FS, the TS or SAP/);
    assert.doesNotMatch(list, /Output columns/, 'filled field not offered');
    await p.click('[data-action="tsd-apply"]');
    const after = await p.evaluate(() => APB.state.get());
    assert.match(after.objects[0].detail.logic, /\[TO BE CONFIRMED\] VBUK-GBSTK/);
    assert.match(after.objects[0].detail.logic, /VBAK-VKORG in S_VKORG/);
    assert.strictEqual(after.objects[0].detail.columns.length, 2, 'columns unchanged');
    assert.strictEqual(after.quality.authorization, 'no');
    assert.strictEqual(after.quality.dataVolume, 'medium');
    const md = await p.evaluate(() => APB.markdown.build(APB.state.get()));
    assert.match(md, /## \d+\. Design Sources/);
    const review = after.audit.filter((e) => e.type === 'review' && e.data.job === 'tsdraft').pop();
    assert.ok(review && review.data.unconfirmed === 1);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
