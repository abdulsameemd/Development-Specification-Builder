'use strict';
// Approval gates and audit trail (js/governance.js) on the builder's own scripts in a VM.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function load(vscode) {
  const window = {};
  const posted = [];
  if (vscode) { window.APB_HOST = { kind: 'vscode', storage: {} }; window.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) }); }
  const ctx = vm.createContext({ window, console, Date, JSON, Math, addEventListener() {} });
  ctx.window.addEventListener = function () {};
  ['config-bundle', 'host', 'governance', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator', 'fs-state']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
  return { APB: window.APB, posted };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the fingerprint covers the content only and ignores key order, ids and the approval bookkeeping', () => {
  const { APB } = load();
  const G = APB.gov;
  const a = { kind: 'fs', id: 'x1', context: { title: 'A', module: 'FI/CO' }, control: { status: 'draft' }, meta: { updated: 1 } };
  const b = { meta: { updated: 2 }, control: { status: 'approved', approvals: [{ name: 'alice' }] }, context: { module: 'FI/CO', title: 'A' }, id: 'x2', kind: 'fs', audit: [{ type: 'x' }] };
  assert.strictEqual(G.fingerprint(a), G.fingerprint(b));
  assert.notStrictEqual(G.fingerprint(a), G.fingerprint(Object.assign({}, a, { context: { title: 'B', module: 'FI/CO' } })));
  assert.match(G.fingerprint(a), /^[0-9a-f]{16}$/);
});

test('approve → approved; any change afterwards → changed, and the gate closes again', () => {
  const { APB } = load(true);
  const G = APB.gov;
  G.setFromAuth({ signedIn: true, account: 'Alice', policy: { approvers: { functional: ['alice'], technical: [] } } });
  assert.strictEqual(G.mode(), 'enforce');
  assert.ok(G.canApprove('functional'));
  assert.ok(!G.canApprove('technical'));
  const s = APB.fs.model.blank();
  s.context.requirement = 'Vendor ageing';
  assert.strictEqual(G.gate('G1', s).open, false);
  const ok = G.approve(s);
  assert.strictEqual(G.status(ok).state, 'approved');
  assert.strictEqual(ok.control.status, 'approved');
  assert.strictEqual(ok.control.approvals[0].name, 'Alice');
  assert.strictEqual(G.gate('G1', ok).open, true);
  assert.strictEqual(s.approval, null); // the input is not changed
  ok.context.requirement = 'Vendor ageing, changed';
  assert.strictEqual(G.status(ok).state, 'changed');
  assert.match(G.gate('G1', ok).reason, /changed after it was approved/);
  // survives save / load
  const back = APB.fs.model.migrate(JSON.parse(JSON.stringify(G.approve(s))));
  assert.strictEqual(G.status(back).state, 'approved');
});

test('policy: warn mode, the browser (no identity) and the SAP-check requirement for technical specs', () => {
  let { APB } = load(true);
  APB.gov.setFromAuth({ signedIn: true, account: 'bob', policy: { gates: 'warn', approvers: { technical: ['bob'] } } });
  assert.strictEqual(APB.gov.mode(), 'warn');
  const ts = APB.state.blank();
  ts.objects = [{ type: 'Table', name: 'BSIK', status: 'existing', purpose: '', detail: {} }];
  assert.match(APB.gov.approvalBlockers(APB.state.migrate(ts))[0], /Run Check & read in SAP/);
  ts.sapCheck = { at: 1, system: 'DEMO', results: [{ name: 'BSIK', result: 'verified' }] };
  assert.deepStrictEqual(plain(APB.gov.approvalBlockers(APB.state.migrate(ts))), []);
  ts.sapCheck.results[0].result = 'missing';
  assert.match(APB.gov.approvalBlockers(APB.state.migrate(ts))[0], /Resolve the SAP check findings/);
  ({ APB } = load(false));
  APB.gov.setFromAuth({ signedIn: true, account: 'bob', policy: { approvers: { technical: ['bob'] } } });
  assert.strictEqual(APB.gov.mode(), 'warn'); // a browser cannot enforce
  assert.ok(!APB.gov.canApprove('technical')); // and nobody can approve without the extension
});

