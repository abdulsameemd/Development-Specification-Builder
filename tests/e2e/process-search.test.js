/* End-to-end: BRD upload → the read-only job searches SAP by process; candidates come back unticked, one is picked. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
const BRD = 'Business Requirement: Off-cycle bonus payments\nHR needs to pay approved one-time bonuses outside the regular payroll run.\nBR-01 Upload approved bonus memos.\n';

test('BRD without SAP names: phase 1 searches SAP (short brief), phase 2 writes the FS; candidates unticked; tokens and artifacts reported', async () => {
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
    const phase1 = await p.evaluate(() => window.__posted.filter((m) => m.type === 'read-program').pop());
    assert.strictEqual(phase1.maxRounds, 8, 'phase 1 is a short search');
    // the busy overlay offers "Finish now" for the SAP search: it asks the extension to stop calling SAP
    const fin = p.locator('.busy [data-busy="finish"]');
    assert.ok(await fin.isVisible());
    await fin.click();
    assert.ok(await p.evaluate(() => window.__posted.some((m) => m.type === 'finish-now')));
    assert.match(await p.locator('.busy-step').innerText(), /Finishing with what was read so far/);
    assert.ok(await fin.isDisabled());

    const draft = { kind: 'fs-draft', version: 1, title: 'Off-cycle bonus payments', changeType: 'new',
      candidates: [
        { type: 'PROG', name: 'ZWHR_BONUS_POST', description: 'Bonus posting to payroll', why: 'name matches ZWHR*BONUS*', origin: 'custom' },
        { type: 'TRAN', name: 'PC00_M02_CALC', description: 'Start payroll', why: 'description contains payroll', origin: 'standard' }] };
    // phase 1 (small prompt, read-only tools) answers with the SAP findings and its usage
    assert.ok(!prompt.includes('Write a FUNCTIONAL SPECIFICATION from the business documents'), 'phase 1 is the short SAP brief');
    await send({ type: 'draft-result', text: '```json\n' + JSON.stringify(draft) + '\n```', evidence: { calls: [{}, {}, {}], names: ['ZWHR_BONUS_POST', 'PC00_M02_CALC'], flags: 0, masked: 0,
      searches: 2, artifacts: [{ name: 'ZWHR_BONUS_POST', tool: 'abap_get_source' }], usage: { requests: 3, inputTokens: 9000, outputTokens: 800, estimated: false } } });
    // phase 2: the full documents + findings, no tools (route "draft")
    await p.waitForFunction(() => window.__posted.some((m) => m.type === 'draft'));
    const write = await p.evaluate(() => window.__posted.filter((m) => m.type === 'draft').pop().prompt);
    assert.match(write, /^FS-DRAFT v1/);
    assert.match(write, /SAP findings – already read from the SAP system/);
    assert.match(write, /Candidate found by process search: PROG ZWHR_BONUS_POST/);
    assert.match(write, /Upload approved bonus memos/, 'full documents in phase 2');
    const fs2 = { kind: 'fs-draft', version: 1, title: 'Off-cycle bonus payments', frs: [{ title: 'BR-01 Upload approved bonus memos', priority: 'must' }],
      objects: [{ type: 'PROG', name: 'ZINVENTED_BY_WRITER', note: 'exists in SAP' }] };
    await send({ type: 'draft-result', text: '```json\n' + JSON.stringify(fs2) + '\n```', evidence: { calls: [], names: [], flags: 0, masked: 0, usage: { requests: 1, inputTokens: 30000, outputTokens: 2500, estimated: false } } });
    await p.waitForSelector('#draft-dialog[open]');
    assert.doesNotMatch(await p.locator('#draft-list').innerText(), /ZINVENTED_BY_WRITER/, 'SAP objects only from phase 1');
    assert.match(await p.locator('#draft-guard').innerText(), /Copilot used 42,300 tokens \(39,000 in · 3,300 out, 4 model calls\) · 2 SAP searches · 1 ABAP artifact read: ZWHR_BONUS_POST/);
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
    const end = st.audit.filter((e) => e.type === 'ai-end').pop();
    assert.deepStrictEqual([end.data.job, end.data.tokensIn, end.data.tokensOut, end.data.modelCalls, end.data.sapSearches, end.data.artifactsRead], ['docs', 39000, 3300, 4, 2, 1]);
    await p.click('[data-action="usage"]');
    assert.match(await p.locator('#usage-body').innerText(), /Read BRD \/ solution document\s+1\s+100%/);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
});
