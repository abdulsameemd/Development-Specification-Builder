/* End-to-end: approval by sending the file (email / Teams). Two browsers = two people, simulated VS Code host. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
const POLICY = { gates: 'enforce', requireSapCheck: true, approvers: { functional: ['fs-lead'], technical: ['ts-lead'] } };

async function person(browser, account) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.addInitScript(() => {
    window.__posted = [];
    window.APB_HOST = { kind: 'vscode', version: 'test', storage: {} };
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), setState() {}, getState() {} });
  });
  await p.goto(APP);
  await p.waitForFunction(() => window.APB && APB.gov);
  await p.evaluate((m) => window.postMessage(m, '*'), { type: 'auth', signedIn: true, account: account, copilot: true, policy: POLICY });
  await p.waitForTimeout(150);
  return p;
}
/* the last file saved through VS Code's save dialog */
async function lastSaved(p) {
  const m = await p.evaluate(() => window.__posted.filter((x) => x.type === 'save-file').pop());
  return { name: m.name, buffer: Buffer.from(m.base64, 'base64'), mimeType: 'text/markdown' };
}
const upload = (p, file) => p.setInputFiles('#md-upload', file).then(() => p.waitForTimeout(400));
const state = (p) => p.evaluate(() => ({ id: APB.state.get().id, kind: APB.state.get().kind, title: APB.state.get().context && APB.state.get().context.title, status: APB.gov.status(APB.state.get()).state, drafts: APB.storage.list().length }));

test('author requests approval by file, approver approves and sends it back, the author\'s draft is replaced', async () => {
  const browser = await chromium.launch();
  try {
    // author writes an FS
    const author = await person(browser, 'analyst');
    await author.click('[data-mode="fs"]');
    await author.click('[data-action="examples"]');
    await author.locator('#examples-dialog [data-action="load-example"]').first().click();
    await author.evaluate(() => { APB.state.set('context.title', 'Off-cycle payroll entries'); APB.ui.ui.step = 3; APB.ui.renderMain(); });
    const mine = await state(author);
    assert.match(await author.locator('.gov-card').innerText(), /Waiting for approval by: fs-lead/);

    await author.click('[data-action="gov-request"]');
    await author.waitForTimeout(300);
    const request = await lastSaved(author);
    assert.match(request.name, /^FS_Off_cycle_payroll_entries_FOR-APPROVAL\.md$/);
    assert.match(await author.locator('#toast').innerText(), /attach it to an email or Teams message to fs-lead/);
    assert.ok(await author.evaluate(() => window.__posted.some((m) => m.type === 'clipboard-write' && /Please review and approve/.test(m.text))));
    assert.match(await author.locator('.gov-card').innerText(), /Approval requested by analyst/);

    // approver opens the attachment
    const approver = await person(browser, 'FS-Lead');
    await upload(approver, request);
    const theirs = await state(approver);
    assert.strictEqual(theirs.title, 'Off-cycle payroll entries');
    assert.strictEqual(theirs.id, mine.id, 'same spec identity travels with the file');
    assert.match(await approver.locator('#toast').innerText(), /Approval requested by analyst/);
    await approver.locator('#toast .toast-btn').click();
    await approver.waitForTimeout(200);
    await approver.click('[data-action="gov-approve"]');
    assert.strictEqual((await state(approver)).status, 'approved');
    await approver.click('[data-action="gov-send-back"]');
    await approver.waitForTimeout(300);
    const approved = await lastSaved(approver);
    assert.match(approved.name, /_APPROVED\.md$/);

    // author opens the approved file: replaces the draft (no duplicate), gate open
    const before = (await state(author)).drafts;
    await upload(author, approved);
    const after = await state(author);
    assert.strictEqual(after.id, mine.id);
    assert.strictEqual(after.status, 'approved');
    assert.strictEqual(after.drafts, before, 'no second draft');
    assert.match(await author.locator('#toast').innerText(), /replaced your draft of this spec \(approved ✓\)/);
    assert.ok(await author.evaluate(() => APB.gov.gate('G1', APB.state.get()).open));
    const trail = await author.evaluate(() => APB.state.get().audit.map((e) => e.type + ':' + e.by));
    assert.ok(trail.includes('approval-requested:analyst') && trail.includes('approved:FS-Lead'), trail.join(' '));

    // Undo brings the unapproved draft back
    await author.locator('#toast .toast-btn').click();
    await author.waitForTimeout(200);
    assert.strictEqual((await state(author)).status, 'none');

    assert.deepStrictEqual(author.errors.concat(approver.errors), []);
  } finally {
    await browser.close();
  }
});
