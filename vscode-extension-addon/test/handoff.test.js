'use strict';
// Hand-off of a Technical spec: new objects → dewa-abap, existing objects to change → dewa-abap-change.
// Run: node --test vscode-extension-addon/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const window = {};
const ctx = vm.createContext({ window, console, Date, JSON, Math });
['config-bundle', 'host', 'governance', 'flow-diagram', 'object-definitions', 'state', 'validation', 'completeness', 'rap-blueprint', 'dev-sap', 'markdown-generator']
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
const APB = window.APB;
const plain = (x) => JSON.parse(JSON.stringify(x));
const spec = (objects) => APB.state.migrate({ requirement: { text: 'Bonus duplicate check' }, types: ['REPORT'], objects });

const NEW = { type: 'Table', name: 'ZHR_BONUS_AI_LOG', status: 'new' };
const CHANGE = { type: 'Report', name: 'ZHR_BONUS_UPDATE', status: 'change', purpose: 'Add duplicate check before posting' };
const EXISTING = { type: 'Table', name: 'PA0015', status: 'existing' };

test('routing from the object statuses: new only, change only, both', () => {
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([NEW, EXISTING])).agents), ['dewa-abap']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([CHANGE, EXISTING])).agents), ['dewa-abap-change']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([NEW, CHANGE, EXISTING])).agents), ['dewa-abap', 'dewa-abap-change']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([EXISTING])).agents), ['dewa-abap'], 'nothing to change → as before');
});

test('prompts: change mode starts with the marker and limits the scope; new mode leaves changed objects alone', () => {
  const s = spec([NEW, CHANGE, EXISTING]);
  const ch = APB.markdown.chatPrompt(s, 'change');
  assert.match(ch, /^DEWA-ABAP-CHANGE v1\nChange the existing SAP objects .* only those listed under "Existing Objects to Change"/);
  assert.match(ch, /wait for CONFIRM CHANGE before every write/);
  assert.match(ch, /## \d+\. Existing Objects to Change/);
  const nw = APB.markdown.chatPrompt(s, 'new');
  assert.match(nw, /^Implement the SAP development specification below\..* Build only the NEW objects; .*dewa-abap-change – do not modify them\./);
  assert.doesNotMatch(APB.markdown.chatPrompt(spec([NEW])), /dewa-abap-change/, 'unchanged prompt without changed objects');
});

test('Copilot Development Instructions name the change agent and the order', () => {
  const md = APB.markdown.build(spec([NEW, CHANGE]));
  assert.match(md, /Objects under "Existing Objects to Change" are changed with the dewa-abap-change agent, one at a time: .*CONFIRM CHANGE.* never modify SAP standard\. Build the new objects first \(dewa-abap\)\./);
  assert.doesNotMatch(APB.markdown.build(spec([NEW])), /dewa-abap-change/);
});

/* ---------- dewa-fiori (1.0.29) ---------- */
const FIORI = { type: 'Fiori/UI5', name: 'ZSD_BILLBLOCK', status: 'new', purpose: 'Maintenance app', detail: {
  appType: 'Fiori elements – List Report & Object Page', appId: 'dewa.sd.billblock', service: 'ZUI_SD_BILLBLOCK_O4 / BillBlock', odataVersion: 'V4',
  columns: [{ field: 'CustomerGroup', label: 'Customer group', importance: 'High' }],
  sections: [{ label: 'General', type: 'Field group (form)', content: 'SalesOrganization, CustomerGroup' }],
  actions: [{ action: 'deactivate', label: 'Deactivate', placement: 'Table toolbar', confirm: true }],
  views: [{ name: 'Main', purpose: 'hidden for Fiori elements' }],
  deploy: 'ABAP repository (BSP)', bspName: 'ZSD_BILLBLOCK', transport: 'S4DK900123' } };
const RAP = { type: 'RAP', name: 'ZR_SALESBLOCK', status: 'new' };

test('Fiori/UI5 apps go to dewa-fiori, backend objects stay with dewa-abap / dewa-abap-change', () => {
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([RAP, FIORI])).agents), ['dewa-abap', 'dewa-fiori']);
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([FIORI, EXISTING])).agents), ['dewa-fiori'], 'Fiori only → dewa-fiori only');
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([RAP, CHANGE, FIORI])).agents), ['dewa-abap', 'dewa-abap-change', 'dewa-fiori']);
  const changeApp = Object.assign({}, FIORI, { status: 'change' });
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([RAP, changeApp])).agents), ['dewa-abap', 'dewa-fiori'], 'changing an app is dewa-fiori, not dewa-abap-change');
  assert.deepStrictEqual(plain(APB.markdown.handoff(spec([RAP, Object.assign({}, FIORI, { status: 'existing' })])).agents), ['dewa-abap'], 'an existing app that is only used');
});

