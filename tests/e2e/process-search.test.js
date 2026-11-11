/* End-to-end: BRD upload → the read-only job searches SAP by process; candidates come back unticked, one is picked. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
const BRD = 'Business Requirement: Off-cycle bonus payments\nHR needs to pay approved one-time bonuses outside the regular payroll run.\nBR-01 Upload approved bonus memos.\n';

test('BRD without SAP names: process search in the prompt, candidates offered unticked, only the ticked one is added', async () => {
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
    await p.waitForFunction(() => window.APB && APB.fsDraft);
    const send = (m) => p.evaluate((m) => window.postMessage(m, '*'), m);
    await send({ type: 'auth', signedIn: true, account: 'analyst', copilot: true, policy: { namespaces: { HCM: ['ZHR', 'ZWHR'] } } });
    await p.click('[data-mode="fs"]');
    await p.evaluate(() => { APB.state.set('context.system', 'sap'); APB.state.set('context.module', 'HCM'); APB.ui.renderMain(); });
    await p.setInputFiles('#fs-doc-brd', { name: 'BRD_Bonus.txt', mimeType: 'text/plain', buffer: Buffer.from(BRD) });
    await p.waitForTimeout(500);
    await p.click('[data-action="fs-docs-auto"]');
    const prompt = await p.evaluate(() => window.__posted.filter((m) => m.type === 'read-program').pop().prompt);
    assert.match(prompt, /SEARCH THE SAP SYSTEM BY PROCESS/);
    assert.match(prompt, /prefixes of the module HCM: ZHR\*, ZWHR\*/);

    const draft = { kind: 'fs-draft', version: 1, title: 'Off-cycle bonus payments', changeType: 'new',
      candidates: [
        { type: 'PROG', name: 'ZWHR_BONUS_POST', description: 'Bonus posting to payroll', why: 'name matches ZWHR*BONUS*', origin: 'custom' },
        { type: 'TRAN', name: 'PC00_M02_CALC', description: 'Start payroll', why: 'description contains payroll', origin: 'standard' }] };
    await send({ type: 'draft-result', text: '```json\n' + JSON.stringify(draft) + '\n```', evidence: { calls: [{}, {}, {}], names: ['ZWHR_BONUS_POST', 'PC00_M02_CALC'], flags: 0, masked: 0 } });
    await p.waitForSelector('#draft-dialog[open]');
    const cands = p.locator('#draft-list input[name="draft-cand"]');
    assert.strictEqual(await cands.count(), 2);
    assert.strictEqual(await p.locator('#draft-list input[name="draft-cand"]:checked').count(), 0, 'unticked');
    assert.match(await p.locator('.draft-candidates').innerText(), /ZWHR_BONUS_POST – candidate – name matches ZWHR\*BONUS\*/);
    assert.match(await p.locator('#draft-guard').innerText(), /2 of 2 SAP names in this draft were read from the system/);
    await p.locator('#draft-list input[value="ZWHR_BONUS_POST"]').check();
    await p.click('[data-action="fs-draft-apply"]');
    const st = await p.evaluate(() => APB.state.get());
    assert.deepStrictEqual(st.context.objects.map((o) => o.name), ['ZWHR_BONUS_POST']);
    assert.match(st.context.objects[0].note, /^candidate – name matches ZWHR\*BONUS\*/);
    const review = st.audit.filter((e) => e.type === 'review').pop();
    assert.strictEqual(review.data.candidatesOffered, 2);
    assert.strictEqual(review.data.candidatesTaken, 'ZWHR_BONUS_POST');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
