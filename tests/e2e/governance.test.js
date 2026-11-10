/* End-to-end: approval gates G1/G2 and the audit trail in the built single-file app, with a simulated VS Code host.
   Run: node scripts/build-single.js && node --test tests/e2e/*.test.js */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chromium } = require('playwright');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
const policy = (o) => Object.assign({ gates: 'enforce', requireSapCheck: true, approvers: { functional: ['fs-lead'], technical: ['ts-lead'] } }, o || {});

async function open(browser, opts) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  if (opts.vscode) {
    await p.addInitScript(() => {
      window.__posted = [];
      window.APB_HOST = { kind: 'vscode', version: 'test', storage: {} };
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), setState() {}, getState() {} });
    });
  }
  await p.goto(APP);
  await p.waitForFunction(() => window.APB && APB.gov && APB.state);
  p.errors = errors;
  p.auth = async (account, pol) => { await p.evaluate((m) => window.postMessage(m, '*'), { type: 'auth', signedIn: !!account, account: account || '', copilot: true, policy: pol }); await p.waitForTimeout(150); };
  return p;
}

async function fsExample(p) {
  await p.click('[data-mode="fs"]');
  await p.click('[data-action="examples"]');
  await p.locator('#examples-dialog [data-action="load-example"]').first().click();
  await p.waitForTimeout(200);
}
const fsAct = (p, name) => p.evaluate((n) => APB.fsApp.actions[n](), name);
const kind = (p) => p.evaluate(() => APB.state.get().kind || 'dev');
const types = (p) => p.evaluate(() => (APB.state.get().audit || []).map((e) => e.type));

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

test('G1 enforced: hand-off blocked until an approver approves; a change closes the gate again', async () => {
  const p = await open(browser, { vscode: true });
  await p.auth('someone', policy());
  await fsExample(p);
  await fsAct(p, 'fs-handoff-all');
  assert.strictEqual(await kind(p), 'fs', 'still on the FS: blocked');
  assert.ok((await types(p)).includes('gate-blocked'));
  assert.match(await p.locator('#toast').innerText(), /not approved/);

  // non-approver: no Approve button, waiting list shown
  await p.evaluate(() => { APB.ui.ui.step = 3; APB.ui.renderMain(); });
  assert.strictEqual(await p.locator('[data-action="gov-approve"]').count(), 0);
  assert.match(await p.locator('.gov-card').innerText(), /Waiting for approval by: fs-lead/);

  // approver (case-insensitive)
  await p.auth('FS-Lead', policy());
  await p.click('[data-action="gov-approve"]');
  assert.strictEqual(await p.evaluate(() => APB.gov.status(APB.state.get()).state), 'approved');
  assert.match(await p.locator('.gov-card').innerText(), /Approved by FS-Lead/);
  // stored and reloaded: still approved
  assert.strictEqual(await p.evaluate(() => APB.gov.status(APB.state.migrate(JSON.parse(JSON.stringify(APB.state.get())))).state), 'approved');

  // edit → changed → blocked again
  await p.evaluate(() => APB.state.set('context.title', 'Changed after approval'));
  assert.strictEqual(await p.evaluate(() => APB.gov.status(APB.state.get()).state), 'changed');
  await fsAct(p, 'fs-handoff-all');
  assert.strictEqual(await kind(p), 'fs');

  // re-approve → hand-off opens the Technical spec, with the trail on both sides
  await p.evaluate(() => { APB.ui.renderMain(); });
  await p.click('[data-action="gov-approve"]');
  await fsAct(p, 'fs-handoff-all');
  assert.notStrictEqual(await kind(p), 'fs', 'Technical spec opened');
  assert.ok((await types(p)).includes('created-from'));
  assert.deepStrictEqual(p.errors, []);
  await p.close();
});

test('G2: dewa-abap is blocked until the TS is approved, and approval needs the SAP check', async () => {
  const p = await open(browser, { vscode: true });
  await p.auth('ts-lead', policy());
  await p.click('[data-action="examples"]');
  await p.locator('#examples-dialog [data-action="load-example"]').first().click();
  await p.waitForTimeout(200);
  await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
  assert.strictEqual(await p.evaluate(() => window.__posted.filter((m) => m.type === 'open-chat').length), 0, 'no hand-off to dewa-abap');
  assert.ok((await types(p)).includes('gate-blocked'));

  // approval blocked without the SAP check
  await p.evaluate(() => { APB.ui.ui.step = 5; APB.ui.renderMain(); });
  assert.match(await p.locator('.gov-card').innerText(), /Check & read in SAP/);
  assert.ok(await p.locator('.gov-card button[disabled]').count());

  // with requireSapCheck off it can be approved, and the hand-off goes through
  await p.auth('ts-lead', policy({ requireSapCheck: false }));
  await p.evaluate(() => APB.ui.renderMain());
  await p.click('[data-action="gov-approve"]');
  await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
  assert.strictEqual(await p.evaluate(() => window.__posted.filter((m) => m.type === 'open-chat' && m.agent === 'dewa-abap').length), 1);
  // audit lines are mirrored to the extension
  assert.ok(await p.evaluate(() => window.__posted.some((m) => m.type === 'audit' && m.entry.type === 'export')));
  // the Markdown has the approval and the trail
  const md = await p.evaluate(() => APB.markdown.build(APB.state.get()));
  assert.match(md, /Approval & Audit Trail/);
  assert.match(md, /\*\*Approval:\*\* approved · by ts-lead/);
  assert.doesNotMatch(md, /STOP: this specification/);
  assert.deepStrictEqual(p.errors, []);
  await p.close();
});

test('warn mode: "Continue anyway" proceeds and records an override; the browser only warns', async () => {
  const p = await open(browser, { vscode: true });
  await p.auth('someone', policy({ gates: 'warn' }));
  await fsExample(p);
  await p.evaluate(() => APB.state.set('context.title', 'My FS')); // an edited example is kept as a draft
  await fsAct(p, 'fs-handoff-all');
  assert.strictEqual(await kind(p), 'fs');
  await p.locator('#toast .toast-btn').click();
  await p.waitForTimeout(200);
  assert.notStrictEqual(await kind(p), 'fs');
  const fsTrail = await p.evaluate(() => APB.storage.list().map((d) => d.state).filter((s) => s.kind === 'fs').map((s) => (s.audit || []).map((e) => e.type)));
  assert.ok(fsTrail.some((t) => t.includes('gate-override')), 'override recorded on the FS');
  await p.close();

  const b = await open(browser, { vscode: false });
  assert.strictEqual(await b.evaluate(() => APB.gov.mode()), 'warn');
  await fsExample(b);
  await b.evaluate(() => { APB.ui.ui.step = 3; APB.ui.renderMain(); });
  assert.match(await b.locator('.gov-card').innerText(), /needs the VS Code extension/);
  assert.deepStrictEqual(b.errors, []);
  await b.close();
});