test('audit trail: append-only entries, posted to the extension, capped, and in the documents', () => {
  const { APB, posted } = load(true);
  const G = APB.gov;
  G.setFromAuth({ signedIn: true, account: 'alice', policy: {} });
  const s = APB.state.blank();
  s.requirement.text = 'Vendor ageing';
  G.audit.add(s, 'ai-start', { job: 'docs' });
  G.audit.add(s, 'gate-blocked', { gate: 'G2', reason: 'not approved' });
  assert.deepStrictEqual(plain(s.audit.map((e) => e.type)), ['ai-start', 'gate-blocked']);
  assert.strictEqual(s.audit[0].by, 'alice');
  assert.ok(posted.some((m) => m.type === 'audit' && m.entry.type === 'gate-blocked'));
  for (let i = 0; i < 600; i++) G.audit.add(s, 'export', { n: i });
  assert.ok(s.audit.length <= 500);
  assert.strictEqual(s.audit[0].type, 'trimmed');
  const md = APB.markdown.build(APB.state.migrate(s));
  assert.match(md, /## \d+\. Approval & Audit Trail/);
  assert.match(md, /Approval:\*\* not approved yet/);
  assert.match(md, /STOP: this specification is not approved/); // dewa-abap is told not to build
  assert.match(md, /\| Time \(UTC\) \| By \| Event \| Details \|/);
});

test('an approval request stays open until the spec is approved, and a new request after a change opens again', () => {
  const { APB } = load(true);
  const G = APB.gov;
  G.setFromAuth({ signedIn: true, account: 'lead', policy: { gates: 'enforce', requireSapCheck: false, approvers: { functional: ['lead'], technical: ['lead'] } } });
  let s = APB.state.migrate({ requirement: { text: 'Vendor ageing' } });
  assert.strictEqual(G.requestOf(s), null);
  G.audit.add(s, 'approval-requested', { to: ['lead'] });
  assert.strictEqual(G.requestOf(s).data.to[0], 'lead');
  s = G.approve(s);
  G.audit.add(s, 'approved', {});
  assert.strictEqual(G.requestOf(s), null);
  s.requirement.text = 'Vendor ageing, changed';
  assert.strictEqual(G.status(s).state, 'changed');
  assert.strictEqual(G.requestOf(s), null, 'the old request was answered');
  G.audit.add(s, 'approval-requested', { to: ['lead'] });
  assert.ok(G.requestOf(s));
  assert.strictEqual(G.audit.LABELS['approval-requested'], 'Approval requested');
});

test('audit trail in the documents: readable details per event and an AI usage summary', () => {
  const { APB } = load();
  const G = APB.gov, s = APB.state.migrate({ requirement: { text: 'x' } });
  G.audit.add(s, 'ai-end', { job: 'docs', outcome: 'result', seconds: 94, model: 'GPT-5', tokensIn: 39000, tokensOut: 3300, modelCalls: 4, sapSearches: 6, artifactsRead: 2, artifacts: 'ZHR_A, ZHR_B' });
  G.audit.add(s, 'ai-end', { job: 'devctx', outcome: 'error', seconds: 10, tokensIn: 1000, tokensOut: 0, modelCalls: 1, tokensEstimated: 'yes', sapBlocked: '3 refused – SBE_210' });
  G.audit.add(s, 'masked', { job: 'read-program', items: 2, kinds: 'EMAIL, PHONE' });
  const md = G.audit.md(s);
  assert.match(md, /\*\*AI usage\*\*\n\n\| AI job \| Runs \| Time \| Model calls \| Tokens \(in \/ out\) \| SAP searches \| ABAP artifacts read \|/);
  assert.match(md, /\| Read BRD \/ solution document \| 1 \(1 with result\) \| 94 s \| 4 \| 42,300 \(39,000 \/ 3,300\) \| 6 \| 2 \|/);
  assert.match(md, /\| \*\*Total\*\* \| 2 \(1 with result\) \| 104 s \| 5 \| ≈ 43,300 \(40,000 \/ 3,300\) \| 6 \| 2 \|/);
  assert.match(md, /\| AI job finished \| Read BRD \/ solution document: result received · 94 s · model GPT-5 · 4 model calls · 42,300 tokens \(39,000 in \/ 3,300 out\) · 6 SAP searches · 2 ABAP artifacts read: ZHR_A, ZHR_B \|/);
  assert.match(md, /Check & read in SAP: failed · 10 s · 1 model call · ≈ 1,000 tokens \(1,000 in \/ 0 out\) · SAP refused: 3 refused – SBE_210/);
  assert.match(md, /2 personal data items masked \(EMAIL, PHONE\) · Copilot job reading SAP/);
  assert.ok(!/tokensIn|artifactsRead/.test(md), 'no raw field names');
});