test('prompts: fiori mode has the marker and the rules; backend prompts leave the app to dewa-fiori', () => {
  const s = spec([RAP, CHANGE, FIORI]);
  const fi = APB.markdown.chatPrompt(s, 'fiori');
  assert.match(fi, /^DEWA-FIORI v1\nBuild the Fiori\/UI5 apps .* only the objects of type Fiori\/UI5/);
  assert.match(fi, /use only entity sets, fields, navigations and actions that exist in its metadata/);
  assert.match(fi, /CONFIRM DEPLOY/);
  for (const m of ['new', 'change']) assert.match(APB.markdown.chatPrompt(s, m), /Do not build or change the Fiori\/UI5 apps – they are built afterwards with dewa-fiori\./);
  assert.doesNotMatch(APB.markdown.chatPrompt(spec([RAP])), /dewa-fiori/, 'no Fiori app → prompt unchanged');
});

test('Fiori section in the document: floorplan fields, freestyle fields only for freestyle, instruction line', () => {
  const md = APB.markdown.build(spec([RAP, FIORI]));
  assert.match(md, /\*\*Table columns \(list report\)\*\*/);
  assert.match(md, /CustomerGroup/);
  assert.match(md, /\*\*Object page sections\*\*/);
  assert.match(md, /\*\*Actions\*\*[\s\S]*deactivate/);
  assert.match(md, /BSP application name.*ZSD_BILLBLOCK/);
  assert.doesNotMatch(md, /Views \(freestyle\)/, 'freestyle fields hidden for Fiori elements');
  assert.match(md, /Fiori\/UI5 apps are built with the dewa-fiori agent after the backend service is activated and published/);
  const fs2 = Object.assign({}, FIORI, { detail: { appType: 'Freestyle SAPUI5', views: [{ name: 'Main', controls: 'sap.m.Table' }], routes: [{ name: 'main', pattern: '', target: 'Main' }], columns: [{ field: 'X' }] } });
  const md2 = APB.markdown.build(spec([fs2]));
  assert.match(md2, /\*\*Views \(freestyle\)\*\*[\s\S]*sap\.m\.Table/);
  assert.match(md2, /\*\*Routes \(freestyle\)\*\*/);
  assert.doesNotMatch(md2, /Table columns \(list report\)/, 'list report fields hidden for freestyle');
});

test('completeness asks for the Fiori essentials', () => {
  const missing = (s) => { const e = APB.completeness.evaluate(s); return e.important.concat(e.optional).map((r) => r.id); };
  const mk = (o) => APB.state.migrate({ requirement: { text: 'Fiori app for billing block rules' }, types: ['FIORI'], objects: [o] });
  const empty = missing(mk({ type: 'Fiori/UI5', name: '', status: 'new' }));
  for (const id of ['fioriFloorplan', 'fioriService', 'fioriAppId', 'fioriLayout']) assert.ok(empty.includes(id), id);
  assert.deepStrictEqual(plain(missing(mk(FIORI)).filter((i) => /^fiori/.test(i))), []);
  assert.ok(!missing(spec([RAP])).some((i) => /^fiori/.test(i)), 'not asked without a Fiori app type');
});
