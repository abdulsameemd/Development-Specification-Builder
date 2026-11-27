/* End-to-end journeys, SAP and non-SAP: a real uploaded document (Word / Excel / PDF) → "Generate FS from the
   documents" → review → FS document and Word file → Create Technical spec → (SAP check) → Complete the TS with
   Copilot → TS document → hand-off to the right Copilot agent. Also the browser (copy / paste) path, the upload
   round trip and the approval gates.
   Copilot and SAP do not run here: their answers are simulated at the exact messages the VS Code extension sends
   back (draft-result, devctx-result, tsdraft-result). Everything else is the real builder. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const F = require('./fixtures/docs');

const APP = 'file://' + path.resolve(__dirname, '../../dist/SAP-Development-Specification-Builder.html');
const NO_EV = { calls: [], names: [], flags: 0, masked: 0 };
const json = (o) => 'Summary.\n```json\n' + JSON.stringify(o) + '\n```';

async function open(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: opts.vscode === false ? ['clipboard-read', 'clipboard-write'] : [] });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  if (opts.vscode !== false) {
    await p.addInitScript(() => {
      window.__posted = [];
      window.APB_HOST = { kind: 'vscode', version: 'test', storage: {} };
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), setState() {}, getState() {} });
    });
  }
  await p.goto(APP);
  await p.waitForFunction(() => window.APB && APB.fsApp && APB.tsDraft);
  if (opts.vscode !== false) await send(p, { type: 'auth', signedIn: true, account: opts.account || 'dev', copilot: true, policy: opts.policy || { gates: 'warn' } });
  return p;
}
const send = (p, m) => p.evaluate((m) => window.postMessage(m, '*'), m);
const posted = (p, type) => p.evaluate((t) => window.__posted.filter((m) => m.type === t), type);
const last = async (p, type) => (await posted(p, type)).pop();
const st = (p) => p.evaluate(() => APB.state.get());
async function waitPosted(p, type, n) { await p.waitForFunction(([t, k]) => window.__posted.filter((m) => m.type === t).length >= k, [type, n || 1]); return last(p, type); }
async function fsSystem(p, system, extra) {
  await p.click('[data-mode="fs"]');
  await p.evaluate(([sys, x]) => { APB.state.set('context.system', sys); Object.keys(x || {}).forEach((k) => APB.state.set('context.' + k, x[k])); APB.ui.renderMain(); }, [system, extra]);
}
async function uploadDoc(p, role, name, mime, buffer) {
  await p.setInputFiles('#fs-doc-' + role, { name, mimeType: mime, buffer });
  await p.waitForFunction((r) => !!document.querySelector('#fs-doc-' + r) && /characters/.test((document.querySelector('#fs-doc-' + r).closest('.fs-doc-slot') || {}).textContent || ''), role);
}
/* a gate under the warn policy: the toast offers "Continue anyway" */
async function continueGate(p) { const b = p.locator('#toast .toast-btn'); await b.waitFor(); assert.match(await b.innerText(), /Continue anyway/); await b.click(); }
async function applyDialog(p, sel, apply) { await p.waitForSelector(sel + '[open]'); await p.click('[data-action="' + apply + '"]'); await p.waitForTimeout(150); }
/* a file saved through VS Code's save dialog → Buffer */
async function saved(p, re) {
  await p.waitForFunction((r) => window.__posted.some((m) => m.type === 'save-file' && new RegExp(r).test(m.name)), re.source);
  const m = (await posted(p, 'save-file')).filter((x) => re.test(x.name)).pop();
  return { name: m.name, buffer: Buffer.from(m.base64, 'base64') };
}
/* one entry of a .docx / zip */
function unzipEntry(buf, name) {
  let i = 0;
  while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i)) >= 0) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const n = buf.slice(i + 30, i + 30 + nlen).toString();
    const data = buf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (n === name) return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    i += 30 + nlen + xlen + size;
  }
  return null;
}
const wordText = (buf) => (unzipEntry(buf, 'word/document.xml') || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
async function fsStep(p, n) { await p.evaluate((k) => { APB.ui.ui.step = k; APB.ui.ui.generated = false; APB.ui.renderMain(); }, n); }

/* ---------------------------------------------------------------- content */
const ALV_BRD = F.docx([
  ['h1', 'Business Requirement Document – Open sales orders'],
  ['p', 'Sales managers need a simple ALV list of open sales orders per sales organization, with customer and net value.'],
  ['h2', 'Requirements'],
  ['table', [['ID', 'Requirement', 'Priority'], ['BR-01', 'List open sales orders per sales organization', 'High'], ['BR-02', 'Show customer and net value per order', 'Medium']]]
]);
const FS_ALV = { kind: 'fs-draft', version: 1, title: 'Open sales orders report', requirement: 'Sales managers need a list of open sales orders per sales organization.', module: 'SD', changeType: 'new',
  frs: [{ title: 'BR-01 List open sales orders', priority: 'must', fit: 'custom', description: 'Per sales organization', acceptance: ['When I enter sales org 1000, then its open orders are listed'] },
    { title: 'BR-02 Show customer and net value', priority: 'should', fit: 'custom', description: 'Columns customer, net value', acceptance: ['When the list is shown, then each row has customer and net value'] }],
  rules: [{ rule: 'Only orders not fully delivered', type: 'validation', outcome: 'excluded otherwise', fr: 'FR-01' }],
  data: [{ field: 'Sales organization', table: 'VBAK', sapField: 'VKORG', validation: 'mandatory', usage: 'selection' },
    { field: 'Sales order', table: 'VBAK', sapField: 'VBELN', validation: '', usage: 'output' },
    { field: 'Customer', table: 'VBAK', sapField: 'KUNNR', validation: '', usage: 'both' },
    { field: 'Net value', table: 'VBAK', sapField: 'NETWR', validation: '', usage: 'output' }],
  ricefw: [{ type: 'report', name: '', description: 'Open sales orders ALV report', frs: 'FR-01, FR-02', existing: '', complexity: 'low' }],
  uat: [{ fr: 'FR-01', scenario: 'Sales org 1000 with 3 open orders', type: 'positive', expected: '3 rows' }] };

test('S1 SAP – new ALV report from a Word BRD: quick search → FS → Word → TS (selection, ALV, auth No) → SAP check → completion → dewa-abap', async () => {
  const browser = await chromium.launch();
  try {
    const p = await open(browser);
    await fsSystem(p, 'sap', { module: 'SD' });
    await uploadDoc(p, 'brd', 'BRD_Open_Orders.docx', F.DOCX_MIME, ALV_BRD);
    assert.match(await p.locator('.fs-doc-slot').first().innerText(), /BRD_Open_Orders\.docx/);
    assert.match(await p.locator('.fs-depth-note').innerText(), /^Auto → Quick/);
    await p.click('[data-action="fs-docs-auto"]');
    const ph1 = await waitPosted(p, 'read-program');
    assert.deepStrictEqual([ph1.maxRounds, ph1.budgetSeconds], [3, 90]);
    assert.match(ph1.prompt, /QUICK SAP SEARCH/);
    assert.match(ph1.prompt, /List open sales orders per sales organization/, 'the Word table was read');
    await send(p, { type: 'draft-result', text: json({ kind: 'fs-draft', version: 1, module: 'SD', changeType: 'new', candidates: [] }), evidence: Object.assign({ searches: 2, artifacts: [] }, NO_EV) });
    const ph2 = await waitPosted(p, 'draft');
    assert.match(ph2.prompt, /^FS-DRAFT v1/);
    assert.match(ph2.prompt, /Show customer and net value per order/, 'full document in the writing step');
    await send(p, { type: 'draft-result', text: json(FS_ALV), evidence: NO_EV });
    await applyDialog(p, '#draft-dialog', 'fs-draft-apply');
    let fs = await st(p);
    assert.strictEqual(fs.reqs.frs.length, 2);
    assert.deepStrictEqual(fs.reqs.data.map((d) => d.usage), ['selection', 'output', 'both', 'output']);
    assert.strictEqual(fs.solution.ricefw[0].type, 'report');
    assert.match(await p.locator('.fs-log').innerText(), /SAP search \(quick\) done in \d+ s[\s\S]*FS written in \d+ s/);

    // FS document + Word
    const fsMd = await p.evaluate(() => APB.fsMarkdown.build(APB.state.get()));
    assert.match(fsMd, /\| Sales organization \| VBAK \| VKORG \| No \| mandatory \| Selection \(input\) \|/);
    assert.match(fsMd, /RICEFW items/);
    await p.evaluate(() => APB.fsApp.actions['fs-docx']());
    const word = await saved(p, /\.docx$/);
    const wt = wordText(word.buffer);
    assert.match(wt, /Open sales orders report/);
    assert.match(wt, /Selection \(input\)/);

    // hand-off (gate G1 under warn) → TS
    await fsStep(p, 3);
    await p.click('[data-action="fs-handoff"][data-i="0"]');
    await continueGate(p);
    const dev = await waitPosted(p, 'read-dev');
    let ts = await st(p);
    const main = ts.objects[0];
    assert.deepStrictEqual([main.type, main.name, main.status], ['Report', 'ZSD_OPEN_SALES_ORDERS_ALV', 'new']);
    assert.deepStrictEqual(main.detail.selection.map((r) => r.name), ['S_VKORG', 'S_KUNNR']);
    assert.deepStrictEqual(main.detail.columns.map((c) => c.source), ['VBAK-VBELN', 'VBAK-KUNNR', 'VBAK-NETWR']);
    assert.deepStrictEqual(main.detail.outputType, ['ALV (CL_SALV_TABLE)']);
    assert.strictEqual(ts.quality.authorization, 'no');
    assert.match(dev.prompt, /Fields used in the design \(TABLE-FIELD\)/);
    assert.strictEqual((await posted(p, 'ts-draft')).length, 0);

    await send(p, { type: 'devctx-result', text: json({ kind: 'dewa-dev-context', version: 1, checked: [{ name: 'ZSD_OPEN_SALES_ORDERS_ALV', result: 'missing' }], objects: [], notFound: ['VBAK-NETWR'] }), evidence: NO_EV });
    await applyDialog(p, '#devctx-dialog', 'devctx-apply');
    const td = await waitPosted(p, 'ts-draft');
    assert.match(td.prompt, /^TS-DRAFT v1/);
    await send(p, { type: 'tsdraft-result', text: json({ kind: 'dewa-ts-draft', version: 1,
      objects: [{ name: 'ZSD_OPEN_SALES_ORDERS_ALV', type: 'Report', detail: { logic: '1. Select VBAK where VBAK-VKORG in S_VKORG and VBUK-GBSTK <> C\n2. Display with CL_SALV_TABLE', background: 'no' } }],
      quality: { dataVolume: 'medium', testScenarios: 'Sales org 1000 => open orders listed' }, expectedOutput: 'ALV list of open orders', openQuestions: ['Which delivery status counts as open?'] }), evidence: NO_EV });
    await applyDialog(p, '#tsd-dialog', 'tsd-apply');
    ts = await st(p);
    assert.match(ts.objects[0].detail.columns[2].source, /^\[TO BE CONFIRMED\] VBAK-NETWR$/, 'SAP check marked the missing field');
    assert.match(ts.objects[0].detail.logic, /\[TO BE CONFIRMED\] VBUK-GBSTK/, 'invented field marked');
    assert.strictEqual(ts.quality.authorization, 'no');
    const tsMd = await p.evaluate(() => APB.markdown.build(APB.state.get()));
    assert.match(tsMd, /^# SAP Development Specification/);
    assert.match(tsMd, /## \d+\. Design Sources/);
    assert.match(tsMd, /S_VKORG/);
    await p.evaluate(() => document.querySelector('[data-action="download"]').click());
    const tsFile = await saved(p, /^BUSINESS_REQUIREMENTS\.md$/);
    assert.match(tsFile.buffer.toString(), /Design Sources/);

    // hand-off to dewa-abap (gate G2 under warn)
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await continueGate(p);
    const chat = await waitPosted(p, 'open-chat');
    assert.strictEqual(chat.agent, 'dewa-abap');
    assert.match(chat.prompt, /^Implement the SAP development specification below/);
    const audit = (await st(p)).audit.map((e) => e.type + ':' + (e.data.job || e.data.gate || ''));
    assert.ok(['created-from:', 'ai-input:tsdraft', 'review:tsdraft', 'review:devctx', 'gate-override:G2'].every((x) => audit.includes(x)), audit.join(' '));
    assert.deepStrictEqual(p.errors, []);
  } finally { await browser.close(); }
});

test('S2 SAP – enhancement from a Word BRD + Excel solution document naming a ZSD_ program: full search → change → dewa-abap-change', async () => {
  const browser = await chromium.launch();
  try {
    const p = await open(browser);
    await fsSystem(p, 'sap', { module: 'SD' });
    await uploadDoc(p, 'brd', 'BRD_Change.docx', F.DOCX_MIME, F.docx([['h1', 'Change request'], ['p', 'Add the delivery date column to the existing open orders report.']]));
    await uploadDoc(p, 'solution', 'Solution.xlsx', F.XLSX_MIME, F.xlsx('Objects', [['Object', 'Change'], ['ZSD_OPEN_ORDERS_OLD', 'Add column delivery date (VBAK-VDATU)']]));
    assert.match(await p.locator('.fs-depth-note').innerText(), /^Auto → Full \(the documents name SAP objects \(ZSD_OPEN_ORDERS_OLD/);
    await p.click('[data-action="fs-docs-auto"]');
    const ph1 = await waitPosted(p, 'read-program');
    assert.strictEqual(ph1.maxRounds, 8);
    assert.match(ph1.prompt, /SEARCH THE SAP SYSTEM BY PROCESS/);
    assert.match(ph1.prompt, /ZSD_OPEN_ORDERS_OLD \| Add column delivery date/, 'the Excel sheet was read');
    await send(p, { type: 'draft-result', text: json({ kind: 'fs-draft', version: 1, module: 'SD', changeType: 'enhancement', changeNote: 'ZSD_OPEN_ORDERS_OLD exists',
      objects: [{ type: 'PROG', name: 'ZSD_OPEN_ORDERS_OLD', note: 'exists in SAP' }], programs: [{ type: 'PROG', name: 'ZSD_OPEN_ORDERS_OLD', description: 'Open orders list', role: 'main' }], currentLogic: 'Lists open orders.' }), evidence: NO_EV });
    await waitPosted(p, 'draft');
    await send(p, { type: 'draft-result', text: json({ kind: 'fs-draft', version: 1, title: 'Delivery date in open orders report', requirement: 'Add the delivery date column.',
      frs: [{ title: 'BR-01 Show delivery date', priority: 'must', fit: 'custom', acceptance: ['When the report runs, then the delivery date is shown'] }],
      data: [{ field: 'Delivery date', table: 'VBAK', sapField: 'VDATU', usage: 'output' }],
      ricefw: [{ type: 'report', name: 'ZSD_OPEN_ORDERS_OLD', description: 'Add delivery date column', frs: 'FR-01', existing: 'ZSD_OPEN_ORDERS_OLD' }] }), evidence: NO_EV });
    await applyDialog(p, '#draft-dialog', 'fs-draft-apply');
    const fs = await st(p);
    assert.strictEqual(fs.context.changeType, 'enhancement');
    await fsStep(p, 3);
    await p.click('[data-action="fs-handoff"][data-i="0"]');
    await continueGate(p);
    await waitPosted(p, 'read-dev');
    let ts = await st(p);
    assert.deepStrictEqual([ts.objects[0].name, ts.objects[0].status], ['ZSD_OPEN_ORDERS_OLD', 'change']);
    await send(p, { type: 'devctx-result', text: json({ kind: 'dewa-dev-context', version: 1, checked: [{ name: 'ZSD_OPEN_ORDERS_OLD', type: 'Report', result: 'verified', description: 'Open orders list' }],
      objects: [{ name: 'ZSD_OPEN_ORDERS_OLD', type: 'Report', summary: 'Lists open orders per sales org.', detail: { logic: 'SELECT from VBAK' }, uses: ['VBAK'], usedBy: [] }], notFound: [] }), evidence: NO_EV });
    await applyDialog(p, '#devctx-dialog', 'devctx-apply');
    await waitPosted(p, 'ts-draft');
    await send(p, { type: 'tsdraft-result', text: json({ kind: 'dewa-ts-draft', version: 1, objects: [{ name: 'ZSD_OPEN_ORDERS_OLD', type: 'Report', detail: { logic: 'Add VBAK-VDATU to the output structure and the ALV field catalog.' } }], openQuestions: [] }), evidence: NO_EV });
    await applyDialog(p, '#tsd-dialog', 'tsd-apply');
    ts = await st(p);
    assert.ok(ts.objects[0].sap && /Lists open orders/.test(ts.objects[0].sap.summary), 'current state from SAP kept');
    assert.match(ts.objects[0].detail.logic, /VBAK-VDATU/);
    assert.doesNotMatch(ts.objects[0].detail.logic, /TO BE CONFIRMED/, 'VBAK-VDATU is in the FS → confirmed');
    assert.match(await p.evaluate(() => APB.markdown.build(APB.state.get())), /Current State in SAP/);
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await continueGate(p);
    const chat = await waitPosted(p, 'open-chat');
    assert.strictEqual(chat.agent, 'dewa-abap-change');
    assert.match(chat.prompt, /^DEWA-ABAP-CHANGE v1/);
    assert.deepStrictEqual(p.errors, []);
  } finally { await browser.close(); }
});

test('S3 SAP – PDF solution document, search skipped: report + Fiori app → Create all → Fiori TS: build or review', async () => {
  const browser = await chromium.launch();
  try {
    const p = await open(browser);
    await fsSystem(p, 'sap', { module: 'SD' });
    await uploadDoc(p, 'solution', 'Solution.pdf', 'application/pdf', F.pdf(['Billing block rules', 'Maintain rules per sales org in a Fiori app', 'Daily report of blocked orders']));
    await p.click('[data-action="fs-docs-depth"][data-depth="skip"]');
    await p.click('[data-action="fs-docs-auto"]');
    const d = await waitPosted(p, 'draft');
    assert.strictEqual((await posted(p, 'read-program')).length, 0, 'no SAP job');
    assert.match(d.prompt, /Maintain rules per sales org in a Fiori app/, 'the PDF text was read');
    await send(p, { type: 'draft-result', text: json({ kind: 'fs-draft', version: 1, title: 'Billing block rules', requirement: 'Maintain billing block rules and report blocked orders.',
      frs: [{ title: 'BR-01 Maintain rules', priority: 'must', fit: 'custom' }, { title: 'BR-02 Report blocked orders', priority: 'must', fit: 'custom' }],
      data: [{ field: 'Sales organization', table: 'ZSD_BB_RULE', sapField: 'VKORG', usage: 'selection' }, { field: 'Block reason', table: 'ZSD_BB_RULE', sapField: 'FAKSK', usage: 'output' }],
      ricefw: [{ type: 'report', description: 'Daily report of blocked orders', frs: 'FR-02' }, { type: 'fiori', description: 'Billing block rules app', frs: 'FR-01' }] }), evidence: NO_EV });
    await applyDialog(p, '#draft-dialog', 'fs-draft-apply');
    assert.match(await p.locator('.fs-log').innerText(), /SAP search skipped/);
    await fsStep(p, 3);
    await p.click('[data-action="fs-handoff-all"]');
    await continueGate(p);
    await waitPosted(p, 'read-dev');
    const drafts = await p.evaluate(() => APB.storage.list().map((x) => APB.storage.load(x.id)).filter((x) => x && x.kind !== 'fs').map((x) => ({ id: x.id, types: x.types, main: x.objects[0] && x.objects[0].type })));
    assert.ok(drafts.some((x) => x.main === 'Report') && drafts.some((x) => x.main === 'Fiori/UI5'), JSON.stringify(drafts));
    const fiori = drafts.find((x) => x.main === 'Fiori/UI5');
    await p.evaluate((id) => APB.ui.loadState(APB.storage.load(id), 'opened'), fiori.id);
    const ts = await st(p);
    assert.deepStrictEqual(ts.objects[0].detail.filters.map((f) => f.field), ['VKORG']);
    assert.deepStrictEqual(ts.objects[0].detail.columns.map((c) => c.field), ['FAKSK']);
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await continueGate(p);
    await p.waitForSelector('#handoff-dialog[open]');
    assert.ok(await p.locator('[data-action="handoff-fiori"]').isVisible() && await p.locator('[data-action="handoff-fiori-review"]').isVisible());
    await p.click('[data-action="handoff-fiori"]');
    let chat = await waitPosted(p, 'open-chat');
    assert.deepStrictEqual([chat.agent, chat.prompt.slice(0, 13)], ['dewa-fiori', 'DEWA-FIORI v1']);
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await continueGate(p);
    await p.click('[data-action="handoff-fiori-review"]');
    chat = await waitPosted(p, 'open-chat');
    assert.deepStrictEqual([chat.agent, chat.prompt.slice(0, 20)], ['dewa-fiori-review', 'DEWA-FIORI-REVIEW v1']);
    assert.deepStrictEqual(p.errors, []);
  } finally { await browser.close(); }
});

const PORTAL_FS = { kind: 'fs-draft', version: 1, title: 'Open orders in the customer portal', requirement: 'Customers see their open orders in the portal.',
  frs: [{ title: 'List open orders', priority: 'must', acceptance: ['When a customer opens the page, then their open orders are listed'] }],
  data: [{ field: 'Order status', table: 'Order', sapField: 'Status', usage: 'selection' }, { field: 'Order number', table: 'Order', sapField: 'OrderNo', usage: 'output' },
    { field: 'Delivery note', table: 'Order', sapField: 'DeliveryNote', usage: 'stored' }],
  ricefw: [{ type: 'api', description: 'Open orders service', frs: 'FR-01' }, { type: 'screen', description: 'Open orders page', frs: 'FR-01' }],
  uat: [{ fr: 'FR-01', scenario: 'Customer with 2 open orders', type: 'positive', expected: '2 rows' }] };

test('N1 non-SAP – .NET portal from a Word BRD: no SAP search → FS components → Create all → generic TS → completion → agent mode', async () => {
  const browser = await chromium.launch();
  try {
    const p = await open(browser);
    await fsSystem(p, 'other', { systemName: 'Customer portal (.NET)' });
    await uploadDoc(p, 'brd', 'BRD_Portal.docx', F.DOCX_MIME, F.docx([['h1', 'Customer portal – open orders'], ['p', 'Customers see their open orders with status and order number.']]));
    assert.strictEqual(await p.locator('.fs-depth').count(), 0, 'no SAP search choice for non-SAP');
    await p.click('[data-action="fs-docs-auto"]');
    const d = await waitPosted(p, 'draft');
    assert.strictEqual((await posted(p, 'read-program')).length, 0, 'no SAP search for a non-SAP FS');
    assert.match(d.prompt, /The solution is not on SAP|Not an SAP system/);
    assert.match(d.prompt, /- ricefw: the solution components to build/);
    assert.doesNotMatch(d.prompt, /module \(one of/);
    assert.match(d.prompt, /Customers see their open orders with status and order number/);
    await send(p, { type: 'draft-result', text: json(PORTAL_FS), evidence: NO_EV });
    await applyDialog(p, '#draft-dialog', 'fs-draft-apply');
    assert.match(await p.locator('.fs-log').innerText(), /No SAP system – writing the FS from the documents/);
    const fsMd = await p.evaluate(() => APB.fsMarkdown.build(APB.state.get()));
    assert.match(fsMd, /Solution components/);
    assert.match(fsMd, /\| C-01 \| API \/ service \|/);
    await p.evaluate(() => APB.fsApp.actions['fs-docx']());
    assert.match(wordText((await saved(p, /\.docx$/)).buffer), /Solution components/);
    await fsStep(p, 3);
    assert.match(await p.locator('.fs-handoff').innerText(), /Technical Specification for GitHub Copilot \(agent mode/);
    await p.click('[data-action="fs-handoff-all"]');
    await continueGate(p);
    const td = await waitPosted(p, 'ts-draft');
    assert.strictEqual((await posted(p, 'read-dev')).length, 0, 'no SAP check for non-SAP');
    assert.doesNotMatch(td.prompt, /SAP|ABAP/);
    let ts = await st(p);
    assert.deepStrictEqual([ts.platform, ts.stack, ts.objects[0].type, ts.objects[0].name], ['generic', '.NET (C# / ASP.NET Core)', 'API Endpoint', 'OpenOrdersApi']);
    assert.deepStrictEqual(ts.objects[0].detail.response.map((r) => r.source), ['Order.OrderNo']);
    assert.strictEqual(ts.quality.authorization, 'no');
    await send(p, { type: 'tsdraft-result', text: json({ kind: 'dewa-ts-draft', version: 1, objects: [{ name: 'OpenOrdersApi', type: 'API Endpoint', detail: {
      method: 'GET', path: '/api/v1/orders/open', logic: 'Filter Order.Status; check Customer.PortalId; return Order.OrderNo' } }], quality: { testScenarios: 'Customer with 2 open orders => 2 rows' } }), evidence: NO_EV });
    await applyDialog(p, '#tsd-dialog', 'tsd-apply');
    ts = await st(p);
    assert.match(ts.objects[0].detail.logic, /\[TO BE CONFIRMED\] Customer\.PortalId/);
    assert.doesNotMatch(ts.objects[0].detail.logic, /\[TO BE CONFIRMED\] Order\./);
    const md = await p.evaluate(() => APB.markdown.build(APB.state.get()));
    assert.match(md, /^# Development Specification/);
    assert.match(md, /Inspect the existing repository first/);
    assert.match(md, /Automated tests \(unit \/ integration\) completed and passing/);
    assert.deepStrictEqual(md.split('\n').filter((l) => /ABAP|SAP Clean Core/.test(l)), []);
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await continueGate(p);
    const chat = await waitPosted(p, 'open-chat');
    assert.deepStrictEqual([chat.agent, chat.prompt.slice(0, 15)], ['agent', 'DEWA-GENERIC v1']);
    // the web screen spec (in Drafts) has its API and entity from the FS data
    const screen = await p.evaluate(() => APB.storage.list().map((x) => APB.storage.load(x.id)).filter((x) => x && x.platform === 'generic' && x.objects[0].type === 'Web Screen')[0]);
    assert.deepStrictEqual(screen.objects.map((o) => o.type), ['Web Screen', 'API Endpoint', 'Data Entity']);
    assert.deepStrictEqual(screen.objects[2].detail.columns.map((c) => c.name), ['DeliveryNote']);
    assert.deepStrictEqual(p.errors, []);
  } finally { await browser.close(); }
});

test('N2 non-SAP – Power Platform from an Excel solution document: Power App + flow → stack Power Platform → flow trigger → agent mode', async () => {
  const browser = await chromium.launch();
  try {
    const p = await open(browser);
    await fsSystem(p, 'other', { systemName: 'Power Platform (Power Apps)' });
    await uploadDoc(p, 'solution', 'Solution.xlsx', F.XLSX_MIME, F.xlsx('Process', [['Step', 'Tool'], ['Request leave', 'Power App'], ['Notify manager', 'Power Automate']]));
    await p.click('[data-action="fs-docs-auto"]');
    const d = await waitPosted(p, 'draft');
    assert.match(d.prompt, /Request leave \| Power App/);
    await send(p, { type: 'draft-result', text: json({ kind: 'fs-draft', version: 1, title: 'Leave requests', requirement: 'Employees request leave in an app; managers are notified.',
      frs: [{ title: 'Request leave', priority: 'must' }, { title: 'Notify manager', priority: 'must' }],
      outputs: [{ name: 'Manager notification', type: 'email', trigger: 'When a leave request is submitted' }],
      ricefw: [{ type: 'powerapp', description: 'Leave request app', frs: 'FR-01' }, { type: 'flow', description: 'Notify manager flow', frs: 'FR-02' }] }), evidence: NO_EV });
    await applyDialog(p, '#draft-dialog', 'fs-draft-apply');
    await fsStep(p, 3);
    await p.click('[data-action="fs-handoff"][data-i="1"]');
    await continueGate(p);
    await waitPosted(p, 'ts-draft');
    const ts = await st(p);
    assert.deepStrictEqual([ts.stack, ts.types[0], ts.objects[0].type, ts.objects[0].detail.trigger], ['Power Platform (Power Apps / Power Automate / Dataverse)', 'G_FLOW', 'Power Automate Flow', 'When a leave request is submitted']);
    await send(p, { type: 'tsdraft-result', text: json({ kind: 'dewa-ts-draft', version: 1, objects: [{ name: ts.objects[0].name, type: 'Power Automate Flow', detail: {
      flowType: 'Automated (trigger)', steps: [{ step: '1', action: 'Send an email (V2)', connector: 'Office 365 Outlook', notes: 'to the manager' }] } }] }), evidence: NO_EV });
    await applyDialog(p, '#tsd-dialog', 'tsd-apply');
    assert.strictEqual((await st(p)).objects[0].detail.steps[0].connector, 'Office 365 Outlook');
    assert.match(await p.evaluate(() => APB.markdown.build(APB.state.get())), /Power Platform: use solutions, connection references/);
    await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
    await continueGate(p);
    assert.strictEqual((await waitPosted(p, 'open-chat')).agent, 'agent');
    assert.deepStrictEqual(p.errors, []);
  } finally { await browser.close(); }
});

test('B1 browser (no VS Code) – SAP and non-SAP: copy prompt → paste the AI answer → FS → TS → paste completion', async () => {
  const browser = await chromium.launch();
  try {
    for (const sys of ['sap', 'other']) {
      const p = await open(browser, { vscode: false });
      await p.click('[data-mode="fs"]');
      await p.evaluate((s) => { APB.state.set('context.system', s); if (s === 'sap') APB.state.set('context.module', 'SD'); APB.ui.renderMain(); }, sys);
      await uploadDoc(p, 'brd', 'BRD.docx', F.DOCX_MIME, sys === 'sap' ? ALV_BRD : F.docx([['p', 'Customers see their open orders.']]));
      await p.click('[data-action="fs-docs-copy"]');
      await p.waitForSelector('#fs-docs-answer');
      const clip = await p.evaluate(() => navigator.clipboard.readText());
      assert.match(clip, sys === 'sap' ? /SEARCH THE SAP SYSTEM BY PROCESS/ : /The solution is not on SAP/);
      await p.fill('#fs-docs-answer', json(sys === 'sap' ? FS_ALV : PORTAL_FS));
      await p.click('[data-action="fs-docs-review"]');
      await applyDialog(p, '#draft-dialog', 'fs-draft-apply');
      await fsStep(p, 3);
      await p.click('[data-action="fs-handoff"][data-i="0"]');
      await continueGate(p); // the browser default is the warn policy too
      await p.waitForFunction(() => APB.state.get().kind !== 'fs');
      await p.evaluate(() => { APB.ui.ui.step = 4; APB.ui.renderMain(); });
      await p.click('[data-action="tsd-copy"]');
      await p.waitForSelector('#tsd-answer');
      const tsPrompt = await p.evaluate(() => navigator.clipboard.readText());
      assert.match(tsPrompt, /^TS-DRAFT v1/);
      const ts = await st(p);
      await p.fill('#tsd-answer', json({ kind: 'dewa-ts-draft', version: 1, objects: [{ name: ts.objects[0].name, type: ts.objects[0].type, detail: { logic: '1. Read the data\n2. Show it' } }] }));
      await p.click('[data-action="tsd-review"]');
      await applyDialog(p, '#tsd-dialog', 'tsd-apply');
      assert.match((await st(p)).objects[0].detail.logic, /Read the data/);
      assert.strictEqual((await st(p)).platform, sys === 'sap' ? undefined : 'generic');
      assert.deepStrictEqual(p.errors, [], sys);
      await p.context().close();
    }
  } finally { await browser.close(); }
});

test('B2 upload round trip – FS and TS (SAP and non-SAP) download and upload back to the same state', async () => {
  const browser = await chromium.launch();
  try {
    const a = await open(browser);
    const files = await a.evaluate(([alv, portal]) => {
      const mk = (sys, d) => { const s = APB.fs.model.blank(); s.context.system = sys; s.context.module = sys === 'sap' ? 'SD' : ''; s.context.systemName = sys === 'other' ? 'Portal (.NET)' : '';
        s.context.title = d.title; s.context.requirement = d.requirement; s.reqs.frs = d.frs.map((f) => Object.assign({}, f, { acceptance: (f.acceptance || []).join('\n') })); s.reqs.data = d.data; s.solution.ricefw = d.ricefw; return APB.fs.model.migrate(s); };
      const out = [];
      [['sap', alv], ['other', portal]].forEach(([sys, d]) => {
        const fs = mk(sys, d); const ts = APB.fsApp.toDevSpec(fs, 0);
        out.push({ fs: fs, ts: ts });
      });
      return out;
    }, [FS_ALV, PORTAL_FS]);
    for (const f of files) {
      for (const which of ['fs', 'ts']) {
        await a.evaluate((s) => { APB.ui.loadState(s, 'x'); }, f[which]);
        await a.evaluate(() => { window.__posted.length = 0; });
        await a.evaluate(() => document.querySelector('[data-action="download"]').click());
        const file = await saved(a, /\.md$/);
        const b = await open(browser);
        await b.setInputFiles('#md-upload', { name: file.name, mimeType: 'text/markdown', buffer: file.buffer });
        await b.waitForTimeout(400);
        const got = await st(b);
        const want = f[which];
        if (which === 'fs') {
          assert.deepStrictEqual(got.reqs.data.map((d) => d.usage), want.reqs.data.map((d) => d.usage));
          assert.deepStrictEqual(got.solution.ricefw.map((r) => r.type), want.solution.ricefw.map((r) => r.type));
          assert.strictEqual(got.context.system, want.context.system);
        } else {
          assert.strictEqual(got.platform, want.platform);
          assert.strictEqual(got.stack, want.stack);
          assert.deepStrictEqual(got.objects.map((o) => o.type + ' ' + o.name), want.objects.map((o) => o.type + ' ' + o.name));
          assert.deepStrictEqual(got.objects[0].detail, want.objects[0].detail);
          assert.strictEqual(got.origin.fsText, want.origin.fsText);
          assert.strictEqual(got.quality.authorization, 'no');
        }
        assert.deepStrictEqual(b.errors, []);
        await b.context().close();
      }
    }
    assert.deepStrictEqual(a.errors, []);
  } finally { await browser.close(); }
});

test('B3 governance – unapproved TS: STOP in the instructions and a gate; approved TS: hand-off without warning (SAP and non-SAP)', async () => {
  const browser = await chromium.launch();
  try {
    for (const platform of ['sap', 'generic']) {
      const p = await open(browser, { account: 'ts-lead', policy: { gates: 'warn', approvers: { functional: ['fs-lead'], technical: ['ts-lead'] } } });
      await p.evaluate((pl) => {
        const s = APB.state.migrate(pl === 'sap'
          ? { types: ['REPORT'], requirement: { text: 'Open orders report' }, objects: [{ type: 'Report', name: 'ZSD_X', status: 'new', detail: { logic: 'x' } }], quality: { authorization: 'no' },
            sapCheck: { at: Date.now(), system: 'S4D', results: [{ name: 'ZSD_X', type: 'Report', result: 'missing', description: '' }], notFound: [] } } // SAP: approval needs the SAP check
          : { platform: 'generic', stack: 'Java (Spring Boot)', types: ['G_API'], requirement: { text: 'Open orders API' }, objects: [{ type: 'API Endpoint', name: 'OrdersApi', status: 'new', detail: { method: 'GET', path: '/orders' } }], quality: { authorization: 'no' } });
        APB.ui.loadState(s, 'x');
      }, platform);
      assert.match(await p.evaluate(() => APB.markdown.build(APB.state.get())), /1\. STOP: this specification is not approved/);
      await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
      await p.locator('#toast .toast-btn').waitFor();
      assert.match(await p.locator('#toast').innerText(), /approv/i);
      await p.evaluate(() => { APB.ui.ui.step = 5; APB.ui.ui.generated = true; APB.ui.renderMain(); });
      assert.doesNotMatch(await p.locator('.gov-card').innerText(), /Run Check & read in SAP/, platform);
      await p.click('[data-action="gov-approve"]');
      await p.waitForFunction(() => APB.gov.status(APB.state.get()).state === 'approved');
      assert.doesNotMatch(await p.evaluate(() => APB.markdown.build(APB.state.get())), /STOP: this specification/);
      await p.evaluate(() => { window.__posted.length = 0; document.querySelector('[data-action="vscode"]').click(); });
      const chat = await waitPosted(p, 'open-chat');
      assert.strictEqual(chat.agent, platform === 'sap' ? 'dewa-abap' : 'agent');
      assert.doesNotMatch(chat.prompt, /STOP: this specification/);
      assert.deepStrictEqual(p.errors, [], platform);
      await p.context().close();
    }
  } finally { await browser.close(); }
});
